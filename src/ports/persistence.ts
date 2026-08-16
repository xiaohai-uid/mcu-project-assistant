// ports/persistence.ts — PersistencePort（S1 projects + S2 artifacts/versions + S3A tasks + S3B proposals）
// 按事务边界聚合访问；只放当前 Slice 需要的操作。
// UnitOfWork 方法为同步：M1 唯一真实适配器是 better-sqlite3（同步驱动），接口对适配器诚实；
// 未来 Cloud 适配器按需演进接口（禁止现在投机异步化）。

import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { Project } from "@/src/domain/models/project";
import type { Proposal } from "@/src/domain/models/proposal";
import type { TaskRecord } from "@/src/ports/task-execution";
import type { ArtifactKind, ArtifactVersionStatus, BomItemDto, PhysicalAcceptanceRecordDto, PriceObservationDto, StaleMarkDto, ValidationRecordDto } from "@/src/shared-contracts/types";
import type { IdempotencyClaim, IdempotencyRecord, IdempotencyRequest } from "@/src/shared/idempotency";

export interface UnitOfWork {
  /** Atomic insert-or-observe for a logical HTTP mutation. */
  claimIdempotency?(request: IdempotencyRequest, responseStatus: number, responseBodyJson: string): IdempotencyClaim;
  updateIdempotency?(request: IdempotencyRequest, responseStatus: number, responseBodyJson: string): void;
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
  // S3A
  saveTask(t: TaskRecord): void;
  updateTask(t: TaskRecord): void;
  /** Atomic task transition; returns false when the persisted status is not in fromStatuses. */
  updateTaskIfStatus?(t: TaskRecord, fromStatuses: TaskRecord["status"][]): boolean;
  /** 取最早 queued → 置 running；恢复流程先把遗留 running 重新排回 queued。 */
  claimNextTask(): TaskRecord | null;
  /** 启动恢复前将上一进程遗留的 running 任务重新置为 queued。 */
  requeueOrphanedTasks?(): number;
  /** Requeue only tasks that were already running when this process started. */
  recoverInterruptedTasks?(): string[];
  /** Fail closed for historical build rows that have no durable task pairing. */
  repairOrphanedBuildRecords?(completedAt: string): number;
  // S3B
  createProposal(p: Proposal): void;
  resolveProposal(p: Proposal): void;
  // S5A
  createValidationRecord(v: ValidationRecordDto): void;
  // S5B
  saveStaleMarks(marks: StaleMarkDto[]): void;
  resolveStaleMarks(artifactId: string, versionId: string): void;
  // S7
  createBuildRecord(b: BuildRecord): void;
  updateBuildRecord(b: BuildRecord): void;
  // S9
  setPreference(key: string, value: string, updatedAt: string): void;
  // S9 physical acceptance (optional for legacy in-memory adapters)
  createPhysicalAcceptance?(record: PhysicalAcceptanceRecordDto): void;
  createBomItem?(item: BomItemDto): void;
  createPriceObservation?(observation: PriceObservationDto): void;
}

export interface PersistencePort {
  /** 需要原子事务的一组操作；fn 内抛错 → 全回滚 */
  withTransaction<T>(fn: (uow: UnitOfWork) => T): Promise<T>;
  getIdempotencyRecord?(scope: string, key: string): Promise<IdempotencyRecord | null>;
  // 只读查询可不经事务：
  getProject(id: string): Promise<Project | null>;
  listProjects(): Promise<Project[]>;
  // S2
  getArtifact(id: string): Promise<Artifact | null>;
  getArtifactByKind(projectId: string, kind: ArtifactKind): Promise<Artifact | null>;
  listArtifacts(projectId: string): Promise<Artifact[]>;
  getVersion(id: string): Promise<ArtifactVersion | null>;
  listVersions(artifactId: string): Promise<ArtifactVersion[]>;
  // S3A
  getTask(id: string): Promise<TaskRecord | null>;
  /** 项目范围内的任务真相；projectId 由任务 input 的既有字段关联，不改表结构。 */
  listTasks?(projectId: string): Promise<TaskRecord[]>;
  /** 最近完成任务的 output（S3B：requirements 聚合的 capabilities 来源） */
  latestTaskOutput(capability: string): Promise<string | null>;
  // S3B
  getProposal(id: string): Promise<Proposal | null>;
  listProposals(projectId: string): Promise<Proposal[]>;
  // S5A
  latestValidation(versionId: string): Promise<ValidationRecordDto | null>;
  // S5B
  activeStaleMarks(projectId: string): Promise<StaleMarkDto[]>;
  // S7
  getBuildRecord(id: string): Promise<BuildRecord | null>;
  listBuilds(versionId: string): Promise<BuildRecord[]>;
  // S9
  getPreference(key: string): Promise<string | null>;
  latestPhysicalAcceptance?(projectId: string): Promise<PhysicalAcceptanceRecordDto | null>;
  listBomItems?(projectId: string): Promise<BomItemDto[]>;
  listPriceObservations?(bomItemId: string): Promise<PriceObservationDto[]>;
}
