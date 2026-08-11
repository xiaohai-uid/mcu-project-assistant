import { describe, expect, it } from "vitest";
import {
  AlreadyArchivedError,
  ArchivedProjectError,
  assertNotArchived,
  InvalidProjectNameError,
} from "@/src/domain/models/project";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import { archiveProject, createProject, getProject, listProjects } from "@/src/application/capabilities/projects";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

function fakePersistence(): PersistencePort & { rows: Map<string, import("@/src/domain/models/project").Project> } {
  const rows = new Map<string, import("@/src/domain/models/project").Project>();
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void rows.set(p.id, p),
        archiveProject: (id, archivedAt, reason) => {
          const p = rows.get(id);
          if (p) rows.set(id, { ...p, archivedAt, archivedReason: reason });
        },
        getProject: (id) => rows.get(id) ?? null,
        listProjects: () => [...rows.values()],
        // S2/S3A 扩展的 UoW 方法：本测试（S1 能力）不使用，留最小 no-op
        createArtifact: () => {},
        setCurrentVersion: () => {},
        createVersion: () => {},
        setVersionStatus: () => {},
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: () => {},
        resolveProposal: () => {},
        createValidationRecord: () => {},
        saveStaleMarks: () => {},
        resolveStaleMarks: () => {},
        createBuildRecord: () => {},
        updateBuildRecord: () => {},
      };
      return fn(uow);
    },
    getProject: async (id) => rows.get(id) ?? null,
    listProjects: async () => [...rows.values()],
    // S2 扩展的只读方法：本测试不使用，留最小 no-op
    getArtifact: async () => null,
    getArtifactByKind: async () => null,
    listArtifacts: async () => [],
    getVersion: async () => null,
    listVersions: async () => [],
    getTask: async () => null,
    latestTaskOutput: async () => null,
    latestValidation: async () => null,
    activeStaleMarks: async () => [],
    getBuildRecord: async () => null,
    listBuilds: async () => [],
    getProposal: async () => null,
    listProposals: async () => [],
  };
  return { ...port, rows };
}

describe("create_project capability（application-contract 2.1；D6 归档语义）", () => {
  it("创建：合法名称 → 持久化 Project，可经 list/get 取回", async () => {
    const port = fakePersistence();
    const p = await createProject({ name: "Smart Greenhouse", now }, { persistence: port });
    expect(p.name).toBe("Smart Greenhouse");

    const listed = await listProjects({ persistence: port });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(p.id);

    const fetched = await getProject({ id: p.id }, { persistence: port });
    expect(fetched?.name).toBe("Smart Greenhouse");
  });

  it("创建：非法名称 → InvalidProjectNameError，零持久化", async () => {
    const port = fakePersistence();
    await expect(createProject({ name: "   ", now }, { persistence: port })).rejects.toThrow(InvalidProjectNameError);
    expect((await listProjects({ persistence: port })).length).toBe(0);
  });

  it("archive_project：确认后归档 → 移出活跃列表，记录保留", async () => {
    const port = fakePersistence();
    const p = await createProject({ name: "A", now }, { persistence: port });
    const archived = await archiveProject({ id: p.id, reason: "user request", now }, { persistence: port });
    expect(archived).not.toBeNull();
    expect(archived!.archivedAt).toBe(NOW);
    const active = await listProjects({ persistence: port });
    expect(active).toHaveLength(0); // 归档移出活跃列表
    const fetched = await getProject({ id: p.id }, { persistence: port });
    expect(fetched?.archivedAt).toBe(NOW); // 记录保留（不静默级联删除，I-10）
  });

  it("archive_project：不存在 → null（not_found 由 transport 映射）", async () => {
    const port = fakePersistence();
    const result = await archiveProject({ id: "missing", reason: null, now }, { persistence: port });
    expect(result).toBeNull();
  });

  it("archive_project：已归档再归档 → AlreadyArchived", async () => {
    const port = fakePersistence();
    const p = await createProject({ name: "A", now }, { persistence: port });
    await archiveProject({ id: p.id, reason: "r1", now }, { persistence: port });
    await expect(archiveProject({ id: p.id, reason: "r2", now }, { persistence: port })).rejects.toThrow(AlreadyArchivedError);
  });

  it("get_project：归档项目仍可读取（只读，I-10）", async () => {
    const port = fakePersistence();
    const p = await createProject({ name: "A", now }, { persistence: port });
    await archiveProject({ id: p.id, reason: "r", now }, { persistence: port });
    const fetched = await getProject({ id: p.id }, { persistence: port });
    expect(fetched?.archivedAt).not.toBeNull();
  });

  it("归档后编辑被拒（ArchivedProjectError 由未来编辑能力使用；此处验证领域守卫可经应用暴露）", async () => {
    const port = fakePersistence();
    const p = await createProject({ name: "A", now }, { persistence: port });
    const archived = await archiveProject({ id: p.id, reason: "r", now }, { persistence: port });
    // 未来编辑能力必须调用 assertNotArchived；本票验证归档态可被守卫拒绝
    expect(() => assertNotArchived(archived!)).toThrow(ArchivedProjectError);
  });
});
