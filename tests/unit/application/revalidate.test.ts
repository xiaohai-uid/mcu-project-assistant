// unit/application/revalidate — revalidate_artifact（application-contract 2.14；ISSUE-007 §11）
// 无语义变化→Validated；有语义变化→create_proposal 待决策（D1 不自动接受）；门禁拒绝（I-8 L3）。
import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { StaleMarkDto } from "@/src/shared-contracts/types";
import {
  revalidateArtifact,
  activeStaleMarks,
  assertNotBlocking,
  BlockingStaleError,
} from "@/src/application/capabilities/revalidate";
import { selectMcu } from "@/src/application/capabilities/mcu";
import { generatePinMap } from "@/src/application/capabilities/wiring";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { ensureArtifact, commitManualEdit } from "@/src/application/capabilities/artifacts";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  proposals: Map<string, Proposal>;
  stale: Map<string, StaleMarkDto>;
}

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

function fakeContent(): ArtifactContentPort {
  const map = new Map<string, string>();
  return {
    store: async (ref, content) => {
      const key = `${ref.kind}/${String(ref.versionNo).padStart(4, "0")}.json`;
      map.set(key, content);
      return { contentRef: key, contentHash: `sha256:${content.length}` };
    },
    load: async (contentRef) => map.get(contentRef) ?? "",
    hash: async (c) => `sha256:${c.length}`,
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

function deps() {
  const persistence = fakePersistence();
  const content = fakeContent();
  const events = fakeEvents();
  return { persistence, content, events, now };
}

/** 预置：项目 + requirements v1 + hardware v1(ESP32-S3) + pinmap v1 + wiring v1 + firmware v1
 *  wiring/firmware 用 S2 手动路径建占位版本（S6/S7 前置；S5B 需要真实下游 artifact 才能打标） */
async function seedJourney(d: ReturnType<typeof deps>): Promise<Project> {
  const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
  const req = domainCreateArtifact({ projectId: project.id, kind: "requirements", now });
  await d.persistence.withTransaction((uow) => uow.createArtifact(req));
  await d.content.store(
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
      id: "req-v1", artifactId: req.id, versionNo: 1, contentRef: "requirements/0001.json",
      contentHash: "h", status: "accepted", sourceKind: "proposal", sourceProposalId: null,
      createdAt: NOW, createdBy: "owner",
    });
    uow.setCurrentVersion(req.id, "req-v1");
  });
  await selectMcu(
    { projectId: project.id, mcuId: "ESP32-S3" },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  await generatePinMap({ projectId: project.id }, d);
  const wiring = await ensureArtifact({ projectId: project.id, kind: "wiring" }, d);
  await commitManualEdit(
    { artifactId: wiring!.id, content: JSON.stringify({ wiring: [] }) },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  const firmware = await ensureArtifact({ projectId: project.id, kind: "firmware" }, d);
  await commitManualEdit(
    { artifactId: firmware!.id, content: JSON.stringify({ code: "// v1 placeholder" }) },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  return project;
}

describe("revalidate_artifact（application-contract 2.14；D1）", () => {
  it("换 MCU 后：pinmap/wiring/firmware 全部 L3（硬约束破坏；传递闭包；I-4 不删除下游）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const before = await activeStaleMarks({ projectId: project.id }, d);
    expect(before).toHaveLength(0);

    // 更换 MCU → 依赖求值自动触发（T1/T2 同事务）
    await selectMcu(
      { projectId: project.id, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    const marks = await activeStaleMarks({ projectId: project.id }, d);
    const kindOf = (m: StaleMarkDto) => d.persistence.mem.artifacts.get(m.artifactId)?.kind ?? m.artifactId;
    const kinds = marks.map(kindOf).sort();
    expect(kinds).toEqual(["firmware", "pinmap", "wiring"].sort());
    expect(marks.every((m: StaleMarkDto) => m.level === "L3")).toBe(true);
  });

  it("L3 门禁：BlockingStale 拒绝（flash/标成功/宣称 Validated 的前置校验；I-8）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    await selectMcu(
      { projectId: project.id, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    await expect(assertNotBlocking({ projectId: project.id, action: "flash" }, d)).rejects.toThrow(BlockingStaleError);
    await expect(assertNotBlocking({ projectId: project.id, action: "mark_validated" }, d)).rejects.toThrow(BlockingStaleError);
  });

  it("Revalidate：无语义变化（pinmap 重算同内容）→ Validated（resolved；不产生 Proposal；无版本副作用）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    // 换 MCU → L3 marks；随后按新决策重新生成 pinmap（决策同源：v2 = RP2040 分配）
    await selectMcu(
      { projectId: project.id, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    await generatePinMap({ projectId: project.id }, d);
    const pmBefore = await d.persistence.getArtifactByKind(project.id, "pinmap");
    const versionsBefore = await d.persistence.listVersions(pmBefore!.id);
    // revalidate pinmap：重算（RP2040 平台）→ 与当前 v2 内容一致 → 无语义变化 → Validated
    const result = await revalidateArtifact({ projectId: project.id, kind: "pinmap" }, d);
    expect(result.outcome).toBe("validated");
    expect(d.persistence.mem.proposals.size).toBe(0); // 无新 Proposal（D1：不自动接受也不需要提案）
    // 重算不得产生版本副作用（revalidate 是纯计算，不 commit 新版本）
    const versionsAfter = await d.persistence.listVersions(pmBefore!.id);
    expect(versionsAfter.length).toBe(versionsBefore.length);
    const marks = await activeStaleMarks({ projectId: project.id }, d);
    expect(marks.some((m: StaleMarkDto) => d.persistence.mem.artifacts.get(m.artifactId)?.kind === "pinmap")).toBe(false);
  });

  it("Revalidate：有语义变化 → create_proposal 待决策（不自动接受——D1 核心）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    // 换 MCU → L3；pinmap 被手动改过（与重算结果不同）→ revalidate 产生提案
    await selectMcu(
      { projectId: project.id, mcuId: "RP2040" },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    // 手动改 pinmap v2（继电器 → IO99，与重算不一致）
    const { commitManualEdit } = await import("@/src/application/capabilities/artifacts");
    const pm = await d.persistence.getArtifactByKind(project.id, "pinmap");
    await commitManualEdit(
      {
        artifactId: pm!.id,
        content: JSON.stringify({
          pinMap: [{ component: "Relay", pinId: "IO99", type: "Digital" }],
          issues: [],
        }),
      },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    const result = await revalidateArtifact({ projectId: project.id, kind: "pinmap" }, d);
    expect(result.outcome).toBe("proposal_created");
    // 提案 pending（不自动接受——D1）
    const proposals = [...d.persistence.mem.proposals.values()];
    expect(proposals.length).toBe(1);
    expect(proposals[0]?.status).toBe("pending");
    // 仍有 active mark（等待决策）
    const marks = await activeStaleMarks({ projectId: project.id }, d);
    expect(marks.some((m: StaleMarkDto) => d.persistence.mem.artifacts.get(m.artifactId)?.kind === "pinmap")).toBe(true);
  });

  it("无 stale 时 revalidate → 409 语义（无操作对象）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    await expect(revalidateArtifact({ projectId: project.id, kind: "pinmap" }, d)).rejects.toThrow(/stale/i);
  });
});
