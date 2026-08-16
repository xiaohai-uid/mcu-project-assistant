import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { makeIdempotencyRequest } from "@/src/shared/idempotency";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;
let tasks: ReturnType<typeof createInProcessTasks>;
let compilerCalls: { build: number };
let flashCalls: { count: number };
let aiCalls: { stream: number; structured: number };

function boot(existingDb?: SqliteDb): void {
  dir = existingDb ? dir : mkdtempSync(join(tmpdir(), "mcu-idempotency-http-"));
  db = existingDb ?? openDatabase(join(dir, "test.db"));
  if (!existingDb) migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  tasks = createInProcessTasks({ persistence, events });
  const compilerHandle = createMockCompilerHandle({ lines: [], lineDelayMs: 2 });
  compilerCalls = { build: 0 };
  const compiler = {
    ...compilerHandle.compiler,
    async build(...args: Parameters<typeof compilerHandle.compiler.build>) {
      compilerCalls.build += 1;
      return compilerHandle.compiler.build(...args);
    },
  };
  const deviceBase = createCompanionLocalDevice();
  flashCalls = { count: 0 };
  const device = {
    ...deviceBase,
    async flash(...args: Parameters<typeof deviceBase.flash>) {
      flashCalls.count += 1;
      return deviceBase.flash(...args);
    },
  };
  const workspaceDir = join(dir, "ws");
  aiCalls = { stream: 0, structured: 0 };
  const aiBase = createMockAiProvider({ slow: false });
  const ai = {
    ...aiBase,
    async streamText(...args: Parameters<typeof aiBase.streamText>) {
      aiCalls.stream += 1;
      return aiBase.streamText(...args);
    },
    async generateStructured<T>(...args: Parameters<typeof aiBase.generateStructured>) {
      aiCalls.structured += 1;
      return aiBase.generateStructured<T>(...args);
    },
  };
  const deps: AppDeps = {
    persistence,
    workspaceDir,
    content: createWorkspaceFilesContent(workspaceDir),
    events,
    tasks,
    compiler,
    device,
    ai,
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  };
  app = createApp(deps);
}

async function dropResponse(path: string, key: string, body: unknown): Promise<void> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address() as AddressInfo;
    const serialized = JSON.stringify(body);
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        method: "POST",
        path,
        headers: {
          Host: `127.0.0.1:${address.port}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(serialized),
          "Idempotency-Key": key,
        },
      }, (res: IncomingMessage) => {
        res.destroy();
        resolve();
      });
      req.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNRESET" || error.code === "ERR_STREAM_PREMATURE_CLOSE") resolve();
        else reject(error);
      });
      req.end(serialized);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => boot());
afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(name = "Idempotency"): Promise<string> {
  const response = await request(app).post("/api/v1/projects").send({ name });
  return response.body.id as string;
}

async function seedFirmware(projectId: string): Promise<{ artifactId: string; versionId: string }> {
  await request(app)
    .post(`/api/v1/projects/${projectId}/commands`)
    .send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  const artifact = await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind: "firmware" });
  await request(app).post(`/api/v1/artifacts/${artifact.body.id}/versions`).send({
    content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }),
  });
  const versions = await request(app).get(`/api/v1/artifacts/${artifact.body.id}/versions`);
  return { artifactId: artifact.body.id as string, versionId: versions.body[0].id as string };
}

async function seedBuild(projectId: string): Promise<{ artifactId: string; versionId: string; buildId: string }> {
  const seeded = await seedFirmware(projectId);
  const response = await request(app)
    .post(`/api/v1/projects/${projectId}/builds`)
    .send({ versionId: seeded.versionId });
  await tasks.waitForIdle();
  return { ...seeded, buildId: response.body.buildId as string };
}

function insertCorruptReplay(scope: string, key: string, payload: unknown, responseStatus: number): void {
  const identity = makeIdempotencyRequest(key, scope, payload, "2026-08-13T00:00:00.000Z");
  if (!identity) throw new Error("test idempotency identity was not created");
  db.prepare("INSERT INTO idempotency_records (scope, key, request_hash, response_status, response_body_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(identity.scope, identity.key, identity.requestHash, responseStatus, "{", identity.createdAt);
}

describe("durable HTTP request idempotency", () => {
  it("fails closed on corrupt replay bodies without repeating project/analyze/build/flash side effects", async () => {
    const projectPayload = { name: "corrupt replay" };
    insertCorruptReplay("POST:/api/v1/projects", "corrupt-project", projectPayload, 201);
    const projectReplay = await request(app).post("/api/v1/projects").set("Idempotency-Key", "corrupt-project").send(projectPayload);
    expect(projectReplay.status).toBe(500);
    expect(projectReplay.body.error.code).toBe("idempotency_record_corrupt");
    expect((await request(app).get("/api/v1/projects")).body).toHaveLength(0);

    const projectId = await createProject();
    const analysisPayload = { description: "corrupt analyze", lab: { partialNext: true } };
    const analysisScope = `POST:/api/v1/projects/${projectId}/commands:analyze_requirement`;
    insertCorruptReplay(analysisScope, "corrupt-analyze", analysisPayload, 202);
    const analysisReplay = await request(app).post(`/api/v1/projects/${projectId}/commands`)
      .set("Idempotency-Key", "corrupt-analyze")
      .send({ capability: "analyze_requirement", payload: analysisPayload });
    expect(analysisReplay.status).toBe(500);
    expect(analysisReplay.body.error.code).toBe("idempotency_record_corrupt");
    expect(aiCalls.stream).toBe(0);
    expect(aiCalls.structured).toBe(0);
    expect(await createProjectStore(db).listTasks!(projectId)).toHaveLength(0);

    const { versionId } = await seedFirmware(projectId);
    const buildScope = `POST:/api/v1/projects/${projectId}/builds`;
    insertCorruptReplay(buildScope, "corrupt-build", { versionId }, 202);
    const buildReplay = await request(app).post(`/api/v1/projects/${projectId}/builds`).set("Idempotency-Key", "corrupt-build").send({ versionId });
    expect(buildReplay.status).toBe(500);
    expect(buildReplay.body.error.code).toBe("idempotency_record_corrupt");
    expect(compilerCalls.build).toBe(0);
    expect((await request(app).get(`/api/v1/versions/${versionId}/builds`)).body).toHaveLength(0);

    const flashProjectId = "corrupt-flash-project";
    const flashBody = { projectId: flashProjectId, deviceId: "companion-esp32s3", confirmationToken: "not-consumed", buildId: "no-build", artifactVersionId: "no-version" };
    insertCorruptReplay(`POST:/api/v1/device/flash:${flashProjectId}`, "corrupt-flash", flashBody, 202);
    const flashReplay = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "corrupt-flash").send(flashBody);
    expect(flashReplay.status).toBe(500);
    expect(flashReplay.body.error.code).toBe("idempotency_record_corrupt");
    expect(flashCalls.count).toBe(0);
  });

  it("validates keys, binds payloads, and separates route/resource scopes", async () => {
    const first = await request(app).post("/api/v1/projects").set("Idempotency-Key", "project-1").send({ name: "A" });
    const replay = await request(app).post("/api/v1/projects").set("Idempotency-Key", "project-1").send({ name: "A" });
    const conflict = await request(app).post("/api/v1/projects").set("Idempotency-Key", "project-1").send({ name: "B" });
    const invalid = await request(app).post("/api/v1/projects").set("Idempotency-Key", " ").send({ name: "C" });
    const oversized = await request(app).post("/api/v1/projects").set("Idempotency-Key", "x".repeat(129)).send({ name: "D" });
    const artifact = await request(app).post(`/api/v1/projects/${first.body.id}/artifacts`).send({ kind: "pinmap" });
    const versionPath = `/api/v1/artifacts/${artifact.body.id}/versions`;
    const version = await request(app).post(versionPath).set("Idempotency-Key", "project-1").send({ content: "{}" });
    const versionReplay = await request(app).post(versionPath).set("Idempotency-Key", "project-1").send({ content: "{}" });
    const versionConflict = await request(app).post(versionPath).set("Idempotency-Key", "project-1").send({ content: "{\"changed\":true}" });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_idempotency_key");
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.code).toBe("invalid_idempotency_key");
    expect(version.status).toBe(201);
    expect(versionReplay.status).toBe(201);
    expect(versionReplay.body.id).toBe(version.body.id);
    expect(versionConflict.status).toBe(409);
    expect(versionConflict.body.error.code).toBe("idempotency_conflict");
    expect((await request(app).get("/api/v1/projects")).body).toHaveLength(1);

    db.close();
    boot(openDatabase(join(dir, "test.db")));
    const versionRestart = await request(app).post(versionPath).set("Idempotency-Key", "project-1").send({ content: "{}" });
    expect(versionRestart.status).toBe(201);
    expect(versionRestart.body.id).toBe(version.body.id);
  });

  it("replays project creation after rebuilding the app over the same database", async () => {
    const first = await request(app).post("/api/v1/projects").set("Idempotency-Key", "restart-project").send({ name: "A" });
    const firstId = first.body.id as string;
    db.close();
    boot(openDatabase(join(dir, "test.db")));
    const replay = await request(app).post("/api/v1/projects").set("Idempotency-Key", "restart-project").send({ name: "A" });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(firstId);
    expect((await request(app).get("/api/v1/projects")).body).toHaveLength(1);
  });

  it("atomically shares one keyed version commit across concurrent callers", async () => {
    const projectId = await createProject();
    const artifact = await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind: "pinmap" });
    const path = `/api/v1/artifacts/${artifact.body.id}/versions`;
    const responses = await Promise.all([
      request(app).post(path).set("Idempotency-Key", "version-concurrent").send({ content: "{}" }),
      request(app).post(path).set("Idempotency-Key", "version-concurrent").send({ content: "{}" }),
    ]);
    const versions = await request(app).get(`/api/v1/artifacts/${artifact.body.id}/versions`);
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(versions.body).toHaveLength(1);
  });

  it("atomically suppresses sequential and concurrent keyed analysis submissions", async () => {
    const projectId = await createProject();
    const body = { capability: "analyze_requirement", payload: { description: "same request", lab: { partialNext: true } } };
    const first = await request(app).post(`/api/v1/projects/${projectId}/commands`).set("Idempotency-Key", "analyze-1").send(body);
    const replay = await request(app).post(`/api/v1/projects/${projectId}/commands`).set("Idempotency-Key", "analyze-1").send(body);
    const conflict = await request(app).post(`/api/v1/projects/${projectId}/commands`).set("Idempotency-Key", "analyze-1").send({ ...body, payload: { ...body.payload, description: "different request" } });
    const concurrent = await Promise.all([
      request(app).post(`/api/v1/projects/${projectId}/commands`).set("Idempotency-Key", "analyze-2").send(body),
      request(app).post(`/api/v1/projects/${projectId}/commands`).set("Idempotency-Key", "analyze-2").send(body),
    ]);
    await tasks.waitForIdle();
    const rows = await createProjectStore(db).listTasks!(projectId);
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body.taskId).toBe(first.body.taskId);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    expect(concurrent.every((response) => response.status === 202)).toBe(true);
    expect(concurrent[0].body.taskId).toBe(concurrent[1].body.taskId);
    expect(rows).toHaveLength(2);
  });

  it("replays the original analyze task after the HTTP response is lost", async () => {
    const projectId = await createProject();
    const path = `/api/v1/projects/${projectId}/commands`;
    const body = { capability: "analyze_requirement", payload: { description: "lost response", lab: { partialNext: true } } };
    await dropResponse(path, "analyze-lost", body);
    const retry = await request(app).post(path).set("Idempotency-Key", "analyze-lost").send(body);
    await tasks.waitForIdle();
    const rows = await createProjectStore(db).listTasks!(projectId);
    expect(retry.status).toBe(202);
    expect(retry.body.taskId).toBeTruthy();
    expect(rows).toHaveLength(1);
    expect(aiCalls.stream).toBe(1);
    expect(aiCalls.structured).toBe(1);
  });

  it("atomically suppresses keyed builds and detects a different payload", async () => {
    const projectId = await createProject();
    const { versionId } = await seedFirmware(projectId);
    const path = `/api/v1/projects/${projectId}/builds`;
    const first = await request(app).post(path).set("Idempotency-Key", "build-1").send({ versionId });
    const replay = await request(app).post(path).set("Idempotency-Key", "build-1").send({ versionId });
    const concurrent = await Promise.all([
      request(app).post(path).set("Idempotency-Key", "build-2").send({ versionId }),
      request(app).post(path).set("Idempotency-Key", "build-2").send({ versionId }),
    ]);
    const conflict = await request(app).post(path).set("Idempotency-Key", "build-1").send({ versionId, options: { optimize: "size" } });
    await tasks.waitForIdle();
    const builds = await request(app).get(`/api/v1/versions/${versionId}/builds`);
    expect(first.status).toBe(202);
    expect(replay.body.buildId).toBe(first.body.buildId);
    expect(concurrent[0].body.buildId).toBe(concurrent[1].body.buildId);
    expect(conflict.status).toBe(409);
    expect(builds.body).toHaveLength(2);
    expect(compilerCalls.build).toBe(2);
  });

  it("replays the original build after the HTTP response is lost", async () => {
    const projectId = await createProject();
    const { versionId } = await seedFirmware(projectId);
    const path = `/api/v1/projects/${projectId}/builds`;
    const body = { versionId };
    await dropResponse(path, "build-lost", body);
    const retry = await request(app).post(path).set("Idempotency-Key", "build-lost").send(body);
    await tasks.waitForIdle();
    const builds = await request(app).get(`/api/v1/versions/${versionId}/builds`);
    expect(retry.status).toBe(202);
    expect(retry.body.buildId).toBeTruthy();
    expect(builds.body).toHaveLength(1);
    expect(compilerCalls.build).toBe(1);
  });

  it("replays keyed flash output without consuming confirmation or flashing twice", async () => {
    const projectId = await createProject();
    const { versionId, buildId } = await seedBuild(projectId);
    const device = (await request(app).post("/api/v1/device/detect")).body as { id: string };
    const token = (await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body.token as string;
    const body = { projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId };
    const first = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-1").send(body);
    const replay = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-1").send(body);
    await tasks.waitForIdle();
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body.sessionId).toBe(first.body.sessionId);
    expect(flashCalls.count).toBe(1);
  });

  it("replays keyed flash after a lost response and a fresh app instance", async () => {
    const projectId = await createProject();
    const { versionId, buildId } = await seedBuild(projectId);
    const device = (await request(app).post("/api/v1/device/detect")).body as { id: string };
    const token = (await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body.token as string;
    const body = { projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId };
    await dropResponse("/api/v1/device/flash", "flash-lost", body);
    await tasks.waitForIdle();
    expect(flashCalls.count).toBe(1);

    db.close();
    boot(openDatabase(join(dir, "test.db")));
    const replay = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-lost").send(body);
    expect(replay.status).toBe(202);
    expect(replay.body.taskId).toBeTruthy();
    expect(flashCalls.count).toBe(0);
  });

  it("keeps interrupted keyed flash recovery fail-safe", async () => {
    const projectId = await createProject();
    const { versionId, buildId } = await seedBuild(projectId);
    const device = (await request(app).post("/api/v1/device/detect")).body as { id: string };
    const token = (await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body.token as string;
    const body = { projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId };
    const accepted = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-recovery").send(body);
    expect(accepted.status).toBe(202);
    const taskId = accepted.body.taskId as string;
    db.prepare("UPDATE tasks SET status = 'running', started_at = ?, completed_at = NULL WHERE id = ?").run(new Date().toISOString(), taskId);
    db.close();

    const recoveredDb = openDatabase(join(dir, "test.db"));
    migrate(recoveredDb);
    const recoveredPersistence = createProjectStore(recoveredDb);
    const recoveredTasks = createInProcessTasks({ persistence: recoveredPersistence, events: createNoopEvents() });
    recoveredTasks.setExecutor(async () => {
      throw new Error("TASK_RECOVERY_UNSAFE_REPLAY: flash_device requires fresh confirmation and a live device session");
    });
    expect(await recoveredTasks.recover()).toEqual({ recovered: 1, failed: 0 });
    await recoveredTasks.waitForIdle();
    expect(await recoveredPersistence.getTask(taskId)).toMatchObject({ status: "failed" });
    recoveredDb.close();
    boot(openDatabase(join(dir, "test.db")));
    const replay = await request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-recovery").send(body);
    expect(replay.status).toBe(202);
    expect(replay.body.taskId).toBe(taskId);
    expect(flashCalls.count).toBe(0);
  });

  it("atomically shares one keyed flash submission across concurrent callers", async () => {
    const projectId = await createProject();
    const { versionId, buildId } = await seedBuild(projectId);
    const device = (await request(app).post("/api/v1/device/detect")).body as { id: string };
    const token = (await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body.token as string;
    const body = { projectId, deviceId: device.id, confirmationToken: token, buildId, artifactVersionId: versionId };
    const responses = await Promise.all([
      request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-concurrent").send(body),
      request(app).post("/api/v1/device/flash").set("Idempotency-Key", "flash-concurrent").send(body),
    ]);
    await tasks.waitForIdle();
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(responses[0].body.taskId).toBe(responses[1].body.taskId);
    expect(flashCalls.count).toBe(1);
  });
});
