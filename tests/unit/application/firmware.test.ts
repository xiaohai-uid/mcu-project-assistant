// unit/application/firmware — S6 固件提案（application-contract 2.11；ISSUE-008 §11）
// 只产出 Proposal 不写版本（I-1）；Accept → 真实文件 + firmware/pinmap/wiring 联动（T2）；
// Reject 零变化（I-3）；引脚变更 → 旧固件提案 accept 必须 OutdatedProposal。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { StaleMarkDto } from "@/src/shared-contracts/types";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { generateFirmwareProposal } from "@/src/application/capabilities/firmware";
import { resolveProposal } from "@/src/application/capabilities/proposals";
import { generatePinMap } from "@/src/application/capabilities/wiring";
import { selectMcu } from "@/src/application/capabilities/mcu";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { commitManualEdit } from "@/src/application/capabilities/artifacts";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";
import { OutdatedProposalError } from "@/src/domain/models/proposal";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  proposals: Map<string, Proposal>;
  stale: Map<string, StaleMarkDto>;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s6-"));
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
  };
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void mem.projects.set(p.id, p),
        archiveProject: (id, at, reason) => {
          const p = mem.projects.get(id);
          if (p) mem.projects.set(id, { ...p, archivedAt: at, archivedReason: reason });
        },
        getProject: (id) => mem.projects.get(id) ?? null,
        listProjects: () => [...mem.projects.values()],
        createArtifact: (a) => void mem.artifacts.set(a.id, a),
        setCurrentVersion: (artifactId, versionId) => {
          const a = mem.artifacts.get(artifactId);
          if (a) mem.artifacts.set(artifactId, { ...a, currentVersionId: versionId });
        },
        createVersion: (v) => {
          const dup = [...mem.versions.values()].some(
            (x) => x.artifactId === v.artifactId && x.versionNo === v.versionNo,
          );
          if (dup) throw new Error("UNIQUE constraint failed");
          mem.versions.set(v.id, v);
        },
        setVersionStatus: (id, status) => {
          const v = mem.versions.get(id);
          if (v) mem.versions.set(id, { ...v, status });
        },
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: (p) => void mem.proposals.set(p.id, p),
        resolveProposal: (p) => void mem.proposals.set(p.id, p),
        createValidationRecord: () => {},
        saveStaleMarks: (marks) => {
          for (const m of marks) mem.stale.set(m.id, m);
        },
        createBuildRecord: () => {},
        updateBuildRecord: () => {},
        resolveStaleMarks: (artifactId, versionId) => {
          for (const m of mem.stale.values()) {
            if (m.artifactId === artifactId && m.resolvedAt === null) {
              mem.stale.set(m.id, { ...m, resolvedAt: versionId ?? NOW });
            }
          }
        },
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
    getBuildRecord: async () => null,
    listBuilds: async () => [],
    activeStaleMarks: async (projectId) =>
      [...mem.stale.values()].filter((m) => m.projectId === projectId && m.resolvedAt === null),
  };
  return { ...port, mem };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

function deps() {
  const persistence = fakePersistence();
  const content = createWorkspaceFilesContent(join(dir, "ws"));
  const events = fakeEvents();
  return { persistence, content, events, now };
}

/** 预置：需求 v1 → ESP32-S3 → pinmap v1（IO12 strapping 场景；S5A 链路） */
async function seedJourney(d: ReturnType<typeof deps>): Promise<Project> {
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
  return project;
}

describe("generate_firmware_proposal（contract 2.11；I-1 只产出提案）", () => {
  it("生成 → Proposal（type=firmware，payload=files，diff IO12→IO21，base=pinmap 版本）；不写版本", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const versionsBefore = d.persistence.mem.versions.size;

    const { proposal, generation } = await generateFirmwareProposal({ projectId: project.id }, d);

    expect(proposal.type).toBe("firmware");
    expect(proposal.status).toBe("pending");
    const files = JSON.parse(proposal.payload) as { "src/main.cpp": string; "platformio.ini": string };
    expect(files["src/main.cpp"]).toContain("#define PUMP_RELAY_PIN   21"); // 重映射后的代码
    expect(files["platformio.ini"]).toContain("[env:esp32s3]");
    expect(generation.bootRisk).toBe(true);
    // diff 可见（contract：语义变化必须 diff 可见）
    expect(proposal.diff).toMatchObject({ oldPin: "IO12", newPin: "IO21", bootRisk: true });
    expect(proposal.impacts).toEqual(["firmware", "pinmap", "wiring"]);
    // base = pinmap 当前版本（OutdatedProposal 基准）
    const pm = await d.persistence.getArtifactByKind(project.id, "pinmap");
    expect(proposal.baseVersionId).toBe(pm!.currentVersionId);
    // 不写版本（I-1：门禁无例外）
    expect(d.persistence.mem.versions.size).toBe(versionsBefore);
  });

  it("Accept → 写真实文件（workspace 存在且可读）+ Firmware v1 + Pin Map v2（继电器 IO21）+ Wiring v1（T2 联动）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const { proposal } = await generateFirmwareProposal({ projectId: project.id }, d);

    await resolveProposal({ proposalId: proposal.id, decision: "accept", now }, d);

    // 真实文件（Git-friendly；固件源码不在 SQLite——contentRef 指向 main.cpp 文件）
    const fw = await d.persistence.getArtifactByKind(project.id, "firmware");
    const fwVersion = await d.persistence.getVersion(fw!.currentVersionId!);
    expect(fwVersion?.versionNo).toBe(1);
    expect(fwVersion?.sourceKind).toBe("proposal");
    expect(fwVersion?.sourceProposalId).toBe(proposal.id);
    const mainPath = join(dir, "ws", fwVersion!.contentRef);
    expect(existsSync(mainPath)).toBe(true);
    const code = readFileSync(mainPath, "utf8");
    expect(code).toContain("#define PUMP_RELAY_PIN   21");
    const pioPath = join(dir, "ws", fwVersion!.contentRef.replace("src/main.cpp", "platformio.ini"));
    expect(existsSync(pioPath)).toBe(true);
    // 联动：Pin Map v2（继电器 IO21）
    const pm = await d.persistence.getArtifactByKind(project.id, "pinmap");
    const pmVersions = await d.persistence.listVersions(pm!.id);
    expect(pmVersions.length).toBe(2);
    const pmV2 = pmVersions[1]!;
    const pmContent = await d.content.load(pmV2.contentRef);
    const pinMap = (JSON.parse(pmContent) as { pinMap: Array<{ component: string; pinId: string }> }).pinMap;
    const relay = pinMap.find((p) => /pump|relay/i.test(p.component));
    expect(relay?.pinId).toBe("IO21");
    // 联动：Wiring v1
    const wiring = await d.persistence.getArtifactByKind(project.id, "wiring");
    expect(wiring?.currentVersionId).toBeTruthy();
  });

  it("Reject → 零版本变化（I-3）+ 提案 rejected", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const versionsBefore = d.persistence.mem.versions.size;
    const { proposal } = await generateFirmwareProposal({ projectId: project.id }, d);

    const decided = await resolveProposal({ proposalId: proposal.id, decision: "reject", now }, d);
    expect(decided.status).toBe("rejected");
    expect(d.persistence.mem.versions.size).toBe(versionsBefore);
  });

  it("OutdatedProposal（固件场景）：引脚被改后旧固件提案 accept → 拒绝应用", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const { proposal } = await generateFirmwareProposal({ projectId: project.id }, d);

    // 期间引脚被改（S2 手动路径 → pinmap v2）
    const pm = await d.persistence.getArtifactByKind(project.id, "pinmap");
    await commitManualEdit(
      {
        artifactId: pm!.id,
        content: JSON.stringify({
          pinMap: [
            { component: "Capacitive Soil Sensor", pinId: "IO4", type: "Analog" },
            { component: "5V Pump Relay Driver", pinId: "IO21", type: "Digital" },
            { component: "OLED Display (SDA)", pinId: "IO8", type: "I2C" },
            { component: "OLED Display (SCL)", pinId: "IO9", type: "I2C" },
          ],
          issues: [],
        }),
      },
      { persistence: d.persistence, content: d.content, events: d.events },
    );

    await expect(
      resolveProposal({ proposalId: proposal.id, decision: "accept", now }, d),
    ).rejects.toThrow(OutdatedProposalError);
  });

  it("无 Pin Map → 409 语义（no_pin_map）", async () => {
    const d = deps();
    const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
    await expect(generateFirmwareProposal({ projectId: project.id }, d)).rejects.toThrow(/Pin Map required/i);
  });
});
