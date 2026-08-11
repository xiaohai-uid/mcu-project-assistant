// e2e/golden-journey — S6 Firmware Proposal + Diff 全链（真实 HTTP；对应 ISSUE-008 §12）
// Wiring 已校验 → generate_firmware（只产出提案）→ Diff（-IO12 → +IO21 + boot 风险）
// → Accept → 真实文件（workspace firmware/NNNN/src/main.cpp + platformio.ini）+ Firmware v1
//   + Pin Map v2（继电器 IO21）+ Wiring 联动 → Reject 路径零变化 → 引脚变更后旧提案 409 OutdatedProposal。
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
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ArtifactDto, ArtifactVersionDto, ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let ws: string;
let db: SqliteDb;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s6-e2e-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  const app = createApp({
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
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

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 完整前置：分析→澄清→accept→requirements v1→ESP32-S3→pinmap v1（IO12 冲突）→校验 */
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
  const gen = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_pin_map", payload: {} });
  const g = (await gen.json()) as { version: ArtifactVersionDto };
  await post(`/api/v1/versions/${g.version.id}/validations`);
  return project;
}

describe("S6 Golden Journey — Firmware Proposal + Diff end-to-end（真实 HTTP）", () => {
  it("生成 → Diff 提案 → Accept → 真实文件 + Firmware v1 + Pin Map v2（IO21）→ Reject 零变化 → OutdatedProposal", async () => {
    const project = await seedJourney();

    // 1. generate_firmware：只产出 Proposal（I-1）；Diff 可见（-IO12 → +IO21 + boot 风险）
    const gen = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_firmware", payload: {} });
    expect(gen.status).toBe(200);
    const { proposal } = (await gen.json()) as { proposal: ProposalDto };
    expect(proposal.type).toBe("firmware");
    expect(proposal.status).toBe("pending");
    expect(proposal.diff).toMatchObject({ oldPin: "IO12", newPin: "IO21", bootRisk: true });
    const files = JSON.parse(proposal.payload) as { "src/main.cpp": string; "platformio.ini": string };
    expect(files["src/main.cpp"]).toContain("#define PUMP_RELAY_PIN   21");

    // 2. Accept → T2：真实文件 + Firmware v1 + Pin Map v2（继电器 IO21）+ Wiring 联动
    const decide = await post(`/api/v1/proposals/${proposal.id}/decision`, { decision: "accept" });
    expect(decide.status).toBe(200);
    const artifacts = (await (await fetch(`${base}/api/v1/projects/${project.id}/artifacts`)).json()) as ArtifactDto[];
    const fw = artifacts.find((a) => a.kind === "firmware")!;
    const fwVersions = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as ArtifactVersionDto[];
    expect(fwVersions.length).toBe(1);
    const fwV1 = fwVersions[0]!;
    expect(fwV1.sourceKind).toBe("proposal");
    expect(fwV1.sourceProposalId).toBe(proposal.id);
    // 真实文件存在且可读（Git-friendly；固件源码不在 SQLite——contentRef 指向 main.cpp 文件）
    const mainPath = join(ws, fwV1.contentRef);
    expect(existsSync(mainPath)).toBe(true);
    const code = readFileSync(mainPath, "utf8");
    expect(code).toContain("MCU Project Assistant Generated Firmware");
    expect(code).toContain("#define PUMP_RELAY_PIN   21");
    expect(fwV1.contentRef).toMatch(/firmware\/\d{4}\/src\/main\.cpp$/);
    expect(existsSync(mainPath.replace("src/main.cpp", "platformio.ini"))).toBe(true);
    // 联动：Pin Map v2 继电器 IO21
    const pm = artifacts.find((a) => a.kind === "pinmap")!;
    const pmVersions = (await (await fetch(`${base}/api/v1/artifacts/${pm.id}/versions`)).json()) as ArtifactVersionDto[];
    expect(pmVersions.length).toBe(2);
    const pmV2 = pmVersions[1]!;
    const pmResp = await fetch(`${base}/api/v1/versions/${pmV2.id}`);
    const { content: pmContent } = (await pmResp.json()) as { content: string };
    const pinMap = (JSON.parse(pmContent) as { pinMap: Array<{ component: string; pinId: string }> }).pinMap;
    expect(pinMap.find((p) => /pump|relay/i.test(p.component))?.pinId).toBe("IO21");
    // 联动：Wiring 有版本
    const wiring = artifacts.find((a) => a.kind === "wiring")!;
    expect(wiring.currentVersionId).toBeTruthy();

    // 3. 再次生成（改回 IO12 场景不成立——已 IO21；直接验证 Reject 路径零变化）
    const gen2 = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_firmware", payload: {} });
    const { proposal: proposal2 } = (await gen2.json()) as { proposal: ProposalDto };
    const reject = await post(`/api/v1/proposals/${proposal2.id}/decision`, { decision: "reject" });
    expect(reject.status).toBe(200);
    const fwVersionsAfter = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as ArtifactVersionDto[];
    expect(fwVersionsAfter.length).toBe(1); // Reject 零版本变化（I-3）

    // 4. OutdatedProposal（固件）：手动改引脚后旧提案 accept → 409
    const gen3 = await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_firmware", payload: {} });
    const { proposal: proposal3 } = (await gen3.json()) as { proposal: ProposalDto };
    // 期间手动改继电器引脚（S2 路径 → pinmap v3）
    await post(`/api/v1/artifacts/${pm.id}/versions`, {
      content: JSON.stringify({
        pinMap: pinMap.map((p) => (/pump|relay/i.test(p.component) ? { ...p, pinId: "IO5" } : p)),
        issues: [],
      }),
    });
    const outdated = await post(`/api/v1/proposals/${proposal3.id}/decision`, { decision: "accept" });
    expect(outdated.status).toBe(409);
    expect(((await outdated.json()) as { error: { code: string } }).error.code).toBe("outdated_proposal");
  });
});
