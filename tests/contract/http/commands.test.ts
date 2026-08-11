// contract/http/commands — S3A commands surface（implementation-spec §10.1；ISSUE-003 §11）
// POST /projects/:pid/commands（analyze_requirement）、POST /commands/:taskId/clarification、/cancel、GET /commands/:taskId
// 错误信封：400 空描述 / 404 项目 / 503 provider_unavailable / 409 invalid_round。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { TaskDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3a-http-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: join(dir, "ws"),
    content: createWorkspaceFilesContent(join(dir, "ws")),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  };
  app = createApp(deps);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(): Promise<{ id: string }> {
  const res = await request(app).post("/api/v1/projects").send({ name: "Greenhouse" });
  return res.body as { id: string };
}

describe("S3A commands surface", () => {
  it("POST /projects/:pid/commands {capability:analyze_requirement} → 202 {taskId}；GET /commands/:taskId 可查状态", async () => {
    const p = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "greenhouse monitor" } });
    expect(res.status).toBe(202);
    const { taskId } = res.body as { taskId: string };
    expect(taskId).toBeTruthy();

    const status = await request(app).get(`/api/v1/commands/${taskId}`);
    expect(status.status).toBe(200);
    const task = status.body as TaskDto;
    expect(task.capability).toBe("analyze_requirement");
    expect(["queued", "running", "completed", "failed", "cancelled"]).toContain(task.status);
  });

  it("空描述 → 400 invalid_description", async () => {
    const p = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "   " } });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_description");
  });

  it("项目不存在 → 404", async () => {
    const res = await request(app)
      .post("/api/v1/projects/nope/commands")
      .send({ capability: "analyze_requirement", payload: { description: "x" } });
    expect(res.status).toBe(404);
  });

  it("未知 capability → 400 invalid_capability", async () => {
    const p = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "teleport", payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_capability");
  });

  it("POST /commands/:taskId/cancel → 202；任务终态 cancelled", async () => {
    const p = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "greenhouse" } });
    const { taskId } = res.body as { taskId: string };
    const cancel = await request(app).post(`/api/v1/commands/${taskId}/cancel`);
    expect(cancel.status).toBe(202);
    // 终态由 in-process runner 在 fn 感知 abort 后写回（微秒级延迟）；轮询终态
    let task: TaskDto | null = null;
    for (let i = 0; i < 40; i++) {
      task = (await (await request(app).get(`/api/v1/commands/${taskId}`)).body) as TaskDto;
      if (task?.status !== "running" && task?.status !== "queued") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(task?.status).toBe("cancelled");
  });

  it("clarification 轮次不符 → 409 invalid_round", async () => {
    const p = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "greenhouse" } });
    const { taskId } = res.body as { taskId: string };
    // 等待 mock 分析到达澄清门（streamText 7 chunk × 30ms + 结构化）
    await new Promise((r) => setTimeout(r, 600));
    const clar = await request(app)
      .post(`/api/v1/commands/${taskId}/clarification`)
      .send({ roundId: 42, answer: "x" });
    expect(clar.status).toBe(409);
    expect(clar.body.error?.code).toBe("invalid_round");
  });

  it("Provider 不可用 → 503 provider_unavailable（同步预检；合法降级；ADR-0010/ISSUE-003 §10）", async () => {
    const db2 = openDatabase(join(dir, "p2.db"));
    migrate(db2);
    const persistence2 = createProjectStore(db2);
    const events2 = createNoopEvents();
    const app2 = createApp({
      persistence: persistence2,
      workspaceDir: join(dir, "ws2"),
      content: createWorkspaceFilesContent(join(dir, "ws2")),
      events: events2,
      tasks: createInProcessTasks({ persistence: persistence2, events: events2 }),
      compiler: createMockCompiler(),
      ai: createMockAiProvider({ slow: false, providerDown: true }),
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const p = (await (await request(app2).post("/api/v1/projects").send({ name: "G" })).body) as { id: string };
    const res = await request(app2)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "greenhouse" } });
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("provider_unavailable");
    db2.close();
  });
});
