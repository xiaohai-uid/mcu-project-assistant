// unit/application/resolve-proposal — 提案决策能力（application-contract 2.4/2.5；ISSUE-004 §11）
// Reject 零 artifact 变化；Accept 恰一新版本（proceed 提交聚合）；OutdatedProposal 三层之一；
// 幂等同决策 no-op；决策可逆。
import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import {
  createProposal as createProposalCapability,
  resolveProposal,
  commitRequirements,
  listProposals,
  OutdatedProposalError,
} from "@/src/application/capabilities/proposals";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";

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
    getProposal: async (id) => mem.proposals.get(id) ?? null,
    listProposals: async (projectId) =>
      [...mem.proposals.values()].filter((p) => p.projectId === projectId),
  };
  return { ...port, mem };
}

function fakeContent(): ArtifactContentPort & { calls: Array<{ ref: string; content: string }> } {
  const calls: Array<{ ref: string; content: string }> = [];
  return {
    store: async (ref, content) => {
      const contentRef = `${ref.kind}/${String(ref.versionNo).padStart(4, "0")}.json`;
      calls.push({ ref: contentRef, content });
      return { contentRef, contentHash: `sha256:${content.length}` };
    },
    load: async (contentRef) => calls.find((c) => c.ref === contentRef)?.content ?? "",
    hash: async (c) => `sha256:${c.length}`,
    calls,
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

async function seedProject(port: PersistencePort): Promise<Project> {
  return createProjectCapability({ name: "G", now }, { persistence: port });
}

async function seedRequirementsArtifact(port: PersistencePort): Promise<Artifact> {
  const project = await seedProject(port);
  const artifact = domainCreateArtifact({ projectId: project.id, kind: "requirements", now });
  await port.withTransaction((uow) => uow.createArtifact(artifact));
  return artifact;
}

function deps() {
  const persistence = fakePersistence();
  const content = fakeContent();
  const events = fakeEvents();
  return {
    persistence,
    content,
    events,
    now,
    pdeps: { persistence },
    rdeps: { persistence, content, events },
  };
}

const proposalInput = {
  projectId: "p1",
  artifactId: "a1",
  baseVersionId: null,
  type: "requirement" as const,
  payload: JSON.stringify({ title: "Wireless", initialIdea: "wifi", formalizedRequirement: "802.11 b/g/n + BLE 5.0" }),
  diff: { from: "wifi", to: "802.11 b/g/n + BLE 5.0" },
  impacts: ["Hardware"],
  reason: null,
};

describe("create_proposal（内部能力；application-contract 2.4）", () => {
  it("创建：引用 base 版本，初始 pending，零写入", async () => {
    const { persistence, pdeps } = deps();
    const project = await seedProject(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: project.id },
      pdeps,
    );
    expect(p.status).toBe("pending");
    expect(p.baseVersionId).toBeNull();
    expect((await listProposals({ projectId: project.id }, pdeps)).length).toBe(1);
  });
});

describe("resolve_proposal（application-contract 2.5）", () => {
  it("Reject：零 artifact 变化（T3 仅提案状态）", async () => {
    const { persistence, pdeps, rdeps } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    const decided = await resolveProposal({ proposalId: p.id, decision: "reject" }, rdeps);
    expect(decided.status).toBe("rejected");
    expect(persistence.mem.versions.size).toBe(0);
    expect(persistence.mem.artifacts.get(artifact.id)?.currentVersionId).toBeNull();
  });

  it("Accept：仅记录决策（不产生版本）；commitRequirements 恰一版本 v1（内容=accepted 聚合）", async () => {
    const { persistence, pdeps, rdeps, content } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p1 = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    const p2 = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id, payload: JSON.stringify({ title: "Data Persistence" }) },
      pdeps,
    );
    await resolveProposal({ proposalId: p1.id, decision: "accept" }, rdeps);
    await resolveProposal({ proposalId: p2.id, decision: "accept" }, rdeps);
    // accept 阶段零版本（聚合提交在 proceed）
    expect(persistence.mem.versions.size).toBe(0);

    const { artifact: committed, version } = await commitRequirements({ projectId: artifact.projectId }, rdeps);
    expect(version.versionNo).toBe(1);
    expect(version.sourceKind).toBe("proposal");
    expect(committed.currentVersionId).toBe(version.id);
    const stored = content.calls.find((c) => c.ref === "requirements/0001.json");
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!.content) as { acceptedProposalIds: string[]; capabilities: unknown[] };
    expect(parsed.acceptedProposalIds).toHaveLength(2);
  });

  it("幂等：同决策重复提交 → 同结果，无副作用（no-op）", async () => {
    const { persistence, pdeps, rdeps } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    const r1 = await resolveProposal({ proposalId: p.id, decision: "accept" }, rdeps);
    const r2 = await resolveProposal({ proposalId: p.id, decision: "accept" }, rdeps);
    expect(r2.status).toBe(r1.status);
    expect(r2.decisionHistory).toHaveLength(1); // 不重复追加
  });

  it("决策可逆：accepted → rejected（改主意），历史保留两条", async () => {
    const { persistence, pdeps, rdeps } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    await resolveProposal({ proposalId: p.id, decision: "accept" }, rdeps);
    const reverted = await resolveProposal({ proposalId: p.id, decision: "reject" }, rdeps);
    expect(reverted.status).toBe("rejected");
    expect(reverted.decisionHistory).toHaveLength(2);
  });

  it("OutdatedProposal：base 变更后 accept 必须失败（409 语义；不静默应用）", async () => {
    const { persistence, pdeps, rdeps } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    // 期间内容被改：手动提交 v1 → current=v1；提案 base=null 过期
    const content = fakeContent();
    const { commitManualEdit } = await import("@/src/application/capabilities/artifacts");
    await commitManualEdit(
      { artifactId: artifact.id, content: JSON.stringify({ manual: true }) },
      { persistence, content, events: fakeEvents() },
    );
    await expect(
      resolveProposal({ proposalId: p.id, decision: "accept" }, rdeps),
    ).rejects.toThrow(OutdatedProposalError);
    // 拒绝路径不受过期影响（Reject 零效果，始终允许）
    const rejected = await resolveProposal({ proposalId: p.id, decision: "reject" }, rdeps);
    expect(rejected.status).toBe("rejected");
  });

  it("commitRequirements：无 accepted 提案 → 拒绝（零写入）", async () => {
    const { persistence, pdeps, rdeps } = deps();
    const artifact = await seedRequirementsArtifact(persistence);
    const p = await createProposalCapability(
      { ...proposalInput, projectId: artifact.projectId, artifactId: artifact.id },
      pdeps,
    );
    await resolveProposal({ proposalId: p.id, decision: "reject" }, rdeps);
    await expect(commitRequirements({ projectId: artifact.projectId }, rdeps)).rejects.toThrow(/accepted/i);
    expect(persistence.mem.versions.size).toBe(0);
  });
});
