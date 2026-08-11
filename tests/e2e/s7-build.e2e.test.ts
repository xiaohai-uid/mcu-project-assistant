// e2e/golden-journey — S7 Build 全链（真实 HTTP；对应 ISSUE-009 §12；工具链 = deterministic mock——
// 本机无 arduino-cli：编译成功/失败流程以 mock 编译适配器确定性覆盖；工具链缺失 503 由真实适配器浏览器验收）
// Firmware v1（S6 接受路径）→ run_build → BUILD SUCCESS（逐行日志 + .build 证据）→ Build #2 同版本
// → 失败脚本 → BUILD FAILED 记录 → 取消 → 终态不可取消 → L3 stale 门禁 409。
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompilerHandle } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { BuildRecordDto, ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let ws: string;
let db: SqliteDb;
let server: Server;
let base: string;
let handle: ReturnType<typeof createMockCompilerHandle>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s7-e2e-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  handle = createMockCompilerHandle();
  const app = createApp({
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: handle.compiler,
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

/** 前置：分析→accept→ESP32-S3→pinmap→固件生成提案→Accept（真实文件 firmware v1） */
async function seedFirmware(): Promise<{ projectId: string; versionId: string }> {
  const create = await post("/api/v1/projects", { name: "Greenhouse" });
  const project = (await create.json()) as ProjectDto;
  const res = await post(`/api/v1/projects/${project.id}/commands`, {
    capability: "analyze_requirement",
    payload: { description: "greenhouse monitor" },
  });
  const { taskId } = (await res.json()) as { taskId: string };
  await new Promise((r) => setTimeout(r, 700));
  await post(`/api/v1/commands/${taskId}/clarification`, { roundId: 1, answer: "0.96 inch" });
  await new Promise((r) => setTimeout(r, 400));
  const proposals = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
  for (const p of proposals) {
    await post(`/api/v1/proposals/${p.id}/decision`, { decision: "accept" });
  }
  await post(`/api/v1/projects/${project.id}/requirements/commit`);
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_pin_map", payload: {} });
  const gen = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_firmware", payload: {} });
  const { proposal } = (await gen.json()) as { proposal: ProposalDto };
  await post(`/api/v1/proposals/${proposal.id}/decision`, { decision: "accept" });
  const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as Array<{ id: string; kind: string }>;
  const fw = artifacts.find((a) => a.kind === "firmware")!;
  const versions = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as Array<{ id: string; versionNo: number }>;
  return { projectId: project.id, versionId: versions[versions.length - 1]!.id };
}

const waitFor = async (fn: () => Promise<boolean>, ms = 4000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
};

async function buildStatus(buildId: string): Promise<BuildRecordDto> {
  return (await (await fetch(`${base}/api/v1/builds/${buildId}`)).json()) as BuildRecordDto;
}

describe("S7 Golden Journey — Build end-to-end（真实 HTTP + deterministic compiler）", () => {
  it("编译 → BUILD SUCCESS（逐行日志/.build 证据/记录）→ Build #2 同版本 → 失败 → 取消 → 门禁", async () => {
    const { projectId, versionId } = await seedFirmware();
    const fwArtifact = (await (await fetch(`${base}/api/v1/projects/${projectId}/artifacts`)).json()) as Array<{ id: string; kind: string }>;
    const fwId = fwArtifact.find((a) => a.kind === "firmware")!.id;
    const fwVersionsBefore = ((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length;

    // 1. 编译 → 202 → succeeded（mock 编译脚本：CMake→编译→链接→镜像→用量）
    const run = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    expect(run.status).toBe(202);
    const { buildId } = (await run.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(buildId)).status === "succeeded");
    const done = await buildStatus(buildId);
    expect(done.exitCode).toBe(0);
    expect(done.stdoutRef).toContain(".build");
    // .build/<buildId>.log 真实证据（DB 只存 ref）
    expect(existsSync(join(ws, done.stdoutRef!))).toBe(true);
    const log = readFileSync(join(ws, done.stdoutRef!), "utf8");
    expect(log).toContain("Compiling sketch");
    expect(log).toContain("Memory usage: RAM 22.4% / Flash 31.8%");
    expect(log).toContain("Build complete");

    // 2. Build #2（同一固件版本；同版本多记录；Firmware 版本数不变——D2）
    const run2 = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    const { buildId: buildId2 } = (await run2.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(buildId2)).status === "succeeded");
    const history = (await (await fetch(`${base}/api/v1/versions/${versionId}/builds`)).json()) as BuildRecordDto[];
    expect(history.length).toBe(2);
    const fwVersionsAfter = ((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length;
    expect(fwVersionsAfter).toBe(fwVersionsBefore);

    // 3. 失败脚本 → BUILD FAILED 记录（I-6 失败也落记录）
    handle.setScript({
      lines: ["$ arduino-cli compile --fqbn esp32:esp32:esp32s3 src", "[ERR] src/main.cpp:12:9: error: 'PUMP_RELAY_PIN' was not declared"],
      exitCode: 1,
    });
    const run3 = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    const { buildId: buildId3 } = (await run3.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(buildId3)).status === "failed");
    const failed = await buildStatus(buildId3);
    expect(failed.exitCode).toBe(1);
    expect(readFileSync(join(ws, failed.stdoutRef!), "utf8")).toContain("error:");

    // 4. 取消（慢脚本）：running → cancelled；终态再取消 409
    handle.setScript({ lines: Array.from({ length: 20 }, (_, i) => `line ${i}`), lineDelayMs: 40 });
    const run4 = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    const { buildId: buildId4 } = (await run4.json()) as { buildId: string };
    await new Promise((r) => setTimeout(r, 80));
    const cancel = await post(`/api/v1/builds/${buildId4}/cancel`);
    expect(cancel.status).toBe(202);
    await waitFor(async () => (await buildStatus(buildId4)).status === "cancelled");
    const again = await post(`/api/v1/builds/${buildId4}/cancel`);
    expect(again.status).toBe(409);

    // 5. L3 stale 门禁：换 MCU → 编译 409 blocking_stale（I-8）
    handle.setScript({ lines: ["[OK] Build complete"], exitCode: 0 });
    await post(`/api/v1/projects/${projectId}/commands`, { capability: "select_mcu", payload: { mcuId: "RP2040" } });
    const gated = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    expect(gated.status).toBe(409);
    expect(((await gated.json()) as { error: { code: string } }).error.code).toBe("blocking_stale");
  });

  it("工具链缺失 → 503 toolchain_unavailable（真实适配器 discover 行为）", async () => {
    handle.setUnavailable(true);
    const { projectId, versionId } = await seedFirmware();
    const res = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("toolchain_unavailable");
    handle.setUnavailable(false);
  });
});
