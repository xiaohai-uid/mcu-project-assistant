import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

let dir: string;
let db: SqliteDb;
let server: Server;
let base: string;
let port: number;
let tasks: ReturnType<typeof createInProcessTasks>;
let device: ReturnType<typeof createCompanionLocalDevice>;
let events: ReturnType<typeof createSseEvents>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-browser-trust-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  events = createSseEvents();
  tasks = createInProcessTasks({ persistence, events });
  device = createCompanionLocalDevice();
  const app = createApp({
    persistence,
    workspaceDir: join(dir, "workspace"),
    content: createWorkspaceFilesContent(join(dir, "workspace")),
    events,
    tasks,
    compiler: createMockCompiler(),
    device,
    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await tasks.stop();
  await device.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function request(path: string, init: RequestInit = {}, origin?: string, host?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (origin !== undefined) headers.set("Origin", origin);
  if (host === undefined) return fetch(`${base}${path}`, { ...init, headers });
  const url = new URL(`${base}${path}`);
  const body = typeof init.body === "string" ? init.body : undefined;
  if (body !== undefined) headers.set("Content-Length", String(Buffer.byteLength(body)));
  const nodeHeaders: Record<string, string> = { Host: host };
  headers.forEach((value, name) => { nodeHeaders[name] = value; });
  return new Promise<Response>((resolve, reject) => {
    const client = httpRequest({ hostname: "127.0.0.1", port, path: `${url.pathname}${url.search}`, method: init.method ?? "GET", headers: nodeHeaders }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0, headers: responseHeaders }));
      });
    });
    client.on("error", reject);
    if (body !== undefined) client.write(body);
    client.end();
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function createProject(origin?: string, host?: string): Promise<Record<string, unknown>> {
  const response = await request(
    "/api/v1/projects",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `project-${Date.now()}-${Math.random()}` }) },
    origin,
    host,
  );
  expect(response.status).toBe(201);
  return json(response);
}

describe("localhost browser Origin / Host trust boundary", () => {
  it("rejects hostile origins before project, no-body, analyze, build, and confirmation handlers", async () => {
    const before = await request("/api/v1/projects").then((response) => response.json()) as unknown[];
    const evil = "http://evil.example";
    const project = await request(
      "/api/v1/projects",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "blocked" }) },
      evil,
    );
    expect(project.status).toBe(403);
    expect(await json(project)).toEqual({ error: { code: "untrusted_origin", message: "Request origin is not trusted" } });

    for (const [path, init] of [
      ["/api/v1/device/detect", { method: "POST" }],
      ["/api/v1/device/disconnect", { method: "POST" }],
      ["/api/v1/device/flash-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: "companion-esp32s3" }) }],
    ] as const) {
      const response = await request(path, init, evil);
      expect(response.status).toBe(403);
      expect((await json(response)).error).toEqual({ code: "untrusted_origin", message: "Request origin is not trusted" });
    }

    const detected = await request("/api/v1/device/detect", { method: "POST" });
    expect(detected.status).toBe(200);
    const deviceId = String((await json(detected)).id);
    const tokenResponse = await request("/api/v1/device/flash-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(tokenResponse.status).toBe(200);
    const token = String((await json(tokenResponse)).token);
    const hostileFlash = await request("/api/v1/device/flash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "blocked", deviceId, confirmationToken: token, buildId: "blocked", artifactVersionId: "blocked" }),
    }, evil);
    expect(hostileFlash.status).toBe(403);
    expect((await json(hostileFlash)).error).toEqual({ code: "untrusted_origin", message: "Request origin is not trusted" });

    const projectId = String((await createProject()).id);
    for (const [path, init] of [
      [`/api/v1/projects/${projectId}/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "blocked" } }) }],
      [`/api/v1/projects/${projectId}/builds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: "missing" }) }],
    ] as const) {
      const response = await request(path, init, evil);
      expect(response.status).toBe(403);
    }
    const after = await request("/api/v1/projects").then((response) => response.json()) as unknown[];
    expect(after.length).toBe(before.length + 1);
  });

  it("rejects hostile serial mutation and SSE requests before transport/subscriber registration", async () => {
    const project = await createProject();
    const projectId = String(project.id);
    const detected = await request("/api/v1/device/detect", { method: "POST" });
    expect(detected.status).toBe(200);
    const deviceId = String((await json(detected)).id);
    const hostileOpen = await request(`/api/v1/projects/${projectId}/device/serial/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    }, "http://evil.example");
    expect(hostileOpen.status).toBe(403);
    expect((await json(hostileOpen)).error).toEqual({ code: "untrusted_origin", message: "Request origin is not trusted" });
    const opened = await request(`/api/v1/projects/${projectId}/device/serial/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    expect(opened.status).toBe(201);
    const sessionId = String((await json(opened)).sessionId);
    const evil = "http://evil.example";

    const write = await request(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "GET_STATUS" }),
    }, evil);
    expect(write.status).toBe(403);
    const close = await request(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}`, { method: "DELETE" }, evil);
    expect(close.status).toBe(403);

    const projectSse = await request(`/api/v1/projects/${projectId}/events`, {}, evil);
    expect(projectSse.status).toBe(403);
    expect(projectSse.headers.get("content-type")).toMatch(/json/);
    const serialSse = await request(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}/events`, {}, evil);
    expect(serialSse.status).toBe(403);
    expect(serialSse.headers.get("content-type")).toMatch(/json/);

    const state = await request(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}`);
    expect(state.status).toBe(200);
    expect((await json(state)).status).toBe("connected");
    expect(events.subscriberCount(projectId)).toBe(0);
  });

  it("enforces canonical trusted origins and hosts while preserving no-Origin local clients", async () => {
    const trustedLocalhost = `http://localhost:${port}`;
    const trustedLoopback = `http://127.0.0.1:${port}`;
    expect((await createProject(trustedLocalhost)).id).toBeTruthy();
    expect((await createProject("http://LOCALHOST:" + port)).id).toBeTruthy();
    expect((await createProject(trustedLoopback)).id).toBeTruthy();
    expect((await createProject(undefined, `localhost:${port}`)).id).toBeTruthy();
    expect((await createProject(undefined, `127.0.0.1:${port}`)).id).toBeTruthy();

    for (const origin of [
      `http://localhost:${port + 1}`,
      `https://localhost:${port}`,
      "http://evil.example",
      "null",
      "malformed-origin",
    ]) {
      const response = await request("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "blocked" }) }, origin);
      expect(response.status).toBe(403);
      expect((await json(response)).error).toEqual({ code: "untrusted_origin", message: "Request origin is not trusted" });
    }

    for (const [origin, host] of [
      ["http://evil.example", `evil.example:${port}`],
      [trustedLocalhost, `evil.example:${port}`],
      [undefined, `evil.example:${port}`],
      [trustedLocalhost, `localhost.evil.example:${port}`],
    ] as const) {
      const response = await request("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "blocked" }) }, origin, host);
      expect(response.status).toBe(403);
      const body = await json(response);
      expect(body.error).toEqual({ code: "untrusted_host", message: "Request host is not trusted" });
    }
    const forwarded = await request("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-Host": `localhost:${port}` },
      body: JSON.stringify({ name: "blocked-forwarded-host" }),
    });
    expect(forwarded.status).toBe(403);
    expect(await json(forwarded)).toEqual({ error: { code: "untrusted_host", message: "Request host is not trusted" } });
  });

  it("returns exact CORS permission only for trusted preflight and rejects hostile preflight", async () => {
    const trusted = `http://localhost:${port}`;
    const allowed = await request("/api/v1/projects", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    }, trusted);
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(trusted);
    expect(allowed.headers.get("access-control-allow-methods")).toContain("POST");
    expect(allowed.headers.get("access-control-allow-headers")).toContain("Content-Type");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
    expect(allowed.headers.get("vary")).toMatch(/Origin/);

    const hostile = await request("/api/v1/projects", { method: "OPTIONS" }, "http://evil.example");
    expect(hostile.status).toBe(403);
    expect(hostile.headers.get("access-control-allow-origin")).toBeNull();
    expect(await json(hostile)).toEqual({ error: { code: "untrusted_origin", message: "Request origin is not trusted" } });
  });
});
