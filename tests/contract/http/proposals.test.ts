// contract/http/proposals — S3B proposals surface（implementation-spec §10.1；ISSUE-004 §11）
// POST /proposals/:id/decision（accept|reject）；GET /projects/:pid/proposals；
// 409 OutdatedProposal 信封；400 invalid_decision；幂等同决策 no-op。
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
import type { ArtifactDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3b-http-"));
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

/** 跑完整分析（mock 澄清后回答）→ 返回 proposals */
async function analyzeToProposals(projectId: string): Promise<ProposalDto[]> {
  const res = await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "analyze_requirement", payload: { description: "greenhouse monitor" } });
  expect(res.status).toBe(202);
  const { taskId } = res.body as { taskId: string };
  // mock 分析到澄清门（7 chunk × 30ms + 结构化）
  await new Promise((r) => setTimeout(r, 700));
  const clar = await request(app)
    .post(`/api/v1/commands/${taskId}/clarification`)
    .send({ roundId: 1, answer: "0.96 inch" });
  expect(clar.status).toBe(200);
  // 完成事件后提案已由 create_proposal 落库
  await new Promise((r) => setTimeout(r, 300));
  const list = await request(app).get(`/api/v1/projects/${projectId}/proposals`);
  expect(list.status).toBe(200);
  return list.body as ProposalDto[];
}

describe("S3B proposals surface", () => {
  it("分析完成 → proposals 列表（≥1，pending，引用 base）", async () => {
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0]?.status).toBe("pending");
    expect(proposals[0]?.type).toBe("requirement");
  });

  it("POST /proposals/:id/decision {reject} → 200；Reject 零 artifact 变化", async () => {
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    const res = await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "reject" });
    expect(res.status).toBe(200);
    const decided = res.body as ProposalDto;
    expect(decided.status).toBe("rejected");
    // 零版本：requirements artifact 无版本
    const artifactsRes = await request(app).get(`/api/v1/projects/${p.id}/artifacts`);
    const artifacts = artifactsRes.body as ArtifactDto[];
    const req = artifacts.find((a) => a.kind === "requirements");
    expect(req?.currentVersionId).toBeNull();
  });

  it("POST /proposals/:id/decision {accept} → 200；幂等同决策 no-op（历史不重复）", async () => {
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    const r1 = await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "accept" });
    const r2 = await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "accept" });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const d2 = r2.body as ProposalDto;
    expect(d2.status).toBe("accepted");
    expect(d2.decisionHistory?.length).toBe(1);
    void r1;
  });

  it("400 invalid_decision", async () => {
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    const res = await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_decision");
  });

  it("404 proposal 不存在", async () => {
    const res = await request(app)
      .post("/api/v1/proposals/no-such/decision")
      .send({ decision: "accept" });
    expect(res.status).toBe(404);
  });

  it("OutdatedProposal：手动改内容后旧提案 accept → 409（禁止静默应用）", async () => {
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    // 手动编辑 requirements artifact（产生 v1 → current 变更）
    const artifactsRes = await request(app).get(`/api/v1/projects/${p.id}/artifacts`);
    const artifacts = artifactsRes.body as ArtifactDto[];
    const req = artifacts.find((a) => a.kind === "requirements")!;
    await request(app)
      .post(`/api/v1/artifacts/${req.id}/versions`)
      .send({ content: JSON.stringify({ manual: true }) });
    const res = await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "accept" });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("outdated_proposal");
    expect(res.body.error?.details).toBeDefined();
  });

  it("proceed（commitRequirements 经 /projects/:pid/commands? 不——经 proceed 端点或内部）", async () => {
    // proceed 是"进入硬件选型"的落库动作；S3B 以 POST /projects/:pid/requirements/commit 暴露
    const p = await createProject();
    const proposals = await analyzeToProposals(p.id);
    await request(app)
      .post(`/api/v1/proposals/${proposals[0]!.id}/decision`)
      .send({ decision: "accept" });
    const res = await request(app).post(`/api/v1/projects/${p.id}/requirements/commit`);
    expect(res.status).toBe(200);
    const body = res.body as { version: { versionNo: number; sourceKind: string } };
    expect(body.version.versionNo).toBe(1);
    expect(body.version.sourceKind).toBe("proposal");
  });
});
