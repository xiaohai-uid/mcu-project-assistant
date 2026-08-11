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
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s1-http-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const ws = join(dir, "ws");
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),

    ai: createMockAiProvider(),
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

describe("HTTP surface（ISSUE-001 §3/§10；错误信封 §10.2）", () => {
  it("POST /projects → 201 + Project 形状（id/name/createdAt/archivedAt null）", async () => {
    const res = await request(app).post("/api/v1/projects").send({ name: "Smart Greenhouse" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Smart Greenhouse",
      createdAt: "2026-08-11T12:00:00.000Z",
      archivedAt: null,
    });
  });

  it("POST /projects 非法名称 → 400 错误信封（code=invalid_name）", async () => {
    const res = await request(app).post("/api/v1/projects").send({ name: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "invalid_name", message: expect.any(String) },
    });
  });

  it("Idempotency-Key：同键重发 → 同一项目（不重复创建）", async () => {
    const body = { name: "A" };
    const first = await request(app).post("/api/v1/projects").set("Idempotency-Key", "k1").send(body);
    const second = await request(app).post("/api/v1/projects").set("Idempotency-Key", "k1").send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it("GET /projects → 活跃列表；GET /projects/:id → 项目", async () => {
    const created = await request(app).post("/api/v1/projects").send({ name: "A" });
    const list = await request(app).get("/api/v1/projects");
    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(created.body.id);
    const one = await request(app).get(`/api/v1/projects/${created.body.id}`);
    expect(one.status).toBe(200);
    expect(one.body.name).toBe("A");
  });

  it("GET /projects/:id 不存在 → 404 信封（code=not_found）", async () => {
    const res = await request(app).get("/api/v1/projects/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("archive 流：token → 归档 → 移出活跃列表、记录保留；再归档 409", async () => {
    const created = await request(app).post("/api/v1/projects").send({ name: "A" });
    const id = created.body.id as string;

    const tokenRes = await request(app).post(`/api/v1/projects/${id}/archive-token`);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body).toMatchObject({ token: expect.any(String), impact: { projects: 1 } });

    const archived = await request(app)
      .post(`/api/v1/projects/${id}/archive`)
      .send({ confirmationToken: tokenRes.body.token });
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).toBe("2026-08-11T12:00:00.000Z");

    const list = await request(app).get("/api/v1/projects");
    expect(list.body.map((p: { id: string }) => p.id)).not.toContain(id);
    const one = await request(app).get(`/api/v1/projects/${id}`);
    expect(one.body.archivedAt).not.toBeNull(); // 记录保留（I-10）

    // 已归档项目：archive-token 被守卫拒绝（409 already_archived）
    const tokenAgain = await request(app).post(`/api/v1/projects/${id}/archive-token`);
    expect(tokenAgain.status).toBe(409);
    expect(tokenAgain.body.error.code).toBe("already_archived");
  });

  it("archive 无令牌 → 403（code=confirmation_missing）", async () => {
    const created = await request(app).post("/api/v1/projects").send({ name: "A" });
    const res = await request(app).post(`/api/v1/projects/${created.body.id}/archive`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("confirmation_missing");
  });

  it("archive 令牌一次性：复用 → 403（code=confirmation_invalid）", async () => {
    const created = await request(app).post("/api/v1/projects").send({ name: "A" });
    const id = created.body.id as string;
    const { token } = (await request(app).post(`/api/v1/projects/${id}/archive-token`)).body;
    await request(app).post(`/api/v1/projects/${id}/archive`).send({ confirmationToken: token });
    const reuse = await request(app).post(`/api/v1/projects/${id}/archive`).send({ confirmationToken: token });
    expect(reuse.status).toBe(403);
    expect(reuse.body.error.code).toBe("confirmation_invalid");
  });

  it("GET /health → 200 ok", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
