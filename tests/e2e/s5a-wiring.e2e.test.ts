// e2e/golden-journey — S5A Pin Map + Wiring Generation & Validation 全链（真实 HTTP）
// 对应 ISSUE-006 §12 Browser acceptance 的服务端等价路径；浏览器验收另由人工走查。
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
import type { ArtifactDto, ArtifactVersionDto, ProjectDto, ProposalDto, ValidationRecordDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s5a-e2e-"));
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

/** 完整前置：分析→澄清→accept 全部→requirements v1→select ESP32-S3 */
async function seedJourney(): Promise<ProjectDto> {
  const create = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Greenhouse" }),
  });
  const project = (await create.json()) as ProjectDto;
  const res = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
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
  const proposals = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
  for (const p of proposals) {
    await fetch(`${base}/api/v1/proposals/${p.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
  }
  await fetch(`${base}/api/v1/projects/${project.id}/requirements/commit`, { method: "POST" });
  await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } }),
  });
  return project;
}

describe("S5A Golden Journey — Pin Map + Wiring Validation end-to-end（真实 HTTP）", () => {
  it("generate_pin_map → IO12 strapping 冲突 → validate warn → 手动改 IO21 → 保留身份待决（ValidationRecord 历史）", async () => {
    const project = await seedJourney();

    // 1. 生成引脚分配（IO4/IO12/IO8/IO9 + IO12 strapping 冲突卡）
    const gen = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "generate_pin_map", payload: {} }),
    });
    expect(gen.status).toBe(200);
    const g = (await gen.json()) as { pinMap: Array<{ component: string; pinId: string; type: string }>; issues: Array<{ pinId: string; severity: string }>; version: ArtifactVersionDto; artifact: ArtifactDto };
    const pins = g.pinMap.map((p) => p.pinId);
    expect(pins).toContain("IO4");
    expect(pins).toContain("IO12");
    expect(pins).toContain("IO8");
    expect(g.issues.some((i) => i.pinId === "IO12" && i.severity === "warning")).toBe(true);
    expect(g.version.versionNo).toBe(1);

    // 2. 校验（IO12 strapping → warn；未运行≠通过）
    const v1 = await fetch(`${base}/api/v1/versions/${g.version.id}/validations`, { method: "POST" });
    expect(v1.status).toBe(201);
    const rec1 = (await v1.json()) as ValidationRecordDto;
    expect(rec1.result).toBe("warn");
    expect(rec1.diagnostics.some((d) => d.code === "STRAPPING_PIN_USAGE")).toBe(true);
    const hist1 = (await (await fetch(`${base}/api/v1/versions/${g.version.id}/validations`)).json()) as ValidationRecordDto;
    expect(hist1.id).toBe(rec1.id); // 历史可见

    // 3. 手动编辑：继电器 IO12 → IO21（S2 手动路径）→ pinmap v2
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const pinmap = artifacts.find((a) => a.kind === "pinmap")!;
    const versionDetail = (await (await fetch(`${base}/api/v1/versions/${g.version.id}`)).json()) as { content: string };
    const existingContent = JSON.parse(versionDetail.content) as Record<string, unknown>;
    const newContent = JSON.stringify({
      ...existingContent,
      pinMap: g.pinMap.map((p) => (p.component.includes("Pump") ? { ...p, pinId: "IO21" } : p)),
    });
    const edit = await fetch(`${base}/api/v1/artifacts/${pinmap.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });
    expect(edit.status).toBe(201);
    const v2 = (await edit.json()) as ArtifactVersionDto;
    expect(v2.versionNo).toBe(2);

    // 4. 再次校验 → warn（strapping 消除，但未决器件身份仍阻断生产接线结论）
    const v2rec = await fetch(`${base}/api/v1/versions/${v2.id}/validations`, { method: "POST" });
    expect(v2rec.status).toBe(201);
    const rec2 = (await v2rec.json()) as ValidationRecordDto;
    expect(rec2.result).toBe("warn");
    expect(rec2.diagnostics.some((d) => d.code === "COMPONENT_IDENTITY_PENDING")).toBe(true);

    // 5. 刷新等价：v1 校验历史仍 warn（记录按版本分离，I-7）
    const v1hist = (await (await fetch(`${base}/api/v1/versions/${g.version.id}/validations`)).json()) as ValidationRecordDto;
    expect(v1hist.result).toBe("warn");
  });

  it("无 MCU → 409 no_hardware_selected", async () => {
    const create = await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Empty" }),
    });
    const project = (await create.json()) as ProjectDto;
    const res = await fetch(`${base}/api/v1/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "generate_pin_map", payload: {} }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_hardware_selected");
  });
});
