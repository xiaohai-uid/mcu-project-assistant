// e2e/golden-journey — S5B Stale Propagation + Revalidate 全链（真实 HTTP；对应 ISSUE-007 §12）
// 换 MCU → 传递闭包 L3 marks → 侧栏/横幅数据（stale-marks）→ 门禁 409 blocking_stale
// → revalidate_artifact 逐项（无语义变化→Validated；有语义变化→提案不自动接受）→ 决策后全部恢复。
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
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ArtifactDto, ArtifactVersionDto, ProjectDto, ProposalDto, StaleMarkDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s5b-e2e-"));
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
    device: createCompanionLocalDevice(),

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

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 完整前置：分析→澄清→accept 全部→requirements v1→ESP32-S3→pinmap v1→wiring/firmware 手动占位 v1 */
async function seedJourney(): Promise<ProjectDto> {
  const create = await post("/api/v1/projects", { name: "Greenhouse" });
  const project = (await create.json()) as ProjectDto;
  const res = await post(`/api/v1/projects/${project.id}/commands`, {
    capability: "analyze_requirement",
    payload: { description: "greenhouse monitor" },
  });
  const { taskId } = (await res.json()) as { taskId: string };
  await new Promise((r) => setTimeout(r, 700));
  await post(`/api/v1/commands/${taskId}/clarification`, { roundId: 1, answer: "0.96 inch" });
  await new Promise((r) => setTimeout(r, 500));
  const proposals = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
  for (const p of proposals) {
    await post(`/api/v1/proposals/${p.id}/decision`, { decision: "accept" });
  }
  await post(`/api/v1/projects/${project.id}/requirements/commit`);
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_pin_map", payload: {} });
  // S5B 前置（S6/S7 前用 S2 手动路径建立下游 artifact；固件/接线占位内容）
  const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
  for (const kind of ["wiring", "firmware"]) {
    const ensure = await post(`/api/v1/projects/${project.id}/artifacts`, { kind });
    const a = ensure.status === 201 ? ((await ensure.json()) as ArtifactDto) : artifacts.find((x) => x.kind === kind)!;
    await post(`/api/v1/artifacts/${a.id}/versions`, {
      content: kind === "wiring" ? JSON.stringify({ wiring: [] }) : JSON.stringify({ code: "// v1 placeholder" }),
    });
  }
  return project;
}

async function staleMarks(projectId: string): Promise<Array<StaleMarkDto & { kind: string }>> {
  const res = await fetch(`${base}/api/v1/projects/${projectId}/stale-marks`);
  return ((await res.json()) as { marks: Array<StaleMarkDto & { kind: string }> }).marks;
}

describe("S5B Golden Journey — Stale Propagation + Revalidate end-to-end（真实 HTTP）", () => {
  it("换 MCU → 传递闭包 L3 marks → 门禁 409 → revalidate 逐项 → 决策后全部恢复", async () => {
    const project = await seedJourney();

    // 1. 换 MCU（RP2040）→ 事务内依赖求值：pinmap/wiring/firmware L3（传递闭包；I-4 不删除下游）
    const swap = await post(`/api/v1/projects/${project.id}/commands`, {
      capability: "select_mcu",
      payload: { mcuId: "RP2040" },
    });
    expect(swap.status).toBe(200);
    const marks1 = await staleMarks(project.id);
    const kinds1 = marks1.map((m) => m.kind).sort();
    expect(kinds1).toEqual(["firmware", "pinmap", "wiring"].sort());
    expect(marks1.every((m) => m.level === "L3" && m.resolvedAt === null)).toBe(true);

    // 2. 门禁（I-8 / 门禁矩阵）：L3 下标记 Validation 成功 → 409 blocking_stale
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const pinmap = artifacts.find((a) => a.kind === "pinmap")!;
    const versions = (await (await fetch(`${base}/api/v1/artifacts/${pinmap.id}/versions`)).json()) as ArtifactVersionDto[];
    const current = versions[versions.length - 1]!;
    const gate = await post(`/api/v1/versions/${current.id}/validations`);
    expect(gate.status).toBe(409);
    expect(((await gate.json()) as { error: { code: string } }).error.code).toBe("blocking_stale");

    // 3. 按新决策重新生成 pinmap（决策同源：v2 = RP2040 分配；同时验证合并语义——不产生重复 mark）
    const regen = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_pin_map", payload: {} });
    expect(regen.status).toBe(200);
    expect((await staleMarks(project.id)).length).toBe(3);

    // 4. revalidate_artifact（all）：pinmap/wiring → validated；firmware（占位重算 ≠ 手动内容）→ proposal_created（D1 不自动接受）
    const reval = await post(`/api/v1/projects/${project.id}/commands`, { capability: "revalidate_artifact", payload: {} });
    expect(reval.status).toBe(200);
    const { results } = (await reval.json()) as {
      results: Array<{ kind: string; outcome: string; proposalId?: string }>;
    };
    const byKind = Object.fromEntries(results.map((r) => [r.kind, r]));
    expect(byKind["pinmap"]?.outcome).toBe("validated");
    expect(byKind["wiring"]?.outcome).toBe("validated");
    expect(byKind["firmware"]?.outcome).toBe("proposal_created");
    const firmwareProposalId = byKind["firmware"]?.proposalId;
    expect(firmwareProposalId).toBeTruthy();
    // 提案 pending（等待决策——不自动接受）
    const pending = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
    const fwProposal = pending.find((p) => p.id === firmwareProposalId)!;
    expect(fwProposal.status).toBe("pending");

    // 5. 决策：接受固件提案 → 该 artifact 的 Stale 解除 → 横幅数据清空
    const decide = await post(`/api/v1/proposals/${firmwareProposalId}/decision`, { decision: "accept" });
    expect(decide.status).toBe(200);
    expect(await staleMarks(project.id)).toHaveLength(0);
  });

  it("无 stale 时 revalidate → 409 no_stale（无操作对象）", async () => {
    const project = await seedJourney();
    const res = await post(`/api/v1/projects/${project.id}/commands`, { capability: "revalidate_artifact", payload: {} });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_stale");
  });
});
