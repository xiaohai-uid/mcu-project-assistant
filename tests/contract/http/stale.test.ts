// contract/http/stale — S5B surface（ISSUE-007 §11/§12；application-contract 2.14/2.19）
// /commands revalidate_artifact（kind|all）、GET stale-marks（get_stale_scope）、
// 409 no_stale / 409 blocking_stale（I-8 门禁：L3 下标记 Validation 成功被拒）。
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

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s5b-http-"));
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

async function ensureArtifact(projectId: string, kind: string): Promise<{ id: string }> {
  const res = await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind });
  return res.body as { id: string };
}

async function commitManual(artifactId: string, content: string): Promise<void> {
  await request(app).post(`/api/v1/artifacts/${artifactId}/versions`).send({ content });
}

/** Golden Journey 前置：需求 v1 → ESP32-S3 → pinmap v1 → wiring/firmware 手动占位 v1 */
async function seedDownstream(projectId: string): Promise<void> {
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "generate_pin_map", payload: {} });
  const wiring = await ensureArtifact(projectId, "wiring");
  await commitManual(wiring.id, JSON.stringify({ wiring: [] }));
  const firmware = await ensureArtifact(projectId, "firmware");
  await commitManual(firmware.id, JSON.stringify({ code: "// v1 placeholder" }));
}

describe("S5B stale surface", () => {
  it("换 MCU → GET stale-marks：pinmap/wiring/firmware L3（传递闭包，含 kind 解析）", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    await seedDownstream(projectId);

    await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });

    const res = await request(app).get(`/api/v1/projects/${projectId}/stale-marks`);
    expect(res.status).toBe(200);
    const { marks } = res.body as {
      marks: Array<{ kind: string; level: string; resolvedAt: string | null }>;
    };
    const kinds = marks.map((m) => m.kind).sort();
    expect(kinds).toEqual(["firmware", "pinmap", "wiring"].sort());
    expect(marks.every((m) => m.level === "L3" && m.resolvedAt === null)).toBe(true);
  });

  it("revalidate_artifact（all）→ 逐项结果；无语义变化项转 Validated；有语义变化项出提案（D1 不自动接受）→ 接受后 marks 消除", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    await seedDownstream(projectId);
    // 换 MCU 后按新决策重新生成 pinmap（决策同源 → pinmap 无语义变化）
    await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });
    await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_pin_map", payload: {} });

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "revalidate_artifact", payload: {} });
    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ kind: string; outcome: "validated" | "proposal_created" | "error"; proposalId?: string }>;
    };
    expect(results.length).toBe(3);
    const byKind = Object.fromEntries(results.map((r) => [r.kind, r]));
    // pinmap 重算同内容、wiring 无法重算（上游已解决即视为有效）→ validated
    expect(byKind["pinmap"]?.outcome).toBe("validated");
    expect(byKind["wiring"]?.outcome).toBe("validated");
    // firmware 占位重算 ≠ 手动内容 → 有语义变化 → proposal_created（D1 不自动接受）
    expect(byKind["firmware"]?.outcome).toBe("proposal_created");
    expect(byKind["firmware"]?.proposalId).toBeTruthy();

    // 决策：接受固件提案 → 该 artifact 的 Stale 解除 → 横幅消失
    const proposalId = byKind["firmware"]!.proposalId!;
    const decide = await request(app)
      .post(`/api/v1/proposals/${proposalId}/decision`)
      .send({ decision: "accept" });
    expect(decide.status).toBe(200);

    const marksRes = await request(app).get(`/api/v1/projects/${projectId}/stale-marks`);
    const { marks } = marksRes.body as { marks: unknown[] };
    expect(marks).toHaveLength(0);
  });

  it("revalidate_artifact：有语义变化 → proposal_created（D1 不自动接受）", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    await seedDownstream(projectId);
    await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });
    // 手动把 pinmap 改成与重算不同的内容（IO99）
    const pinmap = await ensureArtifact(projectId, "pinmap");
    await commitManual(pinmap.id, JSON.stringify({ pinMap: [{ component: "Relay", pinId: "IO99", type: "Digital" }], issues: [] }));

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "revalidate_artifact", payload: { kind: "pinmap" } });
    expect(res.status).toBe(200);
    const { results } = res.body as { results: Array<{ kind: string; outcome: string; proposalId?: string }> };
    expect(results[0]?.outcome).toBe("proposal_created");
    expect(results[0]?.proposalId).toBeTruthy();
    // 提案 pending（不自动接受）→ pinmap 仍有 active mark
    const marksRes = await request(app).get(`/api/v1/projects/${projectId}/stale-marks`);
    const { marks } = marksRes.body as { marks: Array<{ kind: string }> };
    expect(marks.some((m) => m.kind === "pinmap")).toBe(true);
  });

  it("无 stale 时 revalidate → 409 no_stale", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    await seedDownstream(projectId);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "revalidate_artifact", payload: {} });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("no_stale");
  });

  it("L3 门禁：stale 期间标记 Validation 成功 → 409 blocking_stale（I-8；门禁矩阵）", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    await seedDownstream(projectId);
    await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "select_mcu", payload: { mcuId: "RP2040" } });

    const pinmap = await ensureArtifact(projectId, "pinmap");
    const versions = (await (await request(app).get(`/api/v1/artifacts/${pinmap.id}/versions`)).body) as Array<{ id: string }>;
    const current = versions[versions.length - 1]!;
    const res = await request(app).post(`/api/v1/versions/${current.id}/validations`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("blocking_stale");
  });
});
