// contract/http/firmware — S6 固件提案 surface（ISSUE-008 §11）
// /commands generate_firmware（只产出 Proposal）；/proposals/:id/decision 固件场景
// （Accept → 真实文件 + 联动版本；Reject 零变化；OutdatedProposal 409；L3 门禁 409）。
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ArtifactDto, ArtifactVersionDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;
let ws: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s6-http-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),

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

async function seedToPinMap(projectId: string): Promise<void> {
  await analyzeToRequirements(projectId);
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "generate_pin_map", payload: {} });
}

async function artifactsOf(projectId: string): Promise<ArtifactDto[]> {
  return ((await request(app).get(`/api/v1/projects/${projectId}/artifacts`)).body) as ArtifactDto[];
}

describe("S6 firmware proposal surface", () => {
  it("generate_firmware → Proposal（diff IO12→IO21，pending；不写版本）", async () => {
    const projectId = await createProject();
    await seedToPinMap(projectId);
    const versionsBefore = (await artifactsOf(projectId)).filter((a) => a.currentVersionId).length;

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_firmware", payload: {} });
    expect(res.status).toBe(200);
    const { proposal } = res.body as { proposal: ProposalDto };
    expect(proposal.type).toBe("firmware");
    expect(proposal.status).toBe("pending");
    expect(proposal.diff).toMatchObject({ oldPin: "IO12", newPin: "IO21" });
    const files = JSON.parse(proposal.payload) as { "src/main.cpp": string; "platformio.ini": string };
    expect(files["src/main.cpp"]).toContain("#include <Arduino.h>");
    // I-1：只产出提案，不写版本
    expect((await artifactsOf(projectId)).filter((a) => a.currentVersionId).length).toBe(versionsBefore);
  });

  it("Accept → 真实文件（src/main.cpp + platformio.ini）+ Firmware v1 + Pin Map v2（IO21）+ Wiring 联动", async () => {
    const projectId = await createProject();
    await seedToPinMap(projectId);
    const gen = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_firmware", payload: {} });
    const { proposal } = gen.body as { proposal: ProposalDto };

    const decide = await request(app)
      .post(`/api/v1/proposals/${proposal.id}/decision`)
      .send({ decision: "accept" });
    expect(decide.status).toBe(200);

    const artifacts = await artifactsOf(projectId);
    const fw = artifacts.find((a) => a.kind === "firmware")!;
    const versions = ((await request(app).get(`/api/v1/artifacts/${fw.id}/versions`)).body) as ArtifactVersionDto[];
    expect(versions.length).toBe(1);
    const fwV1 = versions[0]!;
    expect(fwV1.versionNo).toBe(1);
    expect(fwV1.sourceKind).toBe("proposal");
    // 真实文件存在且可读（Git-friendly；固件源码不在 SQLite）
    const mainPath = join(ws, fwV1.contentRef);
    expect(existsSync(mainPath)).toBe(true);
    const code = readFileSync(mainPath, "utf8");
    expect(code).toContain("#define PUMP_RELAY_PIN   21");
    expect(existsSync(mainPath.replace("src/main.cpp", "platformio.ini"))).toBe(true);
    // 联动：Pin Map v2 继电器 IO21
    const pm = artifacts.find((a) => a.kind === "pinmap")!;
    const pmVersions = ((await request(app).get(`/api/v1/artifacts/${pm.id}/versions`)).body) as ArtifactVersionDto[];
    expect(pmVersions.length).toBe(2);
    const pmV2 = pmVersions[1]!;
    const pmContent = await request(app).get(`/api/v1/versions/${pmV2.id}`);
    const body = pmContent.body as { content: string };
    const pinMap = (JSON.parse(body.content) as { pinMap: Array<{ component: string; pinId: string }> }).pinMap;
    expect(pinMap.find((p) => /pump|relay/i.test(p.component))?.pinId).toBe("IO21");
    // 联动：Wiring 有版本
    const wiring = artifacts.find((a) => a.kind === "wiring")!;
    expect(wiring.currentVersionId).toBeTruthy();
  });

  it("Reject → 零版本变化 + 提案 rejected", async () => {
    const projectId = await createProject();
    await seedToPinMap(projectId);
    const gen = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_firmware", payload: {} });
    const { proposal } = gen.body as { proposal: ProposalDto };

    const decide = await request(app)
      .post(`/api/v1/proposals/${proposal.id}/decision`)
      .send({ decision: "reject" });
    expect(decide.status).toBe(200);
    expect((decide.body as ProposalDto).status).toBe("rejected");

    const artifacts = await artifactsOf(projectId);
    const fw = artifacts.find((a) => a.kind === "firmware")!;
    expect(fw.currentVersionId).toBeNull(); // 零版本变化（I-3）
  });

  it("OutdatedProposal（固件）：手动改引脚后旧固件提案 accept → 409 outdated_proposal", async () => {
    const projectId = await createProject();
    await seedToPinMap(projectId);
    const gen = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_firmware", payload: {} });
    const { proposal } = gen.body as { proposal: ProposalDto };

    // 期间引脚被改（S2 手动路径 → pinmap v2）
    const artifacts = await artifactsOf(projectId);
    const pm = artifacts.find((a) => a.kind === "pinmap")!;
    const pmV1 = ((await request(app).get(`/api/v1/artifacts/${pm.id}/versions`)).body) as ArtifactVersionDto[];
    const current = pmV1[0]!;
    const currentContent = await request(app).get(`/api/v1/versions/${current.id}`);
    const body = currentContent.body as { content: string };
    const parsed = JSON.parse(body.content) as { pinMap: Array<{ component: string; pinId: string }> };
    await request(app)
      .post(`/api/v1/artifacts/${pm.id}/versions`)
      .send({
        content: JSON.stringify({
          pinMap: parsed.pinMap.map((p) => (/pump|relay/i.test(p.component) ? { ...p, pinId: "IO21" } : p)),
          issues: [],
        }),
      });

    const decide = await request(app)
      .post(`/api/v1/proposals/${proposal.id}/decision`)
      .send({ decision: "accept" });
    expect(decide.status).toBe(409);
    expect(((decide.body as { error: { code: string } }).error).code).toBe("outdated_proposal");
  });

  it("无 Pin Map → 409 no_pin_map；无 MCU 链路同样 409", async () => {
    const projectId = await createProject();
    await analyzeToRequirements(projectId);
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "generate_firmware", payload: {} });
    expect(res.status).toBe(409);
    expect(((res.body as { error: { code: string } }).error).code).toBe("no_pin_map");
  });
});
