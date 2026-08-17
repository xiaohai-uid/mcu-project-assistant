// contract/http/device — S9 surface（ISSUE-011 §11）
// /device/detect、/device/flash-token、/device/flash（成功 + 安全拒绝 403/409 族）、
// /device/serial/send；串口流 SSE（serial.line 帧）；.evidence 证据写入。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createPhysicalArduinoDevice } from "@/src/adapters/device/physical-arduino";
import type { DevicePort } from "@/src/ports/device";
import type { LogicalEvent } from "@/src/ports/events";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

let dir: string;
let db: SqliteDb;
let ws: string;
let app: ReturnType<typeof createApp>;
let flashInvocations = 0;
let publishedEvents: LogicalEvent[] = [];

function boot(provider: "companion" | "physical" = "companion") {
  dir = mkdtempSync(join(tmpdir(), "mcu-s9-http-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  publishedEvents = [];
  const events = { publish: (event: LogicalEvent) => publishedEvents.push(event) };
  const companion = createCompanionLocalDevice();
  const deviceProvider = provider === "physical"
    ? createPhysicalArduinoDevice({
        arduinoCliPath: process.execPath,
        executableArgsPrefix: ["-e", `const a=process.argv.slice(1);if(a.includes('board'))process.stdout.write(JSON.stringify([{port:'COM9',protocol:'serial',matching_boards:[{fqbn:'esp32:esp32:esp32s3',name:'ESP32-S3-DevKitC-1-N8R8',vid:'303a',pid:'1001',serial_number:'contract-fixture'}]}]));else process.exit(0);`],
        cwd: ws,
        timeoutMs: 1000,
      })
    : companion;
  flashInvocations = 0;
  const device: DevicePort = provider === "physical"
    ? deviceProvider
    : {
        ...companion,
        flash: async (...args) => {
          flashInvocations += 1;
          return companion.flash(...args);
        },
      };
  const deps: AppDeps = {
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device,
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
    content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }),
  });
  const versions = ((await request(app).get(`/api/v1/artifacts/${fw.id}/versions`)).body) as Array<{ id: string }>;
  return versions[versions.length - 1]!.id;
}

const waitFor = async (fn: () => Promise<boolean>, ms = 4000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout");
};

async function buildFirmware(projectId: string, versionId: string): Promise<string> {
  const run = await request(app).post(`/api/v1/projects/${projectId}/builds`).send({ versionId });
  expect(run.status).toBe(202);
  const { buildId } = run.body as { buildId: string };
  await waitFor(async () => ((await request(app).get(`/api/v1/builds/${buildId}`)).body as { status: string }).status === "succeeded");
  return buildId;
}

describe("S9 device surface", () => {
  it("项目设备状态只读 last_device，不启动检测或恢复串口会话", async () => {
    boot();
    const projectId = await createProject();
    const before = await request(app).get(`/api/v1/projects/${projectId}/device-state`);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ lastDevice: null });

    const detected = await request(app).post("/api/v1/device/detect");
    const after = await request(app).get(`/api/v1/projects/${projectId}/device-state`);
    expect(after.status).toBe(200);
    expect(after.body.lastDevice).toMatchObject({ id: detected.body.id, truth: { executionReality: "companion", physicalVerified: false } });
    expect(after.body.lastDevice).not.toHaveProperty("session");
  });

  it("串口写入超过 UTF-8 上限 → 413 serial_write_too_large", async () => {
    boot();
    const projectId = await createProject();
    const detected = await request(app).post("/api/v1/device/detect");
    const opened = await request(app)
      .post(`/api/v1/projects/${projectId}/device/serial/session`)
      .send({ deviceId: detected.body.id });
    expect(opened.status).toBe(201);
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/device/serial/session/${opened.body.sessionId}/write`)
      .send({ command: "x".repeat(64 * 1024 + 1) });
    expect(response.status).toBe(413);
    expect(response.body.error?.code).toBe("serial_write_too_large");
  });

  it("检测 → 令牌 → Flash 完成（202 + .evidence 证据）→ 串口命令回显", async () => {
    boot();
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const buildId = await buildFirmware(projectId, versionId);

    const detect = await request(app).post("/api/v1/device/detect");
    expect(detect.status).toBe(200);
    const device = detect.body as { id: string; model: string; port: string };
    expect(device.port).toBe("companion-local");
    expect(detect.body.truth).toMatchObject({
      executionReality: "companion",
      verification: "verified",
      physicalVerified: false,
      adapter: "companion-local",
    });

    const tokenRes = await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id });
    expect(tokenRes.status).toBe(200);
    const { token } = tokenRes.body as { token: string; expiresAt: string };
    expect(token).toBeTruthy();

    const flash = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId });
    expect(flash.status).toBe(202);
    const { sessionId } = flash.body as { sessionId: string };
    expect(sessionId).toBeTruthy();
    expect(flash.body.truth).toMatchObject({ executionReality: "companion", verification: "verified", physicalVerified: false });
    expect(publishedEvents.filter((event) => event.type === "device.flashed").at(-1)).toMatchObject({
      type: "device.flashed",
      truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "companion-local" },
    });
    expect(existsSync(join(ws, ".evidence", `${sessionId}.log`))).toBe(true);

    // Flash truth is durable task output and remains readable through a fresh store wrapper.
    const taskRow = db.prepare("SELECT id, output FROM tasks WHERE capability = 'flash_device' ORDER BY rowid DESC LIMIT 1").get() as { id: string; output: string };
    const freshDb = openDatabase(join(dir, "test.db"));
    migrate(freshDb);
    const freshStore = createProjectStore(freshDb);
    const persisted = await freshStore.getTask(taskRow.id);
    expect(JSON.parse(persisted?.output ?? "{}").truth).toMatchObject({
      executionReality: "companion",
      verification: "verified",
      physicalVerified: false,
    });
    const lastDevice = JSON.parse((await freshStore.getPreference("last_device")) ?? "{}");
    expect(lastDevice.truth).toMatchObject({ executionReality: "companion", physicalVerified: false, adapter: "companion-local" });
    freshDb.close();
    const projectTasks = await request(app).get(`/api/v1/projects/${projectId}/tasks`);
    expect(projectTasks.body.find((task: { id: string }) => task.id === taskRow.id)).toMatchObject({ capability: "flash_device" });

    // 串口命令必须经过显式 session open；detect/flash 不隐式打开串口。
    const serialOpen = await request(app)
      .post(`/api/v1/projects/${projectId}/device/serial/session`)
      .send({ deviceId: device.id });
    expect(serialOpen.status).toBe(201);
    const serialSession = serialOpen.body as { sessionId: string };
    const serial = await request(app)
      .post(`/api/v1/projects/${projectId}/device/serial/session/${serialSession.sessionId}/write`)
      .send({ command: "GET_STATUS" });
    expect(serial.status).toBe(200);
    expect((serial.body as { response: string }).response).toContain("STATUS moisture=");
    expect(serial.body.truth).toMatchObject({ executionReality: "companion", physicalVerified: false });
  });

  it("安全拒绝：无令牌 403 / 伪造令牌 403 / 复用 403 / 错误设备 403 / 未检测 409", async () => {
    boot();
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const deviceId = "companion-esp32s3";
    const buildId = await buildFirmware(projectId, versionId);

    // 未检测 → 409 device_disconnected（先取合法令牌——令牌校验先于设备连接检查）
    const t0 = ((await request(app).post("/api/v1/device/flash-token").send({ deviceId })).body) as { token: string };
    const noDevice = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: t0.token, buildId, artifactVersionId: versionId });
    expect(noDevice.status).toBe(409);
    expect(((noDevice.body as { error: { code: string } }).error).code).toBe("device_disconnected");

    await request(app).post("/api/v1/device/detect");

    // Physical requests are explicitly blocked and must not invoke the companion adapter.
    const physicalToken = ((await request(app).post("/api/v1/device/flash-token").send({ deviceId })).body) as { token: string };
    const beforePhysical = flashInvocations;
    const physical = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: physicalToken.token, buildId, artifactVersionId: versionId, executionReality: "physical" });
    expect(physical.status).toBe(409);
    expect(((physical.body as { error: { code: string } }).error).code).toBe("physical_flash_blocked");
    expect(flashInvocations).toBe(beforePhysical);
    expect(db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE capability = 'flash_device'").get()).toEqual({ count: 0 });
    expect(publishedEvents.some((event) => event.type === "device.flashed")).toBe(false);
    // 无令牌 → 403 confirmation_missing
    const noToken = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: "", buildId, artifactVersionId: versionId });
    expect(noToken.status).toBe(403);
    expect(((noToken.body as { error: { code: string } }).error).code).toBe("confirmation_missing");
    // 伪造令牌 → 403 confirmation_missing
    const forged = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: "forged", buildId, artifactVersionId: versionId });
    expect(forged.status).toBe(403);

    // 合法令牌 → 成功；复用 → 403 token_reused
    const t1 = ((await request(app).post("/api/v1/device/flash-token").send({ deviceId })).body) as { token: string };
    const ok = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: t1.token, buildId, artifactVersionId: versionId });
    expect(ok.status).toBe(202);
    const reused = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId, confirmationToken: t1.token, buildId, artifactVersionId: versionId });
    expect(reused.status).toBe(403);
    expect(((reused.body as { error: { code: string } }).error).code).toBe("token_reused");

    // 错误设备 → 403 device_mismatch
    const t2 = ((await request(app).post("/api/v1/device/flash-token").send({ deviceId })).body) as { token: string };
    const wrong = await request(app)
      .post("/api/v1/device/flash")
      .send({ projectId, deviceId: "other", confirmationToken: t2.token, buildId, artifactVersionId: versionId });
    expect(wrong.status).toBe(403);
    expect(((wrong.body as { error: { code: string } }).error).code).toBe("device_mismatch");
    void projectId;
  });

  it("physical provider uses the controlled Arduino CLI boundary and only returns physicalVerified after upload", async () => {
    boot("physical");
    const projectId = await createProject();
    const versionId = await seedFirmware(projectId);
    const buildId = await buildFirmware(projectId, versionId);
    const detect = await request(app).post("/api/v1/device/detect");
    expect(detect.status).toBe(200);
    const device = detect.body as { id: string; port: string; fqbn: string; truth: { executionReality: string; physicalVerified: boolean } };
    expect(device).toMatchObject({ port: "COM9", fqbn: "esp32:esp32:esp32s3", truth: { executionReality: "physical", physicalVerified: true } });
    const beforeUpload = await request(app).post(`/api/v1/projects/${projectId}/physical-acceptance`).send({ buildId, artifactVersionId: versionId, serialObservation: "BOOT: MCU_READY" });
    expect(beforeUpload.status).toBe(201);
    expect(beforeUpload.body).toMatchObject({ status: "pending", uploadStatus: "pending", serialStatus: "observed" });
    const token = ((await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body as { token: string }).token;
    const flash = await request(app).post("/api/v1/device/flash").send({ projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId, executionReality: "physical" });
    expect(flash.status).toBe(202);
    expect(flash.body).toMatchObject({ exitCode: 0, buildId, artifactVersionId: versionId, port: "COM9", fqbn: "esp32:esp32:esp32s3", adapter: "esp32-arduino-physical", toolchain: "arduino-cli", truth: { executionReality: "physical", verification: "verified", physicalVerified: true } });
    const acceptance = await request(app).post(`/api/v1/projects/${projectId}/physical-acceptance`).send({ buildId, artifactVersionId: versionId, serialObservation: "BOOT: MCU_READY status=ok" });
    expect(acceptance.status).toBe(201);
    expect(acceptance.body).toMatchObject({ status: "accepted", uploadStatus: "verified", verificationStatus: "verified", serialStatus: "observed", usbPort: "COM9", firmwareSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const stored = await request(app).get(`/api/v1/projects/${projectId}/physical-acceptance`);
    expect(stored.status).toBe(200);
    expect(stored.body.record.id).toBe(acceptance.body.id);
  });
});
