// contract/http/build — S7 surface（ISSUE-009 §11）
// POST /projects/:id/builds（202）→ GET /builds/:buildId（终态）→ GET /versions/:vid/builds（同版本多记录）
// 503 toolchain_unavailable；cancel 202/409；SSE build.output + build.succeeded 帧；GET /toolchain。
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createSseEvents } from "@/src/adapters/events/sse";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler, createUnavailableMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { BuildRecordDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let ws: string;
let app: ReturnType<typeof createApp>;

function boot(compiler = createMockCompiler(), sse = false) {
  dir = mkdtempSync(join(tmpdir(), "mcu-s7-http-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = sse ? createSseEvents() : createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler,
    device: createCompanionLocalDevice(),
    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  };
  app = createApp(deps);
}

afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(): Promise<string> {
  const res = await request(app).post("/api/v1/projects").send({ name: "Greenhouse" });
  return (res.body as { id: string }).id;
}

async function analyzeToRequirements(projectId: string): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "analyze_requirement", payload: { description: "greenhouse monitor" } });
  const { taskId } = res.body as { taskId: string };
  await new Promise((r) => setTimeout(r, 700));
  await request(app)
    .post(`/api/v1/commands/${taskId}/clarification`)
    .send({ roundId: 1, answer: "0.96 inch" });
  await new Promise((r) => setTimeout(r, 400));
  const proposals = (await (await request(app).get(`/api/v1/projects/${projectId}/proposals`)).body) as Array<{ id: string }>;
  for (const p of proposals) {
    await request(app).post(`/api/v1/proposals/${p.id}/decision`).send({ decision: "accept" });
  }
  await request(app).post(`/api/v1/projects/${projectId}/requirements/commit`).send({});
}

/** 前置：需求 v1 → ESP32-S3 → pinmap → 固件 v1（S6 接受路径简化：手动占位固件） */
async function seedFirmware(projectId: string): Promise<string> {
  await analyzeToRequirements(projectId);
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "generate_pin_map", payload: {} });
  const fw = (await (await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind: "firmware" })).body) as { id: string };
  await request(app).post(`/api/v1/artifacts/${fw.id}/versions`).send({
    content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }),
  });
  const versions = (await (await request(app).get(`/api/v1/artifacts/${fw.id}/versions`)).body) as Array<{ id: string; versionNo: number }>;
  return versions[versions.length - 1]!.id;
}

const waitFor = async (fn: () => Promise<boolean>, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
};

describe("S7 build surface", () => {
  it("run_build → 202 → 终态 succeeded + .build 日志 + 同版本多记录（D2 不产生版本）", async () => {
    boot();
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const fwVersionsBefore = (await (await request(app).get(`/api/v1/artifacts/${(await (await request(app).get(`/api/v1/projects/${projectId}/artifacts`)).body as Array<{ id: string; kind: string }>).find((a) => a.kind === "firmware")!.id}/versions`)).body as unknown[]).length;

    const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    expect(run.status).toBe(202);
    const { buildId } = run.body as { buildId: string };

    await waitFor(async () => {
      const rec = (await (await request(app).get(`/api/v1/builds/${buildId}`)).body) as BuildRecordDto;
      return rec.status === "succeeded";
    });
    const done = (await (await request(app).get(`/api/v1/builds/${buildId}`)).body) as BuildRecordDto;
    expect(done.status).toBe("succeeded");
    expect(done.exitCode).toBe(0);
    expect(done.stdoutRef).toContain(".build");
    expect(existsSync(join(ws, done.stdoutRef!))).toBe(true);
    expect(readFileSync(join(ws, done.stdoutRef!), "utf8")).toContain("Build complete");
    // 同版本多 Build 历史；Firmware 版本数不变（D2）
    const history = (await (await request(app).get(`/api/v1/versions/${versionId}/builds`)).body) as BuildRecordDto[];
    expect(history.length).toBe(1);
    const run2 = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    await waitFor(async () => {
      const rec = (await (await request(app).get(`/api/v1/builds/${(run2.body as { buildId: string }).buildId}`)).body) as BuildRecordDto;
      return rec.status === "succeeded";
    });
    const history2 = (await (await request(app).get(`/api/v1/versions/${versionId}/builds`)).body) as BuildRecordDto[];
    expect(history2.length).toBe(2);
    const fwVersionsAfter = (await (await request(app).get(`/api/v1/artifacts/${(await (await request(app).get(`/api/v1/projects/${projectId}/artifacts`)).body as Array<{ id: string; kind: string }>).find((a) => a.kind === "firmware")!.id}/versions`)).body as unknown[]).length;
    expect(fwVersionsAfter).toBe(fwVersionsBefore);
  });

  it("工具链缺失 → 503 toolchain_unavailable（真实检测 + GET /toolchain）", async () => {
    boot(createUnavailableMockCompiler());
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    expect(run.status).toBe(503);
    expect(((run.body as { error: { code: string } }).error).code).toBe("toolchain_unavailable");
    const tc = await request(app).get("/api/v1/toolchain");
    expect(tc.status).toBe(200);
    expect((tc.body as { available: boolean }).available).toBe(false);
  });

  it("取消：running → 202 cancelled；终态再取消 → 409 invalid_build_state", async () => {
    boot(createMockCompiler({ lines: Array.from({ length: 20 }, (_, i) => `line ${i}`), lineDelayMs: 30 }));
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    const { buildId } = run.body as { buildId: string };
    await new Promise((r) => setTimeout(r, 60));
    const cancel = await request(app).post(`/api/v1/builds/${buildId}/cancel`);
    expect(cancel.status).toBe(202);
    await waitFor(async () => {
      const rec = (await (await request(app).get(`/api/v1/builds/${buildId}`)).body) as BuildRecordDto;
      return rec.status === "cancelled";
    });
    const again = await request(app).post(`/api/v1/builds/${buildId}/cancel`);
    expect(again.status).toBe(409);
  });

  it("SSE：build.output 逐行帧 + build.succeeded 终态帧", async () => {
    // 真实 HTTP 服务器 + fetch 流式读取（sse 契约模式）
    boot(createMockCompiler({ lines: ["[OK] Compiling sketch...", "[OK] Linking...", "[OK] Build complete"] }), true);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    try {
      const create = await fetch(`${base}/api/v1/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Greenhouse" }),
      });
      const createRaw = await create.text();
      if (create.status !== 201) {
        throw new Error(`create failed: ${create.status} ${createRaw.slice(0, 200)}`);
      }
      const projectId = (JSON.parse(createRaw) as { id: string }).id;
      // 分析→澄清→accept→requirements v1（全 fetch）
      const analyze = await fetch(`${base}/api/v1/projects/${projectId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse monitor" } }),
      });
      const { taskId } = (await analyze.json()) as { taskId: string };
      await new Promise((r) => setTimeout(r, 700));
      await fetch(`${base}/api/v1/commands/${taskId}/clarification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: 1, answer: "0.96 inch" }),
      });
      await new Promise((r) => setTimeout(r, 400));
      const proposalResp = await fetch(`${base}/api/v1/projects/${projectId}/proposals`);
      const proposalRaw = await proposalResp.text();
      if (!proposalRaw.trim().startsWith("[")) {
        throw new Error(`proposals unexpected: ${proposalResp.status} ${proposalRaw.slice(0, 200)}`);
      }
      const proposalList = JSON.parse(proposalRaw) as Array<{ id: string }>;
      for (const pr of proposalList) {
        await fetch(`${base}/api/v1/proposals/${pr.id}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "accept" }),
        });
      }
      await fetch(`${base}/api/v1/projects/${projectId}/requirements/commit`, { method: "POST" });
      await fetch(`${base}/api/v1/projects/${projectId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } }),
      });
      await fetch(`${base}/api/v1/projects/${projectId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "generate_pin_map", payload: {} }),
      });
      const fw = (await (await fetch(`${base}/api/v1/projects/${projectId}/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "firmware" }),
      })).json()) as { id: string };
      await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }) }),
      });
      const versions = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as Array<{ id: string }>;
      const versionId = versions[versions.length - 1]!.id;

      const frames: Array<{ event: string; data: unknown }> = [];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`${base}/api/v1/projects/${projectId}/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // 先建立订阅再触发构建（保证订阅到 output 帧）
      const buildPromise = (async () => {
        await new Promise((r) => setTimeout(r, 200));
        await fetch(`${base}/api/v1/projects/${projectId}/builds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ versionId }),
        });
      })();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const event = raw.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim();
            const dataLine = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!dataLine) continue;
            try {
              frames.push({ event: event ?? "", data: JSON.parse(dataLine) });
            } catch {
              frames.push({ event: event ?? "", data: dataLine });
            }
            if (frames.some((f) => f.event === "build.succeeded")) {
              clearTimeout(timer);
              ctrl.abort();
              break;
            }
          }
          if (frames.some((f) => f.event === "build.succeeded")) break;
        }
      } catch {
        // abort 后退出
      } finally {
        clearTimeout(timer);
        ctrl.abort();
      }
      await buildPromise;

      const outputFrames = frames.filter((f) => f.event === "build.output");
      expect(outputFrames.length).toBeGreaterThanOrEqual(3);
      expect(frames.some((f) => f.event === "build.succeeded")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
