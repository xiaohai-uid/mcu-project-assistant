// unit/application/diagnosis — S8 诊断+修复（application-contract 2.13；ISSUE-010 §11）
// **三模型分离断言**：Build 失败不改版本（D2）；诊断不改资产（I-1）；fix accept 恰一新版本；
// 重建 = 新 BuildRecord 而非新版本。禁止自动修复（无 Accept 不写版本）。
import { mkdtempSync, rmSync } from "node:fs";
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
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { runBuild, getBuildRecord } from "@/src/application/capabilities/build";
import { diagnoseBuild, applyLineDiff, BuildNotFailedError } from "@/src/application/capabilities/diagnosis";
import { resolveProposal } from "@/src/application/capabilities/proposals";
import { generatePinMap } from "@/src/application/capabilities/wiring";
import { selectMcu } from "@/src/application/capabilities/mcu";
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
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s8-"));
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
        saveStaleMarks: () => {},
        resolveStaleMarks: () => {},
        createBuildRecord: (b) => void mem.builds.set(b.id, b),
        updateBuildRecord: (b) => void mem.builds.set(b.id, b),
        setPreference: () => {},
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
    activeStaleMarks: async () => [],
    getBuildRecord: async (id) => mem.builds.get(id) ?? null,
    listBuilds: async (versionId) => [...mem.builds.values()].filter((b) => b.artifactVersionId === versionId),
    getPreference: async () => null,
  };
  return { ...port, mem };
}

function deps() {
  const persistence = fakePersistence();
  const content = createWorkspaceFilesContent(join(dir, "ws"));
  const events = createNoopEvents();
  const tasks = createInProcessTasks({ persistence, events });
  const compiler = createMockCompiler({
    lines: ["$ arduino-cli compile ...", "[ERR] src/main.cpp:12:9: error: 'Adafruit_SSD1306.h' not found"],
    exitCode: 1,
  });
  const ai = createMockAiProvider({ slow: false });
  return {
    persistence,
    content,
    events,
    tasks,
    compiler,
    ai,
    buildDeps: { persistence, tasks, events, compiler, workspaceDir: join(dir, "ws"), now },
    diagnosisDeps: { persistence, content, events, ai, now },
    proposalDeps: { persistence, content, events, now },
  };
}

async function seedJourney(d: ReturnType<typeof deps>): Promise<{ project: Project; versionId: string; fwId: string }> {
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
  const fwArtifact = await d.persistence.getArtifactByKind(project.id, "firmware");
  let fwId: string;
  if (!fwArtifact) {
    const { ensureArtifact } = await import("@/src/application/capabilities/artifacts");
    const fw = await ensureArtifact({ projectId: project.id, kind: "firmware" }, d);
    fwId = fw!.id;
    await commitManualEdit(
      {
        artifactId: fwId,
        content: JSON.stringify({
          "src/main.cpp": "#include <Adafruit_SSD1306.h>\\nvoid setup(){}",
          "platformio.ini": "[env:esp32s3]\\nplatform = espressif32\\nboard = esp32-s3-devkitc-1\\nframework = arduino\\n",
        }),
      },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
  } else {
    fwId = fwArtifact.id;
  }
  const fw = await d.persistence.getArtifactByKind(project.id, "firmware");
  return { project, versionId: fw!.currentVersionId!, fwId };
}

const waitFor = async (fn: () => Promise<boolean>, ms = 2000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout");
};

describe("S8 三模型分离（Proposal / ArtifactVersion / BuildRecord）", () => {
  it("Build 失败不改版本（D2）→ 诊断不改资产（I-1）→ 无 Accept 不写版本（禁止自动修复）", async () => {
    const d = deps();
    const { project, versionId } = await seedJourney(d);
    const versionsBefore = d.persistence.mem.versions.size;

    // 编译失败（mock 脚本 exitCode 1）
    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "failed");
    expect(d.persistence.mem.versions.size).toBe(versionsBefore); // D2：失败不改版本

    // 诊断 → 提案（pending）；诊断不改资产
    const { diagnosis, proposal } = await diagnoseBuild({ buildId, now }, d.diagnosisDeps);
    expect(diagnosis.cause).toContain("Adafruit_SSD1306");
    expect(proposal.status).toBe("pending");
    expect(d.persistence.mem.versions.size).toBe(versionsBefore); // I-1：诊断不改资产
    expect(d.persistence.mem.proposals.size).toBe(1);

    // 幂等：同 build 再次诊断 → 返回既有提案
    const again = await diagnoseBuild({ buildId, now }, d.diagnosisDeps);
    expect(again.proposal.id).toBe(proposal.id);
    expect(d.persistence.mem.proposals.size).toBe(1);

    // 非失败记录不可诊断
    await expect(diagnoseBuild({ buildId: "nope", now }, d.diagnosisDeps)).rejects.toThrow(/not found/i);
  });

  it("fix Accept → 恰一新 Firmware 版本（platformio.ini +lib_deps）；Reject → 零变化", async () => {
    const d = deps();
    const { project, versionId, fwId } = await seedJourney(d);
    const versionsBefore = d.persistence.mem.versions.size;

    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "failed");
    const { proposal } = await diagnoseBuild({ buildId, now }, d.diagnosisDeps);

    // Accept（用户决策——禁止自动修复）→ 恰一新版本
    await resolveProposal({ proposalId: proposal.id, decision: "accept", now }, d.proposalDeps);
    expect(d.persistence.mem.versions.size).toBe(versionsBefore + 1);
    const versions = await d.persistence.listVersions(fwId);
    const latest = versions[versions.length - 1]!;
    expect(latest.versionNo).toBe(2);
    expect(latest.sourceKind).toBe("proposal");
    // platformio.ini 真实文件含 lib_deps
    const pio = await d.content.load(latest.contentRef.replace("src/main.cpp", "platformio.ini"));
    expect(pio).toContain("Adafruit SSD1306@^2.5.10");
    expect(pio).toContain("lib_deps");

    // 重建（复用 S7；修复后工具链成功）→ 新 BuildRecord 而非新版本
    const versionsAfterRebuild = d.persistence.mem.versions.size;
    const { buildId: buildId2 } = await runBuild(
      { projectId: project.id, versionId: latest.id },
      { ...d.buildDeps, compiler: createMockCompiler() },
    );
    await waitFor(async () => (await getBuildRecord({ buildId: buildId2 }, d.buildDeps))?.status === "succeeded");
    expect(d.persistence.mem.versions.size).toBe(versionsAfterRebuild); // 重建不产生版本
    expect(d.persistence.mem.builds.size).toBe(2);
  });

  it("Reject → 零版本变化（I-3）", async () => {
    const d = deps();
    const { project, versionId } = await seedJourney(d);
    const versionsBefore = d.persistence.mem.versions.size;
    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "failed");
    const { proposal } = await diagnoseBuild({ buildId, now }, d.diagnosisDeps);
    await resolveProposal({ proposalId: proposal.id, decision: "reject", now }, d.proposalDeps);
    expect(d.persistence.mem.versions.size).toBe(versionsBefore);
  });

  it("applyLineDiff：确定性 + 幂等（已包含则跳过）", () => {
    const base = "[env:esp32s3]\nplatform = espressif32\nboard = esp32-s3-devkitc-1\nframework = arduino\n";
    const diff = "\n+lib_deps =\n+    adafruit/Adafruit SSD1306@^2.5.10\n";
    const next = applyLineDiff(base, diff);
    expect(next).toContain("lib_deps =");
    expect(next).toContain("Adafruit SSD1306@^2.5.10");
    expect(applyLineDiff(next, diff)).toBe(next); // 幂等
  });

  it("非失败记录诊断 → BuildNotFailedError（409 语义）", async () => {
    const d = deps();
    const { project, versionId } = await seedJourney(d);
    const successCompiler = createMockCompiler();
    const run = await runBuild({ projectId: project.id, versionId }, { ...d.buildDeps, compiler: successCompiler });
    await waitFor(async () => (await getBuildRecord({ buildId: run.buildId }, d.buildDeps))?.status === "succeeded");
    await expect(diagnoseBuild({ buildId: run.buildId, now }, d.diagnosisDeps)).rejects.toThrow(BuildNotFailedError);
  });
});
