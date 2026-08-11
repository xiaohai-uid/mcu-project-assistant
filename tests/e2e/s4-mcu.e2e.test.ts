// e2e/golden-journey — S4 MCU Recommendation + Selection 全链（真实 HTTP）
// 对应 ISSUE-005 §12 Browser acceptance 的服务端等价路径；浏览器验收另由人工走查。
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
import type { ArtifactDto, ArtifactVersionDto, ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s4-e2e-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  const app = createApp({
    persistence,
    workspaceDir: join(dir, "ws"),
    content: createWorkspaceFilesContent(join(dir, "ws")),
    events,
    tasks: createInProcessTasks({ persistence, events }),
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

/** 分析 → 澄清 → accept 全部提案 → requirements v1 */
async function analyzeAndCommitRequirements(projectId: string): Promise<void> {
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
  await new Promise((r) => setTimeout(r, 500));
  const proposals = (await (await fetch(`${base}/api/v1/projects/${projectId}/proposals`)).json()) as ProposalDto[];
  for (const p of proposals) {
    await fetch(`${base}/api/v1/proposals/${p.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
  }
  const commit = await fetch(`${base}/api/v1/projects/${projectId}/requirements/commit`, { method: "POST" });
  expect(commit.status).toBe(200);
}

describe("S4 Golden Journey — MCU Recommendation + Selection end-to-end（真实 HTTP）", () => {
  it("候选矩阵 → 选择 ESP32-S3（Hardware v1）→ 切 RP2040（v2+changed）→ 同 MCU 幂等 → 重启后仍 RP2040 v2", async () => {
    // 1. 需求就绪
    const project = await createProject();
    await analyzeAndCommitRequirements(project.id);

    // 2. 候选矩阵（3 卡 + 约束警告对照无线需求）
    const rec = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "recommend_mcu", payload: {} }),
    });
    expect(rec.status).toBe(200);
    const recBody = (await rec.json()) as { candidates: Array<{ id: string; tier: string; constraints: string[] }> };
    expect(recBody.candidates.map((c) => c.id)).toEqual(["ESP32-S3", "RP2040", "STM32F401RE"]);
    expect(recBody.candidates[0]?.constraints).toEqual([]);
    expect(recBody.candidates[1]?.constraints.some((c) => /Wi-Fi/i.test(c))).toBe(true);

    // 3. 首选 ESP32-S3 → Hardware v1
    const sel1 = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } }),
    });
    const r1 = (await sel1.json()) as { artifact: ArtifactDto; version: ArtifactVersionDto; changed: boolean };
    expect(r1.version.versionNo).toBe(1);
    expect(r1.changed).toBe(false);
    expect(r1.artifact.currentVersionId).toBe(r1.version.id);

    // 4. 更换 RP2040 → v2 + changed=true
    const sel2 = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "select_mcu", payload: { mcuId: "RP2040" } }),
    });
    const r2 = (await sel2.json()) as { version: ArtifactVersionDto; changed: boolean };
    expect(r2.version.versionNo).toBe(2);
    expect(r2.changed).toBe(true);

    // 5. 同 MCU 幂等 → 仍 v2，无新版本
    const sel3 = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "select_mcu", payload: { mcuId: "RP2040" } }),
    });
    const r3 = (await sel3.json()) as { version: ArtifactVersionDto; changed: boolean };
    expect(r3.version.versionNo).toBe(2);
    expect(r3.changed).toBe(false);

    // 6. 刷新/重启 → Hardware 仍 RP2040 v2
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const hw = artifacts.find((a) => a.kind === "hardware")!;
    expect(hw.currentVersionId).toBe(r2.version.id);
    const v2 = (await (await fetch(`${base}/api/v1/versions/${r2.version.id}`)).json()) as {
      version: ArtifactVersionDto;
      content: string;
    };
    expect(JSON.parse(v2.content)).toMatchObject({ selectedMcuId: "RP2040" });
  });
});
