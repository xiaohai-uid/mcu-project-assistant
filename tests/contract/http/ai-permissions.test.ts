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

// ---------- issues/10：路由层 AI 权限强制（结构化，不靠约定） ----------

// AI 流量标记：带此头的请求自称为 AI 代理，只允许走命令缝。
const AI_MARKER = "x-ai-agent";

type RouteProbe = { method: string; path: string };

/** 枚举 express 路由表中的全部写路由（漂移测试的结构化探针）。 */
function collectWriteRoutes(instance: ReturnType<typeof createApp>): RouteProbe[] {
  const stack = (instance as unknown as { _router?: { stack: Array<{ route?: { path?: unknown; methods?: Record<string, boolean> } }> } })._router?.stack ?? [];
  const routes: RouteProbe[] = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route?.path || !route.methods) continue;
    for (const method of Object.keys(route.methods)) {
      if (["post", "put", "patch", "delete"].includes(method)) {
        routes.push({ method: method.toUpperCase(), path: String(route.path) });
      }
    }
  }
  return routes;
}

describe("middleware-level AI enforcement (issues/10)", () => {
  it("rejects AI-marked requests to direct REST write routes with 403 capability_forbidden", async () => {
    for (const path of ["/api/v1/projects", "/api/v1/device/flash-token", "/api/v1/device/flash"]) {
      const res = await request(app).post(path).set(AI_MARKER, "1").send({ capability: "flash_device" });
      expect([path, res.status]).toEqual([path, 403]);
      expect([path, res.body.code ?? res.body.error?.code]).toEqual([path, "capability_forbidden"]);
    }
  });

  it("lets unmarked human requests keep using direct REST write routes", async () => {
    const res = await request(app).post("/api/v1/projects").send({ name: "Human" });
    expect(res.status).toBe(201);
  });

  it("drift test: every write route outside the auth perimeter rejects AI-marked traffic", async () => {
    const probes = collectWriteRoutes(app);
    expect(probes.length).toBeGreaterThanOrEqual(20); // 路由枚举本身必须有效

    // 认证端点在 API 周界之前（登录本身建立身份）——是唯一豁免，且必须恰好只有这两个。
    const authRoutes = probes.filter((p) => p.path.startsWith("/api/v1/auth/")).map((p) => p.path).sort();
    expect(authRoutes).toEqual(["/api/v1/auth/login", "/api/v1/auth/logout"]);

    const seamPaths = [
      "/api/v1/projects/:projectId/commands",
      "/api/v1/commands/:taskId/clarification",
      "/api/v1/commands/:taskId/cancel",
    ];
    for (const probe of probes) {
      if (probe.path.startsWith("/api/v1/auth/")) continue;
      const url = probe.path.replace(/:([A-Za-z]+)/g, "drift-probe");
      const res = await request(app)[probe.method.toLowerCase() as "post"](url)
        .set(AI_MARKER, "1")
        .send({ capability: "__drift_probe__" });
      // 命令缝：404（commands 端点=unknown_capability；任务续问/取消=not_found——
      // 它们不带 capability，由任务存在性裁决）。其余写路由：403 capability_forbidden。
      if (probe.path === "/api/v1/projects/:projectId/commands") {
        expect([probe.path, res.status]).toEqual([probe.path, 404]);
        expect([probe.path, res.body.code ?? res.body.error?.code]).toEqual([probe.path, "unknown_capability"]);
      } else if (seamPaths.includes(probe.path)) {
        // 续问/取消按任务状态裁决（404 not_found / 409 状态冲突），结构性要求=不得成功。
        expect([probe.path, res.status >= 400]).toEqual([probe.path, true]);
      } else {
        expect([probe.path, res.status]).toEqual([probe.path, 403]);
        expect([probe.path, res.body.code ?? res.body.error?.code]).toEqual([probe.path, "capability_forbidden"]);
      }
    }
    // 缝路由必须真实存在于路由表中（豁免清单不为空集）。
    for (const seam of seamPaths) {
      expect(probes.some((p) => p.path === seam), `seam route ${seam} must exist`).toBe(true);
    }
  });
});
