// ports/persistence.ts — PersistencePort（S1 最小集；ISSUE-001 §9）
// 按事务边界聚合访问；只放当前 Slice 需要的操作（禁止提前加入 saveProposal 等）。
// UnitOfWork 方法为同步：M1 唯一真实适配器是 better-sqlite3（同步驱动），接口对适配器诚实；
// 未来 Cloud 适配器按需演进接口（禁止现在投机异步化）。

import type { Project } from "@/src/domain/models/project";

export interface UnitOfWork {
  createProject(p: Project): void;
  archiveProject(id: string, archivedAt: string, reason: string | null): void;
  getProject(id: string): Project | null;
  listProjects(): Project[];
}

export interface PersistencePort {
  /** 需要原子事务的一组操作；fn 内抛错 → 全回滚 */
  withTransaction<T>(fn: (uow: UnitOfWork) => T): Promise<T>;
  // 只读查询可不经事务：
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
}
