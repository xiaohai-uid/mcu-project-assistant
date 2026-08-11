// e2e/golden-journey — S8 Failure Diagnosis + Fix 全链（真实 HTTP；对应 ISSUE-010 §12；deterministic compiler）
// Build FAILED（失败脚本）→ 诊断（原因/建议/Fix 提案）→ Accept → Firmware v+1（platformio.ini 真实文件 lib_deps）
// → 重建成功（新 BuildRecord）→ 三模型分离断言 → Reject 路径零变化。
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
  dir = mkdtempSync(join(tmpdir(), "mcu-s8-e2e-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  handle = createMockCompilerHandle({
    lines: ["$ arduino-cli compile ...", "[ERR] src/main.cpp:12:9: error: 'Adafruit_SSD1306.h' not found"],
    exitCode: 1,
  });
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

async function seedFirmware(): Promise<{ projectId: string; versionId: string; fwId: string }> {
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
  const fw = (await (await post(`/api/v1/projects/${project.id}/artifacts`, { kind: "firmware" })).json()) as { id: string };
  await post(`/api/v1/artifacts/${fw.id}/versions`, {
    content: JSON.stringify({
      "src/main.cpp": "#include <Adafruit_SSD1306.h>\nvoid setup(){}",
      "platformio.ini": "[env:esp32s3]\nplatform = espressif32\nboard = esp32-s3-devkitc-1\nframework = arduino\n",
    }),
  });
  const versions = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as Array<{ id: string; versionNo: number }>;
  return { projectId: project.id, versionId: versions[versions.length - 1]!.id, fwId: fw.id };
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

describe("S8 Golden Journey — Diagnosis + Fix end-to-end（真实 HTTP + deterministic compiler）", () => {
  it("BUILD FAILED → 诊断 → 修复提案 Accept → Firmware v2（lib_deps）→ 重建成功 → 三模型分离", async () => {
    const { projectId, versionId, fwId } = await seedFirmware();
    const fwVersionsBefore = ((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length;

    // 1. BUILD FAILED（失败脚本）
    const run = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    const { buildId } = (await run.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(buildId)).status === "failed");
    expect((await buildStatus(buildId)).exitCode).toBe(1);
    // D2：Build 失败不改版本
    expect(((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length).toBe(fwVersionsBefore);

    // 2. 诊断 → 诊断卡 + build_fix 提案（pending；不写版本）
    const diag = await post(`/api/v1/builds/${buildId}/diagnose`);
    expect(diag.status).toBe(200);
    const { diagnosis, proposal } = (await diag.json()) as {
      diagnosis: { cause: string; fix: string; proposal: { file: string; proposalId: string } };
      proposal: ProposalDto;
    };
    expect(diagnosis.cause).toContain("Adafruit_SSD1306");
    expect(diagnosis.proposal.file).toBe("platformio.ini");
    expect(proposal.status).toBe("pending");
    expect(((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length).toBe(fwVersionsBefore);

    // 3. Accept 修复提案 → Firmware v2（platformio.ini 真实文件 +lib_deps；恰一版本）
    const decide = await post(`/api/v1/proposals/${proposal.id}/decision`, { decision: "accept" });
    expect(decide.status).toBe(200);
    const fwVersions = (await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as Array<{ id: string; versionNo: number; contentRef: string }>;
    expect(fwVersions.length).toBe(fwVersionsBefore + 1);
    const v2 = fwVersions[fwVersions.length - 1]!;
    expect(v2.versionNo).toBe(fwVersionsBefore + 1);
    const pio = readFileSync(join(ws, v2.contentRef.replace("src/main.cpp", "platformio.ini")), "utf8");
    expect(pio).toContain("lib_deps");
    expect(pio).toContain("Adafruit SSD1306@^2.5.10");

    // 4. 重建（工具链恢复）→ BUILD SUCCESS（新 BuildRecord；版本不再增加）
    handle.setScript({ lines: ["[OK] Compiling sketch...", "[OK] Linking...", "[OK] Build complete"], exitCode: 0 });
    const rebuild = await post(`/api/v1/projects/${projectId}/builds`, { versionId: v2.id });
    const { buildId: rebuildId } = (await rebuild.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(rebuildId)).status === "succeeded");
    expect(((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length).toBe(fwVersionsBefore + 1);
    // 历史：失败（v1）+ 成功（v2）两条 BuildRecord（三模型分离：版本只增一次）
    const failHistory = (await (await fetch(`${base}/api/v1/versions/${versionId}/builds`)).json()) as BuildRecordDto[];
    expect(failHistory.some((b) => b.status === "failed")).toBe(true);
    const okHistory = (await (await fetch(`${base}/api/v1/versions/${v2.id}/builds`)).json()) as BuildRecordDto[];
    expect(okHistory.some((b) => b.status === "succeeded")).toBe(true);
  });

  it("Reject 修复提案 → 版本不变（I-3）；重试诊断路径可用（幂等返回既有提案）", async () => {
    const { projectId, versionId, fwId } = await seedFirmware();
    handle.setScript({
      lines: ["$ arduino-cli compile ...", "[ERR] src/main.cpp:12:9: error: 'Adafruit_SSD1306.h' not found"],
      exitCode: 1,
    });
    const fwVersionsBefore = ((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length;
    const run = await post(`/api/v1/projects/${projectId}/builds`, { versionId });
    const { buildId } = (await run.json()) as { buildId: string };
    await waitFor(async () => (await buildStatus(buildId)).status === "failed");
    const diag = await post(`/api/v1/builds/${buildId}/diagnose`);
    const { proposal } = (await diag.json()) as { proposal: ProposalDto };
    // 幂等：再次诊断 → 同一提案
    const again = await post(`/api/v1/builds/${buildId}/diagnose`);
    const { proposal: proposalAgain } = (await again.json()) as { proposal: ProposalDto };
    expect(proposalAgain.id).toBe(proposal.id);
    // Reject → 零版本变化
    const reject = await post(`/api/v1/proposals/${proposal.id}/decision`, { decision: "reject" });
    expect(reject.status).toBe(200);
    expect(((await (await fetch(`${base}/api/v1/artifacts/${fwId}/versions`)).json()) as unknown[]).length).toBe(fwVersionsBefore);
  });
});
