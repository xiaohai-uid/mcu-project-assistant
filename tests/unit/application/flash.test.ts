// unit/application/flash — S9 正常路径（ISSUE-011 §11）
// 检测 → 令牌签发 → flash（进度事件 + .evidence 证据）→ 串口遥测/命令回显；会话运行时态。
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import { createBuildRecord } from "@/src/domain/models/build-record";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { StaleMarkDto } from "@/src/shared-contracts/types";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import {
  createFlashTokenStore,
  detectDevice,
  FlashBuildNotVerifiedError,
  FlashFirmwareHashMismatchError,
  FlashFirmwareMissingError,
  flashDevice,
  issueFlashToken,
  sendSerial,
} from "@/src/application/capabilities/flash";
import { selectMcu } from "@/src/application/capabilities/mcu";
import { generatePinMap } from "@/src/application/capabilities/wiring";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { commitManualEdit } from "@/src/application/capabilities/artifacts";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  proposals: Map<string, Proposal>;
  stale: Map<string, StaleMarkDto>;
  builds: Map<string, BuildRecord>;
  prefs: Map<string, string>;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s9b-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakePersistence(): PersistencePort & { mem: FakeMem } {
  const mem: FakeMem = {
    projects: new Map(),
    artifacts: new Map(),
    versions: new Map(),
    proposals: new Map(),
    stale: new Map(),
    builds: new Map(),
    prefs: new Map(),
  };
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void mem.projects.set(p.id, p),
        archiveProject: () => {},
        getProject: (id) => mem.projects.get(id) ?? null,
        listProjects: () => [...mem.projects.values()],
        createArtifact: (a) => void mem.artifacts.set(a.id, a),
        setCurrentVersion: (artifactId, versionId) => {
          const a = mem.artifacts.get(artifactId);
          if (a) mem.artifacts.set(artifactId, { ...a, currentVersionId: versionId });
        },
        createVersion: (v) => void mem.versions.set(v.id, v),
        setVersionStatus: () => {},
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: (p) => void mem.proposals.set(p.id, p),
        resolveProposal: (p) => void mem.proposals.set(p.id, p),
        createValidationRecord: () => {},
        saveStaleMarks: (marks) => {
          for (const m of marks) mem.stale.set(m.id, m);
        },
        resolveStaleMarks: () => {},
        createBuildRecord: (b) => void mem.builds.set(b.id, b),
        updateBuildRecord: (b) => void mem.builds.set(b.id, b),
        setPreference: (key, value, at) => void mem.prefs.set(key, `${value}@${at}`),
      };
      return fn(uow);
    },
    getProject: async (id) => mem.projects.get(id) ?? null,
    listProjects: async () => [...mem.projects.values()],
    getArtifact: async (id) => mem.artifacts.get(id) ?? null,
    getArtifactByKind: async (projectId, kind) =>
      [...mem.artifacts.values()].find((a) => a.projectId === projectId && a.kind === kind) ?? null,
    listArtifacts: async (projectId) => [...mem.artifacts.values()].filter((a) => a.projectId === projectId),
    getVersion: async (id) => mem.versions.get(id) ?? null,
    listVersions: async (artifactId) =>
      [...mem.versions.values()].filter((v) => v.artifactId === artifactId).sort((a, b) => a.versionNo - b.versionNo),
    getTask: async () => null,
    latestTaskOutput: async () => null,
    getProposal: async (id) => mem.proposals.get(id) ?? null,
    listProposals: async (projectId) => [...mem.proposals.values()].filter((p) => p.projectId === projectId),
    latestValidation: async () => null,
    activeStaleMarks: async (projectId) =>
      [...mem.stale.values()].filter((m) => m.projectId === projectId && m.resolvedAt === null),
    getBuildRecord: async (id) => mem.builds.get(id) ?? null,
    listBuilds: async (versionId) => [...mem.builds.values()].filter((b) => b.artifactVersionId === versionId),
    getPreference: async (key) => mem.prefs.get(key) ?? null,
  };
  return { ...port, mem };
}

function deps() {
  const persistence = fakePersistence();
  const content = createWorkspaceFilesContent(join(dir, "ws"));
  const events: EventPort & { published: LogicalEvent[] } = {
    publish: (e) => void published.push(e),
    published: [],
  };
  const published = events.published;
  const tasks = createInProcessTasks({ persistence, events });
  const device = createCompanionLocalDevice();
  const tokens = createFlashTokenStore();
  tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler: { discoverToolchain: async () => ({ available: false, toolchain: "esp32-arduino", version: null }), build: async () => ({ exitCode: 1 }) } as never, workspaceDir: join(dir, "ws"), device, tokens, now }));
  return {
    persistence,
    content,
    events,
    published,
    tasks,
    device,
    tokens,
    flashDeps: { persistence, tasks, events, device, tokens, workspaceDir: join(dir, "ws"), now },
  };
}

async function seedFirmware(d: ReturnType<typeof deps>): Promise<{ projectId: string; versionId: string }> {
  const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
  const req = domainCreateArtifact({ projectId: project.id, kind: "requirements", now });
  await d.persistence.withTransaction((uow) => uow.createArtifact(req));
  const reqStore = await d.content.store(
    { projectId: project.id, kind: "requirements", versionNo: 1 },
    JSON.stringify({
      capabilities: [
        { id: "req-1", title: "Soil moisture monitoring", status: "complete" },
        { id: "req-2", title: "Water pump control", status: "complete" },
        { id: "req-3", title: "Local status display", status: "complete" },
      ],
      acceptedProposalIds: [],
    }),
  );
  await d.persistence.withTransaction((uow) => {
    uow.createVersion({
      id: "req-v1", artifactId: req.id, versionNo: 1, contentRef: reqStore.contentRef,
      contentHash: reqStore.contentHash, status: "accepted", sourceKind: "proposal", sourceProposalId: null,
      createdAt: NOW, createdBy: "owner",
    });
    uow.setCurrentVersion(req.id, "req-v1");
  });
  await selectMcu(
    { projectId: project.id, mcuId: "ESP32-S3" },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  await generatePinMap({ projectId: project.id }, d);
  const { ensureArtifact } = await import("@/src/application/capabilities/artifacts");
  const fw = await ensureArtifact({ projectId: project.id, kind: "firmware" }, d);
  await commitManualEdit(
    { artifactId: fw!.id, content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }) },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  const f = await d.persistence.getArtifactByKind(project.id, "firmware");
  const versionId = f!.currentVersionId!;
  const buildId = "build-1";
  const outputDir = join(dir, "ws", ".build", buildId, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "fixture.bin"), "firmware-fixture", "utf8");
  await d.persistence.withTransaction((uow) => uow.createBuildRecord(createBuildRecord({
    id: buildId, artifactVersionId: versionId, taskId: null, target: "esp32-s3", toolchain: "esp32-arduino",
    toolchainVersion: "fixture", options: {}, startedAt: NOW, outputDir,
  })));
  await d.persistence.withTransaction((uow) => uow.updateBuildRecord({
    ...d.persistence.mem.builds.get(buildId)!, status: "succeeded", completedAt: NOW, exitCode: 0,
    outputDir, outputs: [{ path: join(outputDir, "fixture.bin"), kind: "bin", sizeBytes: 16, sha256: "4872aaf92b449866c0452a5fb55712c1cb0c8db425a046235c5ca4c4ad1feafe" }],
  }));
  return { projectId: project.id, versionId };
}

const waitFor = async (fn: () => Promise<boolean>, ms = 2000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout");
};

describe("S9 正常路径（检测 → 令牌 → 烧录 → 证据 → 串口）", () => {
  it("检测 → 签发令牌 → Flash 完成（进度事件 + .evidence 证据）", async () => {
    const d = deps();
    const { projectId, versionId } = await seedFirmware(d);

    const device = await detectDevice({}, d.flashDeps);
    expect(device.port).toBe("companion-local");
    expect(d.device.session().stage).toBe("detected");

    const { token } = await issueFlashToken({ deviceId: device.id }, d.flashDeps);
    const build = [...d.persistence.mem.builds.values()][0];
    const result = await flashDevice({ projectId, deviceId: device.id, confirmationToken: token, buildId: build!.id, artifactVersionId: versionId }, d.flashDeps);
    await waitFor(async () => d.published.some((e) => e.type === "device.flashed"));
    expect(result.sessionId).toBeTruthy();
    // 进度事件（device.flashing 0→100）
    const flashing = d.published.filter((e) => e.type === "device.flashing");
    expect(flashing.length).toBeGreaterThanOrEqual(6);
    expect(flashing[flashing.length - 1]).toMatchObject({ percent: 100 });
    // .evidence/<sessionId>.log 真实证据
    const evidencePath = join(dir, "ws", ".evidence", `${result.sessionId}.log`);
    expect(existsSync(evidencePath)).toBe(true);
    expect(readFileSync(evidencePath, "utf8")).toContain("[flash] Flash complete");
    void projectId;
  });

  it("串口：连接后遥测流 + 命令回显（GET_STATUS）", async () => {
    const d = deps();
    const { projectId, versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    const { token } = await issueFlashToken({ deviceId: "companion-esp32s3" }, d.flashDeps);
    const build = [...d.persistence.mem.builds.values()][0];
    await flashDevice({ projectId, deviceId: "companion-esp32s3", confirmationToken: token, buildId: build!.id, artifactVersionId: versionId }, d.flashDeps);
    await waitFor(async () => d.published.some((e) => e.type === "device.flashed"));

    const serial = await d.device.openSerialSession({ projectId: "project-1", deviceId: "companion-esp32s3" });
    d.device.tickSerial();
    const session = d.device.session();
    expect(session.serialLines.some((l) => l.includes("Moisture Raw"))).toBe(true);
    const { echo, response } = await sendSerial({ sessionId: serial.sessionId, command: "GET_STATUS" }, d.flashDeps);
    expect(echo).toBe("> GET_STATUS");
    expect(response).toContain("STATUS moisture=");
    void projectId;
  });
});

describe("S12 flash build evidence boundary", () => {
  it("rejects missing, legacy/unverified, wrong-project, missing-file, and hash-mismatched builds before DevicePort.flash", async () => {
    const d = deps();
    const { projectId, versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    let flashCalls = 0;
    const originalFlash = d.device.flash;
    d.device.flash = async (...args) => {
      flashCalls += 1;
      return originalFlash(...args);
    };

    const expectRejected = async (buildId: string, error: new (...args: never[]) => Error, project = projectId) => {
      const { token } = await issueFlashToken({ deviceId: "companion-esp32s3" }, d.flashDeps);
      await expect(flashDevice({ projectId: project, deviceId: "companion-esp32s3", confirmationToken: token, buildId, artifactVersionId: versionId }, d.flashDeps)).rejects.toBeInstanceOf(error);
    };

    await expectRejected("missing-build", FlashBuildNotVerifiedError);
    const legacy = createBuildRecord({ id: "legacy-build", artifactVersionId: versionId, taskId: null, target: "esp32-s3", toolchain: "legacy", toolchainVersion: null, options: {}, startedAt: NOW, outputDir: null });
    await d.persistence.withTransaction((uow) => uow.createBuildRecord(legacy));
    await expectRejected("legacy-build", FlashBuildNotVerifiedError);
    await expectRejected("build-1", FlashBuildNotVerifiedError, "wrong-project");

    const build = d.persistence.mem.builds.get("build-1")!;
    const outputPath = build.outputs[0]!.path;
    rmSync(outputPath, { force: true });
    await expectRejected("build-1", FlashFirmwareMissingError);

    writeFileSync(outputPath, "tampered-firmware", "utf8");
    await expectRejected("build-1", FlashFirmwareHashMismatchError);
    expect(flashCalls).toBe(0);
  });
});
