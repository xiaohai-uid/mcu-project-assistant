// contract/http/mcu — S4 commands surface（implementation-spec §10.1；ISSUE-005 §11）
// recommend_mcu / select_mcu / 错误信封（400 invalid_mcu / 404）。
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
import type { ArtifactDto, ArtifactVersionDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s4-http-"));
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
  // accept all → proceed → requirements v1
  for (const p of proposals) {
    await request(app).post(`/api/v1/proposals/${p.id}/decision`).send({ decision: "accept" });
  }
  await request(app).post(`/api/v1/projects/${projectId}/requirements/commit`).send({});
}

describe("S4 commands surface", () => {
  it("recommend_mcu → 候选矩阵 3 卡（推荐/备选/工业级）+ 外设", async () => {
    const p = await createProject();
    await analyzeToRequirements(p.id);
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "recommend_mcu", payload: {} });
    expect(res.status).toBe(200);
    const body = res.body as { candidates: Array<{ id: string; tier: string }>; peripherals: unknown[] };
    expect(body.candidates.map((c) => c.id)).toEqual(["ESP32-S3", "RP2040", "STM32F401RE"]);
    expect(body.candidates[0]?.tier).toBe("recommended");
    expect(body.candidates[1]?.tier).toBe("alternative");
    expect(body.candidates[2]?.tier).toBe("industrial");
    expect(body.peripherals.length).toBeGreaterThan(0);
  });

  it("select_mcu 首选 → Hardware v1；更换 → v2 + changed=true；同 MCU → 幂等", async () => {
    const p = await createProject();
    await analyzeToRequirements(p.id);

    const first = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
    expect(first.status).toBe(200);
    const r1 = first.body as { artifact: ArtifactDto; version: ArtifactVersionDto; changed: boolean };
    expect(r1.version.versionNo).toBe(1);
    expect(r1.changed).toBe(false);

    const second = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });
    const r2 = second.body as { version: ArtifactVersionDto; changed: boolean };
    expect(r2.version.versionNo).toBe(2);
    expect(r2.changed).toBe(true);

    const again = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });
    const r3 = again.body as { version: ArtifactVersionDto; changed: boolean };
    expect(r3.version.versionNo).toBe(2);
    expect(r3.changed).toBe(false);
  });

  it("invalid_mcu → 400", async () => {
    const p = await createProject();
    await analyzeToRequirements(p.id);
    const res = await request(app)
      .post(`/api/v1/projects/${p.id}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "PIC16F877A" } });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_mcu");
  });

  it("项目不存在 → 404", async () => {
    const res = await request(app)
      .post("/api/v1/projects/nope/commands")
      .send({ capability: "recommend_mcu", payload: {} });
    expect(res.status).toBe(404);
  });
});
