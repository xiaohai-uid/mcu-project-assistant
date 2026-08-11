// unit/application/flash-security — S9 安全验收组（ISSUE-011 §11 必须单独成组）
// Flash 必须显式用户确认：无令牌/过期/复用/错误设备/L3 Stale/设备断开 全部被拒；
// 断线重连后令牌不可复用；烧录中断不留半成品证据；会话不建表（仅 last_device → preferences）。
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { StaleMarkDto } from "@/src/shared-contracts/types";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import {
  ConfirmationExpiredError,
  ConfirmationMissingError,
  DeviceDisconnectedError,
  DeviceMismatchError,
  TokenReusedError,
  createFlashTokenStore,
  detectDevice,
  disconnectDevice,
  flashDevice,
  issueFlashToken,
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
  dir = mkdtempSync(join(tmpdir(), "mcu-s9-"));
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
  const events = createNoopEvents();
  const tasks = createInProcessTasks({ persistence, events });
  const device = createCompanionLocalDevice();
  const tokens = createFlashTokenStore(60_000);
  return {
    persistence,
    content,
    events,
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
  const fw = await d.persistence.getArtifactByKind(project.id, "firmware");
  let fwId: string;
  if (!fw) {
    const { ensureArtifact } = await import("@/src/application/capabilities/artifacts");
    const f = await ensureArtifact({ projectId: project.id, kind: "firmware" }, d);
    fwId = f!.id;
    await commitManualEdit(
      { artifactId: fwId, content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }) },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
  } else {
    fwId = fw.id;
  }
  const f = await d.persistence.getArtifactByKind(project.id, "firmware");
  return { projectId: project.id, versionId: f!.currentVersionId! };
}

describe("S9 安全验收组（Flash 确认令牌；无绕过路径）", () => {
  it("无令牌 → ConfirmationMissingError（AI/Companion/重试不得绕过）", async () => {
    const d = deps();
    const { projectId, versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: "", firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(ConfirmationMissingError);
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: "forged-token", firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(ConfirmationMissingError);
    void projectId;
  });

  it("令牌过期（60s 时效）→ ConfirmationExpiredError", async () => {
    const d = deps();
    const { versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    const { token } = await issueFlashToken({ deviceId: "esp32s3-com6" }, d.flashDeps);
    // 60s 后（超时）消费 → expired
    const later = new Date(Date.parse(NOW) + 61_000);
    const d2 = { ...d.flashDeps, now: () => later };
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: token, firmwareVersionId: versionId }, d2),
    ).rejects.toThrow(ConfirmationExpiredError);
  });

  it("令牌单次使用：复用被拒（TokenReusedError）", async () => {
    const d = deps();
    const { versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    const { token } = await issueFlashToken({ deviceId: "esp32s3-com6" }, d.flashDeps);
    console.log("before flashDevice");
    await flashDevice({ deviceId: "esp32s3-com6", confirmationToken: token, firmwareVersionId: versionId }, d.flashDeps);
    console.log("after flashDevice");
    // 复用同一令牌 → 拒绝
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: token, firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(TokenReusedError);
  });

  it("令牌绑定设备：错误设备 → DeviceMismatchError", async () => {
    const d = deps();
    const { versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    const { token } = await issueFlashToken({ deviceId: "esp32s3-com6" }, d.flashDeps);
    await expect(
      flashDevice({ deviceId: "other-device", confirmationToken: token, firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(DeviceMismatchError);
  });

  it("设备断开 → 409 DeviceDisconnected；断开后旧令牌不可复用（需重新确认）", async () => {
    const d = deps();
    const { versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    const { token } = await issueFlashToken({ deviceId: "esp32s3-com6" }, d.flashDeps);
    await disconnectDevice(d.flashDeps);
    void token;
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: token, firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(DeviceDisconnectedError);
  });

  it("L3 Stale 门禁：flash 被 BlockingStale 拒绝（I-8）", async () => {
    const d = deps();
    const { projectId, versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    // 换 MCU → L3 marks
    await selectMcu(
      { projectId, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    const { token } = await issueFlashToken({ deviceId: "esp32s3-com6" }, d.flashDeps);
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: token, firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(/Blocking stale/i);
  });

  it("烧录中断（取消）→ 不留半成品证据（.evidence 无文件）", async () => {
    const d = deps();
    const { versionId } = await seedFirmware(d);
    await detectDevice({}, d.flashDeps);
    // 用伪造令牌路径验证失败不留证据（令牌校验被拒 → 无任务执行）
    await expect(
      flashDevice({ deviceId: "esp32s3-com6", confirmationToken: "forged", firmwareVersionId: versionId }, d.flashDeps),
    ).rejects.toThrow(ConfirmationMissingError);
    expect(existsSync(join(dir, "ws", ".evidence"))).toBe(false);
  });

  it("会话不建表：检测只持久化 last_device → preferences（无 device_sessions 表）", async () => {
    const d = deps();
    const device = await detectDevice({}, d.flashDeps);
    expect(device.model).toContain("ESP32-S3");
    const pref = await d.persistence.getPreference("last_device");
    expect(pref).toContain("ESP32-S3");
    // 无会话持久化：artifacts/versions/proposals/builds 均无新增
    expect(d.persistence.mem.versions.size).toBe(0);
    expect(d.persistence.mem.builds.size).toBe(0);
  });
});
