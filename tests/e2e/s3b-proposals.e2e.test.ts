// e2e/golden-journey — S3B Proposal Accept/Reject 全链（真实 HTTP）
// 对应 ISSUE-004 §12 Browser acceptance 的服务端等价路径；浏览器验收另由人工走查。
import { mkdtempSync, rmSync } from "node:fs";
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
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ArtifactDto, ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let dbPath: string;
let workspaceDir: string;
let db: SqliteDb;
let db2: SqliteDb | null = null;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3b-e2e-"));
  dbPath = join(dir, "test.db");
  workspaceDir = join(dir, "ws");
  db = openDatabase(dbPath);
  migrate(db);
  const persistence = createProjectStore(db);
  const app = createApp({
    persistence,
    workspaceDir,
    content: createWorkspaceFilesContent(workspaceDir),
    events: createSseEvents(),
    tasks: createInProcessTasks({ persistence, events: createSseEvents() }),
    compiler: createMockCompiler(),
    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    db.close();
  } catch {
    // already closed
  }
  try {
    db2?.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(): Promise<ProjectDto> {
  const res = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Greenhouse" }),
  });
  return (await res.json()) as ProjectDto;
}

/** 跑完整分析 → 回答澄清 → 等提案落库 */
async function analyzeToProposals(projectId: string): Promise<ProposalDto[]> {
  const res = await fetch(`${base}/api/v1/projects/${projectId}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse monitor" } }),
  });
  const { taskId } = (await res.json()) as { taskId: string };
  await new Promise((r) => setTimeout(r, 700));
  await fetch(`${base}/api/v1/commands/${taskId}/clarification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roundId: 1, answer: "0.96 inch" }),
  });
  await new Promise((r) => setTimeout(r, 400));
  return (await (await fetch(`${base}/api/v1/projects/${projectId}/proposals`)).json()) as ProposalDto[];
}

describe("S3B Golden Journey — Proposal Accept/Reject end-to-end（真实 HTTP）", () => {
  it("分析 → 提案卡（3 条 pending）→ 拒绝 #01（零变化）→ 接受 #03 → proceed → requirements v1 聚合落库", async () => {
    // 1. 创建项目 + 分析到提案
    const project = await createProject();
    const proposals = await analyzeToProposals(project.id);
    expect(proposals.length).toBe(3);
    expect(proposals.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(proposals.every((p) => p.status === "pending")).toBe(true);

    // 2. 拒绝 #01 → 零版本变化（requirements current 仍 null）
    const rejectRes = await fetch(`${base}/api/v1/proposals/${proposals[0]!.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "reject" }),
    });
    expect(rejectRes.status).toBe(200);
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const req = artifacts.find((a) => a.kind === "requirements")!;
    expect(req.currentVersionId).toBeNull(); // Reject 零效果（I-3）

    // 3. 接受 #03 → 仅决策（仍零版本）
    const acceptRes = await fetch(`${base}/api/v1/proposals/${proposals[2]!.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(acceptRes.status).toBe(200);
    const decided = (await acceptRes.json()) as ProposalDto;
    expect(decided.status).toBe("accepted");
    expect(decided.decisionHistory).toHaveLength(1);

    // 4. proceed（进入硬件选型）→ requirements v1 聚合落库
    const commitRes = await fetch(`${base}/api/v1/projects/${project.id}/requirements/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(commitRes.status).toBe(200);
    const { artifact, version } = (await commitRes.json()) as {
      artifact: ArtifactDto;
      version: { versionNo: number; sourceKind: string; id: string };
    };
    expect(version.versionNo).toBe(1);
    expect(version.sourceKind).toBe("proposal");
    expect(artifact.currentVersionId).toBe(version.id);

    // 5. 提案历史可见决策记录（决策可逆且保留）
    const after = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
    const p1 = after.find((p) => p.id === proposals[0]!.id)!;
    const p3 = after.find((p) => p.id === proposals[2]!.id)!;
    expect(p1.status).toBe("rejected");
    expect(p3.status).toBe("accepted");
    expect(p3.decisionHistory.length).toBe(1);

    // 6. 重启后：requirements v1 仍在（版本 + current 指针持久）
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db2 = openDatabase(dbPath);
    migrate(db2);
    const app2 = createApp({
      persistence: createProjectStore(db2),
      workspaceDir,
      content: createWorkspaceFilesContent(workspaceDir),
      events: createSseEvents(),
      tasks: createInProcessTasks({ persistence: createProjectStore(db2!), events: createSseEvents() }),
      compiler: createMockCompiler(),
      ai: createMockAiProvider({ slow: false }),
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    server = app2.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const afterRestart = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const reqAfter = afterRestart.find((a) => a.kind === "requirements")!;
    expect(reqAfter.currentVersionId).toBe(version.id);
    // db2 保持打开（restart 后服务器继续使用；进程退出时清理）
  });

  it("OutdatedProposal：手动改内容后旧提案 accept → 409（禁止静默应用）", async () => {
    const project = await createProject();
    const proposals = await analyzeToProposals(project.id);
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const req = artifacts.find((a) => a.kind === "requirements")!;
    // 手动编辑 → requirements v1（current 变更）
    await fetch(`${base}/api/v1/artifacts/${req.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: JSON.stringify({ manual: true }) }),
    });
    const res = await fetch(`${base}/api/v1/proposals/${proposals[0]!.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe("outdated_proposal");
    expect(body.error.details.baseVersionId).toBeNull();
    expect(body.error.details.currentVersionId).not.toBeNull();
  });
});
