// ports/persistence.ts — PersistencePort（S1 最小集 + S2 artifacts/versions；ISSUE-001 §9 / ISSUE-002 §3）
// 按事务边界聚合访问；只放当前 Slice 需要的操作（禁止提前加入 saveProposal 等）。
// UnitOfWork 方法为同步：M1 唯一真实适配器是 better-sqlite3（同步驱动），接口对适配器诚实；
// 未来 Cloud 适配器按需演进接口（禁止现在投机异步化）。

import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactKind, ArtifactVersionStatus } from "@/src/shared-contracts/types";

export interface UnitOfWork {
  // S1
  createProject(p: Project): void;
  archiveProject(id: string, archivedAt: string, reason: string | null): void;
  getProject(id: string): Project | null;
  listProjects(): Project[];
  // S2
  createArtifact(a: Artifact): void;
  setCurrentVersion(artifactId: string, versionId: string): void;
  createVersion(v: ArtifactVersion): void;
  setVersionStatus(id: string, status: ArtifactVersionStatus): void;
}

export interface PersistencePort {
  /** 需要原子事务的一组操作；fn 内抛错 → 全回滚 */
  withTransaction<T>(fn: (uow: UnitOfWork) => T): Promise<T>;
  // 只读查询可不经事务：
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  // S2
  getArtifact(id: string): Promise<Artifact | null>;
  getArtifactByKind(projectId: string, kind: ArtifactKind): Promise<Artifact | null>;
  listArtifacts(projectId: string): Promise<Artifact[]>;
  getVersion(id: string): Promise<ArtifactVersion | null>;
  listVersions(artifactId: string): Promise<ArtifactVersion[]>;
}
