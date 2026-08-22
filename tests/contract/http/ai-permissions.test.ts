// contract/http/ai-permissions — R4 fail-closed 强制（应用架构评审 2026-08-22）
// GET /api/v1/ai/permissions 返回三级表；
// POST commands 对未登记 capability 404 unknown_capability、对 forbidden 403 capability_forbidden。
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
let tasks: ReturnType<typeof createInProcessTasks>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-ai-permissions-http-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  tasks = createInProcessTasks({ persistence, events });
  const deps: AppDeps = {
    persistence,
    workspaceDir: join(dir, "ws"),
    content: createWorkspaceFilesContent(join(dir, "ws")),
    events,
    tasks,
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),

    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-22T12:00:00.000Z"),
  };
  app = createApp(deps);
});

afterEach(async () => {
  await tasks.stop();
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(): Promise<{ id: string }> {
  const res = await request(app).post("/api/v1/projects").send({ name: "TrustBoundary" });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

describe("GET /api/v1/ai/permissions", () => {
  it("returns the permission table and forbidden operations", async () => {
    const res = await request(app).get("/api/v1/ai/permissions");
    expect(res.status).toBe(200);
    const body = res.body as { permissions: Array<{ capability: string; tier: string }>; forbidden: Array<{ capability: string; tier: string }> };
    expect(body.permissions.length).toBeGreaterThanOrEqual(6);
    expect(body.forbidden.map((entry) => entry.capability)).toContain("flash_device");
  });
});

describe("command surface fail-closed enforcement", () => {
  it("rejects unregistered capabilities with 404 unknown_capability", async () => {
    const project = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/commands`)
      .send({ capability: "delete_everything", payload: {} });
    expect(res.status).toBe(404);
    expect(res.body.code ?? res.body.error?.code).toBe("unknown_capability");
  });

  it("rejects forbidden capabilities with 403 capability_forbidden", async () => {
    const project = await createProject();
    const res = await request(app)
      .post(`/api/v1/projects/${project.id}/commands`)
      .send({ capability: "flash_device", payload: {} });
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.error?.code).toBe("capability_forbidden");
  });
});
