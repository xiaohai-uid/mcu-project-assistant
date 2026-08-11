// unit/application/mcu — recommend_mcu / select_mcu（application-contract 2.6/2.7；ISSUE-005 §11）
// 候选+约束警告（对照已接受需求）；select 首选 v1 / 更换 v2；invalid_mcu。
import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import { recommendMcu, selectMcu } from "@/src/application/capabilities/mcu";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  proposals: Map<string, Proposal>;
}

function fakePersistence(): PersistencePort & { mem: FakeMem } {
  const mem: FakeMem = { projects: new Map(), artifacts: new Map(), versions: new Map(), proposals: new Map() };
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
        saveStaleMarks: () => {},
        resolveStaleMarks: () => {},
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
    latestValidation: async () => null,
    activeStaleMarks: async () => [],
    getProposal: async (id) => mem.proposals.get(id) ?? null,
    listProposals: async (projectId) => [...mem.proposals.values()].filter((p) => p.projectId === projectId),
  };
  return { ...port, mem };
}

function fakeContent(): ArtifactContentPort {
  const map = new Map<string, string>();
  return {
    store: async (ref, content) => {
      const refKey = `${ref.kind}/${String(ref.versionNo).padStart(4, "0")}.json`;
      map.set(refKey, content);
      return { contentRef: refKey, contentHash: `sha256:${content.length}` };
    },
    load: async (contentRef) => map.get(contentRef) ?? "",
    hash: async (c) => `sha256:${c.length}`,
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

async function seedProject(port: PersistencePort): Promise<Project> {
  return createProjectCapability({ name: "G", now }, { persistence: port });
}

/** 预置 requirements artifact v1（recommend 的输入：能力需求） */
async function seedRequirements(port: PersistencePort, contentPort: ArtifactContentPort, body: Record<string, unknown>) {
  const project = await seedProject(port);
  const artifact = { id: "req-art", projectId: project.id, kind: "requirements" as const, currentVersionId: null, createdAt: NOW };
  await port.withTransaction((uow) => uow.createArtifact(artifact));
  await contentPort.store({ projectId: project.id, kind: "requirements", versionNo: 1 }, JSON.stringify(body));
  const version: ArtifactVersion = {
    id: "req-v1",
    artifactId: artifact.id,
    versionNo: 1,
    contentRef: "requirements/0001.json",
    contentHash: "h",
    status: "accepted",
    sourceKind: "proposal",
    sourceProposalId: null,
    createdAt: NOW,
    createdBy: "owner",
  };
  await port.withTransaction((uow) => {
    uow.createVersion(version);
    uow.setCurrentVersion(artifact.id, version.id);
  });
  return { project, artifact, version };
}

function deps() {
  const persistence = fakePersistence();
  const content = fakeContent();
  const events = fakeEvents();
  return { persistence, content, events, now };
}

describe("recommend_mcu（application-contract 2.6；knowledge 求值）", () => {
  it("候选矩阵：3 类（推荐 ESP32-S3 / 备选 RP2040 / 工业级 STM32F401RE）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [{ id: "req-1", title: "Soil moisture monitoring", status: "complete" }],
    });
    const result = await recommendMcu(
      { projectId: project.id },
      { persistence: d.persistence, content: d.content },
    );
    expect(result.candidates.map((c) => c.id)).toEqual(["ESP32-S3", "RP2040", "STM32F401RE"]);
  });

  it("约束警告：RP2040/STM32 无 Wi-Fi（对照无线需求）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [
        { id: "req-1", title: "Soil moisture monitoring", status: "complete" },
        { id: "req-2", title: "Wireless telemetry", status: "complete" },
      ],
      acceptedTitles: ["Wireless Connectivity"],
    });
    const result = await recommendMcu({ projectId: project.id }, { persistence: d.persistence, content: d.content });
    const rp2040 = result.candidates.find((c) => c.id === "RP2040")!;
    const stm32 = result.candidates.find((c) => c.id === "STM32F401RE")!;
    expect(rp2040.constraints.some((c) => /Wi-Fi/i.test(c))).toBe(true);
    expect(stm32.constraints.some((c) => /Wi-Fi/i.test(c))).toBe(true);
    const s3 = result.candidates.find((c) => c.id === "ESP32-S3")!;
    expect(s3.constraints).toEqual([]);
  });

  it("外设映射：从需求能力推导（soil→sensor、pump/relay→relay、display→oled）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [
        { id: "req-1", title: "Soil moisture monitoring", status: "complete" },
        { id: "req-2", title: "Water pump control", status: "complete" },
        { id: "req-3", title: "Local status display", status: "complete" },
      ],
    });
    const result = await recommendMcu({ projectId: project.id }, { persistence: d.persistence, content: d.content });
    const ids = result.peripherals.map((p) => p.id);
    expect(ids).toContain("sensor.soil_moisture");
    expect(ids).toContain("actuator.relay");
    expect(ids).toContain("display.oled_096");
  });

  it("项目不存在 → not found", async () => {
    const d = deps();
    await expect(
      recommendMcu({ projectId: "missing" }, { persistence: d.persistence, content: d.content }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("select_mcu（application-contract 2.7）", () => {
  it("首选：Hardware v1（accepted；内容=selectedMcuId+peripherals）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [{ id: "req-1", title: "Soil moisture monitoring", status: "complete" }],
    });
    const { artifact, version, changed } = await selectMcu(
      { projectId: project.id, mcuId: "ESP32-S3" },
      { persistence: d.persistence, content: d.content, events: d.events, now },
    );
    expect(changed).toBe(false);
    expect(version.versionNo).toBe(1);
    expect(version.status).toBe("accepted");
    expect(artifact.currentVersionId).toBe(version.id);
    const stored = await d.content.load(version.contentRef);
    const parsed = JSON.parse(stored) as { selectedMcuId: string };
    expect(parsed.selectedMcuId).toBe("ESP32-S3");
    // 事件
    expect(d.events.published.some((e) => e.type === "artifact.version.created")).toBe(true);
  });

  it("更换：Hardware v2 + changed=true（下游失效提示；Stale 标记 S5B）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [{ id: "req-1", title: "Soil moisture monitoring", status: "complete" }],
    });
    await selectMcu(
      { projectId: project.id, mcuId: "ESP32-S3" },
      { persistence: d.persistence, content: d.content, events: d.events, now },
    );
    const second = await selectMcu(
      { projectId: project.id, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events, now },
    );
    expect(second.changed).toBe(true);
    expect(second.version.versionNo).toBe(2);
    const stored = await d.content.load(second.version.contentRef);
    expect((JSON.parse(stored) as { selectedMcuId: string }).selectedMcuId).toBe("RP2040");
  });

  it("同 MCU 重复选择：幂等（不产生新版本）", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [{ id: "req-1", title: "Soil moisture monitoring", status: "complete" }],
    });
    await selectMcu(
      { projectId: project.id, mcuId: "ESP32-S3" },
      { persistence: d.persistence, content: d.content, events: d.events, now },
    );
    const again = await selectMcu(
      { projectId: project.id, mcuId: "ESP32-S3" },
      { persistence: d.persistence, content: d.content, events: d.events, now },
    );
    expect(again.changed).toBe(false);
    expect(again.version.versionNo).toBe(1); // 无新版本
    expect(d.persistence.mem.versions.size).toBe(2); // requirements v1 + hardware v1
  });

  it("无效 MCU → invalid_mcu", async () => {
    const d = deps();
    const { project } = await seedRequirements(d.persistence, d.content, {
      capabilities: [{ id: "req-1", title: "Soil moisture monitoring", status: "complete" }],
    });
    await expect(
      selectMcu({ projectId: project.id, mcuId: "PIC16F877A" }, { persistence: d.persistence, content: d.content, events: d.events, now }),
    ).rejects.toThrow(/invalid/i);
  });
});
