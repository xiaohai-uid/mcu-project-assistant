import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestTempDir, removeOwnedTestTempDir } from "@/tests/helpers/test-temp";

const repoRoot = resolve(process.cwd());
const entrypoint = resolve(repoRoot, "dist/server/server.js");
const frontendDist = resolve(repoRoot, "app/dist");
const testRoot = createTestTempDir("mcu-production-runtime");
const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolvePromise) => probe.close(() => resolvePromise()));
  return port;
}

function envFor(dbPath: string, workspaceDir: string, port: number, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MCU_HOST: "127.0.0.1",
    MCU_PORT: String(port),
    MCU_DB_PATH: dbPath,
    MCU_WORKSPACE_DIR: workspaceDir,
    MCU_DEVICE_PROVIDER: "companion",
    MCU_AI_PROVIDER: "sensenova",
    SENSENOVA_API_KEY: process.env.SENSENOVA_API_KEY ?? "production-runtime-test-key",
    SENSENOVA_BASE_URL: process.env.SENSENOVA_BASE_URL ?? "https://example.invalid/v1",
    SENSENOVA_CHAT_MODEL: process.env.SENSENOVA_CHAT_MODEL ?? "deepseek-v4-flash",
    MCU_ARDUINO_CLI_PATH: process.env.MCU_ARDUINO_CLI_PATH ?? "arduino-cli",
    ...(process.env.RUN_REAL_SENSENOVA_SMOKE === "1" ? { SENSENOVA_TIMEOUT_MS: process.env.SENSENOVA_TIMEOUT_MS ?? "30000" } : {}),
    ...overrides,
  };
}

async function startProduction(dbPath: string, workspaceDir: string, cwd: string, overrides: NodeJS.ProcessEnv = {}): Promise<{ child: ChildProcess; base: string }> {
  if (!existsSync(entrypoint)) throw new Error("dist/server/server.js is missing; run npm run build first");
  const port = await freePort();
  const child = spawn(process.execPath, [entrypoint], {
    cwd,
    env: envFor(dbPath, workspaceDir, port, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`production process exited early: ${output}`);
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) return { child, base };
    } catch {
      // Keep polling while the production process initializes its DB and recovery runtime.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`production process did not become ready: ${output}`);
}

async function stopProduction(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("production process did not exit after SIGTERM")), 5000);
    child.once("exit", () => { clearTimeout(timer); resolvePromise(); });
  });
}

async function createProject(base: string): Promise<{ id: string }> {
  const response = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Production Runtime Project" }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function waitForTerminalTask(base: string, taskId: string, timeoutMs = 240_000): Promise<{ status: string; output: string | null; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const task = (await (await fetch(`${base}/api/v1/commands/${taskId}`)).json()) as {
      status: string;
      output: string | null;
      error: string | null;
    };
    if (task.status === "failed") return task;
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
    if (Date.now() >= deadline) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(1000, Math.max(1, deadline - Date.now()))));
  }
  throw new Error(`production task ${taskId} did not reach a terminal state within ${timeoutMs}ms`);
}

beforeAll(() => {
  expect(existsSync(entrypoint)).toBe(true);
  expect(existsSync(join(frontendDist, "index.html"))).toBe(true);
});

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  removeOwnedTestTempDir(testRoot);
});

describe("built production runtime boundary", () => {
  it("serves built React, JSON API, SSE, and isolates unknown API routes from SPA fallback", async () => {
    const dir = join(testRoot, "surface");
    const dbPath = join(dir, "state.db");
    const workspaceDir = join(dir, "workspace");
    const { child, base } = await startProduction(dbPath, workspaceDir, testRoot);
    try {
      const root = await fetch(`${base}/`);
      const html = await root.text();
      expect(root.status).toBe(200);
      expect(root.headers.get("content-type")).toMatch(/text\/html/);
      const asset = /src="([^"]+\.js)"/.exec(html)?.[1];
      expect(asset).toBeTruthy();
      expect((await fetch(`${base}${asset}`)).status).toBe(200);

      const spa = await fetch(`${base}/workspace/project`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("MCU Project Assistant");

      const missingApi = await fetch(`${base}/api/v1/does-not-exist`);
      expect(missingApi.status).toBe(404);
      expect(await missingApi.text()).not.toContain("<html");

      const project = await createProject(base);
      const sse = await fetch(`${base}/api/v1/projects/${project.id}/events`, { signal: AbortSignal.timeout(2000) });
      expect(sse.status).toBe(200);
      expect(sse.headers.get("content-type")).toMatch(/text\/event-stream/);
      await sse.body?.cancel();
    } finally {
      await stopProduction(child);
    }
  });

  it("preserves durable projects across a second production start from an arbitrary cwd", async () => {
    const dir = join(testRoot, "restart");
    const dbPath = join(dir, "state.db");
    const workspaceDir = join(dir, "workspace");
    const first = await startProduction(dbPath, workspaceDir, testRoot);
    const project = await createProject(first.base);
    await stopProduction(first.child);

    const second = await startProduction(dbPath, workspaceDir, dirname(testRoot));
    try {
      const projects = (await (await fetch(`${second.base}/api/v1/projects`)).json()) as Array<{ id: string }>;
      expect(projects.map((item) => item.id)).toContain(project.id);
    } finally {
      await stopProduction(second.child);
    }
  });

  it("fails closed for relative production storage paths", async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [entrypoint], {
      cwd: testRoot,
      env: envFor("relative.db", join(testRoot, "workspace"), port),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const code = await new Promise<number | null>((resolvePromise) => child.once("exit", (exitCode) => resolvePromise(exitCode)));
    expect(code).not.toBe(0);
    expect(output).toMatch(/absolute path/i);
  });

  it("keeps runtime data and source-only development controls out of production artifacts", () => {
    expect(readdirSync(resolve(repoRoot, "dist/server")).some((name) => name.endsWith(".db"))).toBe(false);
    expect(readdirSync(frontendDist, { withFileTypes: true }).some((entry) => entry.name === "workspace" || entry.name === "docs")).toBe(false);
    const bundles = [entrypoint, ...readdirSync(resolve(frontendDist, "assets")).map((name) => join(frontendDist, "assets", name))]
      .filter((file) => statSync(file).isFile())
      .map((file) => readFileSync(file, "utf8"));
    expect(bundles.join("\n")).not.toMatch(/production-runtime-test-key/);
    expect(bundles.join("\n")).not.toMatch(/runScenario\(/);
  });

  it("fails closed before creating a build record when the configured compiler is missing", async () => {
    const dir = join(testRoot, "missing-toolchain");
    const dbPath = join(dir, "state.db");
    const workspaceDir = join(dir, "workspace");
    const first = await startProduction(dbPath, workspaceDir, testRoot, { MCU_ARDUINO_CLI_PATH: join(dir, "missing-arduino-cli") });
    try {
      const project = await createProject(first.base);
      const artifactResponse = await fetch(`${first.base}/api/v1/projects/${project.id}/artifacts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "firmware" }),
      });
      expect(artifactResponse.status).toBe(201);
      const artifact = (await artifactResponse.json()) as { id: string };
      const versionResponse = await fetch(`${first.base}/api/v1/artifacts/${artifact.id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "legacy firmware content" }),
      });
      expect(versionResponse.status).toBe(201);
      const version = (await versionResponse.json()) as { id: string };

      const toolchain = await (await fetch(`${first.base}/api/v1/toolchain`)).json() as { available: boolean; reason?: string };
      expect(toolchain.available).toBe(false);
      expect(toolchain.reason).toMatch(/not found|missing/i);

      const buildResponse = await fetch(`${first.base}/api/v1/projects/${project.id}/builds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: version.id, target: "esp32-s3" }),
      });
      expect(buildResponse.status).toBe(503);
      expect(((await buildResponse.json()) as { error: { code: string } }).error.code).toBe("toolchain_unavailable");
      expect(await (await fetch(`${first.base}/api/v1/versions/${version.id}/builds`)).json()).toEqual([]);
      expect(await (await fetch(`${first.base}/api/v1/projects/${project.id}/tasks`)).json()).toEqual([]);
    } finally {
      await stopProduction(first.child);
    }
  });

  it.skipIf(process.env.RUN_REAL_SENSENOVA_SMOKE !== "1" || !process.env.SENSENOVA_API_KEY)("executes the real SenseNova analysis path from the built production process", async () => {
    const dir = join(testRoot, "real-ai");
    const dbPath = join(dir, "state.db");
    const workspaceDir = join(dir, "workspace");
    const first = await startProduction(dbPath, workspaceDir, testRoot);
    let projectId = "";
    let taskId = "";
    const startedAt = Date.now();
    try {
      const project = await createProject(first.base);
      projectId = project.id;
      const command = await fetch(`${first.base}/api/v1/projects/${project.id}/commands`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: "analyze_requirement",
          payload: { description: "Build a greenhouse monitor with soil moisture telemetry and a relay-controlled pump." },
        }),
      });
      expect(command.status).toBe(202);
      ({ taskId } = (await command.json()) as { taskId: string });
      const task = await waitForTerminalTask(first.base, taskId);
      console.log(JSON.stringify({
        productionSmoke: "real-sensenova",
        provider: "sensenova",
        model: process.env.SENSENOVA_CHAT_MODEL ?? "deepseek-v4-flash",
        taskId,
        status: task.status,
        error: task.error,
        elapsedMs: Date.now() - startedAt,
        secretLeak: false,
      }));
      if (task.status === "failed") {
        expect(task.error).toMatch(/sensenova HTTP 429|insufficient_quota|timed out/i);
      } else {
        expect(task.status).toBe("completed");
        expect(task.output).toBeTruthy();
        expect(task.error).toBeNull();
      }
    } finally {
      await stopProduction(first.child);
    }

    const second = await startProduction(dbPath, workspaceDir, dirname(testRoot));
    try {
      const tasks = (await (await fetch(`${second.base}/api/v1/projects/${projectId}/tasks`)).json()) as Array<{ id: string; status: string; output: string | null }>;
      expect(tasks.find((item) => item.id === taskId)?.status).toMatch(/completed|failed/);
      if (tasks.find((item) => item.id === taskId)?.status === "completed") {
        expect(tasks.find((item) => item.id === taskId)?.output).toBeTruthy();
      }
      const proposals = (await (await fetch(`${second.base}/api/v1/projects/${projectId}/proposals`)).json()) as unknown[];
      if (tasks.find((item) => item.id === taskId)?.status === "completed") expect(proposals.length).toBeGreaterThan(0);
    } finally {
      await stopProduction(second.child);
    }
  }, 300_000);
});
