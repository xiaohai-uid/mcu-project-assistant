// unit/application/commit-manual-edit — 手动编辑版本提交（application-contract 2.1b；ISSUE-002 §11）
// I-11：手动编辑免 Proposal 直接产生新版本；仍触发依赖求值（本票只留 seam，S5B 实现）。
import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import {
  commitManualEdit,
  ensureArtifact,
  listArtifacts,
  listVersions,
} from "@/src/application/capabilities/artifacts";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMemory {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
}

function fakePersistence(): PersistencePort & { mem: FakeMemory } {
  const mem: FakeMemory = { projects: new Map(), artifacts: new Map(), versions: new Map() };
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void mem.projects.set(p.id, p),
        archiveProject: (id, archivedAt, reason) => {
          const p = mem.projects.get(id);
          if (p) mem.projects.set(id, { ...p, archivedAt, archivedReason: reason });
        },
        getProject: (id) => mem.projects.get(id) ?? null,
        listProjects: () => [...mem.projects.values()],
        createArtifact: (a) => void mem.artifacts.set(a.id, a),
        setCurrentVersion: (artifactId, versionId) => {
          const a = mem.artifacts.get(artifactId);
          if (a) mem.artifacts.set(artifactId, { ...a, currentVersionId: versionId });
        },
        createVersion: (v) => {
          // UNIQUE(artifact_id, version_no) 的 fake 等价：重复 version_no 拒绝
          const dup = [...mem.versions.values()].some(
            (x) => x.artifactId === v.artifactId && x.versionNo === v.versionNo,
          );
          if (dup) throw new Error("UNIQUE constraint failed: artifact_versions(artifact_id, version_no)");
          mem.versions.set(v.id, v);
        },
        setVersionStatus: (id, status) => {
          const v = mem.versions.get(id);
          if (v) mem.versions.set(id, { ...v, status });
        },
        // S3A 任务方法：本测试不使用
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: () => {},
        resolveProposal: () => {},
      };
      return fn(uow);
    },
    getProject: async (id) => mem.projects.get(id) ?? null,
    listProjects: async () => [...mem.projects.values()],
    getArtifact: async (id) => mem.artifacts.get(id) ?? null,
    getArtifactByKind: async (projectId, kind) =>
      [...mem.artifacts.values()].find((a) => a.projectId === projectId && a.kind === kind) ?? null,
    listArtifacts: async (projectId) =>
      [...mem.artifacts.values()].filter((a) => a.projectId === projectId),
    getVersion: async (id) => mem.versions.get(id) ?? null,
    listVersions: async (artifactId) =>
      [...mem.versions.values()]
        .filter((v) => v.artifactId === artifactId)
        .sort((a, b) => a.versionNo - b.versionNo),
    getTask: async () => null,
    latestTaskOutput: async () => null,
    getProposal: async () => null,
    listProposals: async () => [],
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
    load: async (contentRef) => {
      const c = calls.find((x) => x.ref === contentRef);
      if (!c) throw new Error("not found");
      return c.content;
    },
    hash: async (content) => `sha256:${content.length}`,
    calls,
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return {
    publish: (e) => {
      published.push(e);
    },
    published,
  };
}

async function seedProject(port: PersistencePort): Promise<Project> {
  return createProjectCapability({ name: "Greenhouse", now }, { persistence: port });
}

describe("ensure_artifact（聚合容器懒创建；ISSUE-002 §8）", () => {
  it("首次：创建 Artifact（kind 校验、currentVersionId null）；再次：返回同一实例（UNIQUE(project_id,kind)）", async () => {
    const port = fakePersistence();
    const project = await seedProject(port);
    const a1 = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });
    const a2 = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });
    expect(a1!.id).toBe(a2!.id);
    expect(a1!.kind).toBe("pinmap");
    expect(a1!.currentVersionId).toBeNull();
    expect((await listArtifacts({ projectId: project.id }, { persistence: port })).length).toBe(1);
  });

  it("项目不存在 → null（transport 映射 404）", async () => {
    const port = fakePersistence();
    const a = await ensureArtifact({ projectId: "missing", kind: "pinmap" }, { persistence: port });
    expect(a).toBeNull();
  });

  it("已归档项目 → 拒绝（归档只读，I-10）", async () => {
    const port = fakePersistence();
    const project = await seedProject(port);
    await port.withTransaction((uow) => uow.archiveProject(project.id, NOW, "user request"));
    await expect(
      ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port }),
    ).rejects.toThrow();
  });
});

describe("commit_manual_edit（application-contract 2.1b；I-11 手动路径免 Proposal）", () => {
  it("首次提交：v1 直接 accepted，source_kind=manual，created_by=owner，无需 Proposal", async () => {
    const port = fakePersistence();
    const content = fakeContent();
    const events = fakeEvents();
    const project = await seedProject(port);
    const artifact = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });

    const version = await commitManualEdit(
      { artifactId: artifact!.id, content: JSON.stringify({ pins: [{ component: "Relay", pinId: "IO12" }] }), now },
      { persistence: port, content, events },
    );

    expect(version.versionNo).toBe(1);
    expect(version.status).toBe("accepted");
    expect(version.sourceKind).toBe("manual");
    expect(version.sourceProposalId).toBeNull();
    expect(version.createdBy).toBe("owner");

    const cur = await port.getArtifact(artifact!.id);
    expect(cur?.currentVersionId).toBe(version.id);
    expect(content.calls).toHaveLength(1);
    expect(content.calls[0]?.ref).toBe("pinmap/0001.json");
  });

  it("再次提交：version_no 单调 +1，内容更新", async () => {
    const port = fakePersistence();
    const content = fakeContent();
    const events = fakeEvents();
    const project = await seedProject(port);
    const artifact = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });

    const v1 = await commitManualEdit(
      { artifactId: artifact!.id, content: JSON.stringify({ pins: [{ component: "Relay", pinId: "IO12" }] }) },
      { persistence: port, content, events },
    );
    const v2 = await commitManualEdit(
      { artifactId: artifact!.id, content: JSON.stringify({ pins: [{ component: "Relay", pinId: "IO21" }] }) },
      { persistence: port, content, events },
    );

    expect(v2.versionNo).toBe(v1.versionNo + 1);
    const versions = await listVersions({ artifactId: artifact!.id }, { persistence: port });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.versionNo).toBe(1);
    expect(versions[1]?.versionNo).toBe(2);
  });

  it("内容写入失败 → 无版本行（事务 T1 原子性）", async () => {
    const port = fakePersistence();
    const content: ArtifactContentPort = {
      store: async () => {
        throw new Error("disk full");
      },
      load: async () => "",
      hash: async () => "x",
    };
    const events = fakeEvents();
    const project = await seedProject(port);
    const artifact = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });

    await expect(
      commitManualEdit({ artifactId: artifact!.id, content: "{}" }, { persistence: port, content, events }),
    ).rejects.toThrow("disk full");
    expect((await listVersions({ artifactId: artifact!.id }, { persistence: port })).length).toBe(0);
    // current 指针未被污染
    const cur = await port.getArtifact(artifact!.id);
    expect(cur?.currentVersionId).toBeNull();
  });

  it("Artifact 不存在 → 抛 not-found 语义错误（不静默创建）", async () => {
    const port = fakePersistence();
    const project = await seedProject(port);
    await expect(
      commitManualEdit(
        { artifactId: "no-such-artifact", content: "{}" },
        { persistence: port, content: fakeContent(), events: fakeEvents() },
      ),
    ).rejects.toThrow(/not found/i);
    void project;
  });

  it("空内容 → invalid_content", async () => {
    const port = fakePersistence();
    const project = await seedProject(port);
    const artifact = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });
    await expect(
      commitManualEdit(
        { artifactId: artifact!.id, content: "   " },
        { persistence: port, content: fakeContent(), events: fakeEvents() },
      ),
    ).rejects.toThrow(/non-empty/i);
  });

  it("事件：每次提交发 artifact.version.created（事件发布 seam；SSE 端点延后 S3A）", async () => {
    const port = fakePersistence();
    const content = fakeContent();
    const events = fakeEvents();
    const project = await seedProject(port);
    const artifact = await ensureArtifact({ projectId: project.id, kind: "pinmap" }, { persistence: port });

    await commitManualEdit({ artifactId: artifact!.id, content: "{}" }, { persistence: port, content, events });
    await commitManualEdit({ artifactId: artifact!.id, content: "{}" }, { persistence: port, content, events });

    expect(events.published.filter((e) => e.type === "artifact.version.created")).toHaveLength(2);
    const first = events.published[0];
    if (first?.type === "artifact.version.created") {
      expect(first.projectId).toBe(project.id);
      expect(first.artifactId).toBe(artifact!.id);
      expect(first.versionNo).toBe(1);
    }
  });
});
