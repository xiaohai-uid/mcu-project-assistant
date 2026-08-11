// contract/http/diagnosis — S8 surface（ISSUE-010 §11）
// POST /builds/:id/diagnose（失败记录 → 诊断 + build_fix 提案；409 build_not_failed；404）
// → /proposals/:id/decision accept → Firmware v+1（platformio.ini 真实文件含 lib_deps）→ 重建成功。
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompilerHandle } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { BuildRecordDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let ws: string;
let app: ReturnType<typeof createApp>;
let failCompiler: ReturnType<typeof createMockCompilerHandle>;

function boot() {
  dir = mkdtempSync(join(tmpdir(), "mcu-s8-http-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  failCompiler = createMockCompilerHandle({
    lines: ["$ arduino-cli compile ...", "[ERR] src/main.cpp:12:9: error: 'Adafruit_SSD1306.h' not found"],
    exitCode: 1,
  });
  const deps: AppDeps = {
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: failCompiler.compiler,
    device: createCompanionLocalDevice(),

    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  };
  app = createApp(deps);
}

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
  const proposals = ((await request(app).get(`/api/v1/projects/${projectId}/proposals`)).body) as Array<{ id: string }>;
  for (const p of proposals) {
    await request(app).post(`/api/v1/proposals/${p.id}/decision`).send({ decision: "accept" });
  }
  await request(app).post(`/api/v1/projects/${projectId}/requirements/commit`).send({});
}

async function seedFirmware(projectId: string): Promise<string> {
  await analyzeToRequirements(projectId);
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "generate_pin_map", payload: {} });
  const fw = ((await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind: "firmware" })).body) as { id: string };
  await request(app).post(`/api/v1/artifacts/${fw.id}/versions`).send({
    content: JSON.stringify({
      "src/main.cpp": "#include <Adafruit_SSD1306.h>\nvoid setup(){}",
      "platformio.ini": "[env:esp32s3]\nplatform = espressif32\nboard = esp32-s3-devkitc-1\nframework = arduino\n",
    }),
  });
  const versions = ((await request(app).get(`/api/v1/artifacts/${fw.id}/versions`)).body) as Array<{ id: string; versionNo: number }>;
  return versions[versions.length - 1]!.id;
}

const waitFor = async (fn: () => Promise<boolean>, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
};

describe("S8 diagnosis surface", () => {
  it("诊断 → build_fix 提案 → Accept → Firmware v2（真实文件 lib_deps）→ 重建成功", async () => {
    boot();
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);

    // 失败构建
    const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    const { buildId } = run.body as { buildId: string };
    await waitFor(async () => {
      const rec = ((await request(app).get(`/api/v1/builds/${buildId}`)).body) as BuildRecordDto;
      return rec.status === "failed";
    });

    // 诊断 → 提案 pending（不写版本）
    const diag = await request(app).post(`/api/v1/builds/${buildId}/diagnose`);
    expect(diag.status).toBe(200);
    const { diagnosis, proposal } = diag.body as { diagnosis: { cause: string; proposal: { file: string; proposalId: string } }; proposal: ProposalDto };
    expect(diagnosis.cause).toContain("Adafruit_SSD1306");
    expect(proposal.status).toBe("pending");
    expect(diagnosis.proposal.proposalId).toBe(proposal.id);

    // Accept → Firmware v2（platformio.ini 真实文件含 lib_deps）
    const decide = await request(app).post(`/api/v1/proposals/${proposal.id}/decision`).send({ decision: "accept" });
    expect(decide.status).toBe(200);
    const artifacts = ((await request(app).get(`/api/v1/projects/${projectId}/artifacts`)).body) as Array<{ id: string; kind: string }>;
    const fw = artifacts.find((a) => a.kind === "firmware")!;
    const versions = ((await request(app).get(`/api/v1/artifacts/${fw.id}/versions`)).body) as Array<{ id: string; versionNo: number; contentRef: string }>;
    expect(versions.length).toBe(2);
    const v2 = versions[1]!;
    expect(v2.versionNo).toBe(2);
    const pioPath = join(ws, v2.contentRef.replace("src/main.cpp", "platformio.ini"));
    expect(readFileSync(pioPath, "utf8")).toContain("lib_deps");
    expect(readFileSync(pioPath, "utf8")).toContain("Adafruit SSD1306@^2.5.10");

    // 重建（修复后工具链成功）→ 新 BuildRecord
    failCompiler.setScript({ lines: ["[OK] Build complete"], exitCode: 0 });
    const rebuild = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId: v2.id });
    const { buildId: rebuildId } = rebuild.body as { buildId: string };
    await waitFor(async () => {
      const rec = ((await request(app).get(`/api/v1/builds/${rebuildId}`)).body) as BuildRecordDto;
      return rec.status === "succeeded";
    });
    const history = ((await request(app).get(`/api/v1/versions/${v2.id}/builds`)).body) as BuildRecordDto[];
    expect(history.some((b) => b.status === "succeeded")).toBe(true);
  });

  it("非失败记录 → 409 build_not_failed；不存在 → 404", async () => {
    boot();
    failCompiler.setScript({ lines: ["[OK] Build complete"], exitCode: 0 });
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
    const { buildId } = run.body as { buildId: string };
    await waitFor(async () => {
      const rec = ((await request(app).get(`/api/v1/builds/${buildId}`)).body) as BuildRecordDto;
      return rec.status === "succeeded";
    });
    const diag = await request(app).post(`/api/v1/builds/${buildId}/diagnose`);
    expect(diag.status).toBe(409);
    expect(((diag.body as { error: { code: string } }).error).code).toBe("build_not_failed");
    const missing = await request(app).post("/api/v1/builds/nope/diagnose");
    expect(missing.status).toBe(404);
  });
});
