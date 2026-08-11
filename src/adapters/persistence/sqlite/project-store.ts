// adapters/persistence/sqlite/project-store.ts — PersistencePort 的 SQLite 实现（S1 projects + S2 artifacts/versions + S3A tasks）
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Project } from "@/src/domain/models/project";
import type { TaskRecord } from "@/src/ports/task-execution";
import type { ArtifactKind, ArtifactVersionStatus, TaskStatusDto } from "@/src/shared-contracts/types";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { SqliteDb } from "./connection";

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
  archived_reason: string | null;
}

interface ArtifactRow {
  id: string;
  project_id: string;
  kind: string;
  current_version_id: string | null;
  created_at: string;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_no: number;
  content_ref: string;
  content_hash: string;
  status: string;
  source_kind: string;
  source_proposal_id: string | null;
  created_at: string;
  created_by: string;
}

interface TaskRow {
  id: string;
  capability: string;
  input: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    archivedReason: row.archived_reason,
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as ArtifactKind,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
  };
}

function toArtifactVersion(row: ArtifactVersionRow): ArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    versionNo: row.version_no,
    contentRef: row.content_ref,
    contentHash: row.content_hash,
    status: row.status as ArtifactVersionStatus,
    sourceKind: row.source_kind as ArtifactVersion["sourceKind"],
    sourceProposalId: row.source_proposal_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    capability: row.capability,
    input: row.input,
    status: row.status as TaskStatusDto,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

export function createProjectStore(db: SqliteDb): PersistencePort {
  const insert = db.prepare(
    "INSERT INTO projects (id, name, created_at, archived_at, archived_reason) VALUES (@id, @name, @created_at, @archived_at, @archived_reason)",
  );
  const updateArchive = db.prepare(
    "UPDATE projects SET archived_at = ?, archived_reason = ? WHERE id = ?",
  );
  const selectById = db.prepare("SELECT * FROM projects WHERE id = ?");
  const selectAll = db.prepare("SELECT * FROM projects ORDER BY created_at ASC");

  const insertArtifact = db.prepare(
    "INSERT INTO artifacts (id, project_id, kind, current_version_id, created_at) VALUES (@id, @project_id, @kind, @current_version_id, @created_at)",
  );
  const updateCurrentVersion = db.prepare(
    "UPDATE artifacts SET current_version_id = ? WHERE id = ?",
  );
  const selectArtifact = db.prepare("SELECT * FROM artifacts WHERE id = ?");
  const selectArtifactByKind = db.prepare(
    "SELECT * FROM artifacts WHERE project_id = ? AND kind = ?",
  );
  const selectArtifacts = db.prepare("SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at ASC");

  const insertVersion = db.prepare(
    `INSERT INTO artifact_versions
       (id, artifact_id, version_no, content_ref, content_hash, status, source_kind, source_proposal_id, created_at, created_by)
     VALUES (@id, @artifact_id, @version_no, @content_ref, @content_hash, @status, @source_kind, @source_proposal_id, @created_at, @created_by)`,
  );
  const updateVersionStatus = db.prepare("UPDATE artifact_versions SET status = ? WHERE id = ?");
  const selectVersion = db.prepare("SELECT * FROM artifact_versions WHERE id = ?");
  const selectVersions = db.prepare(
    "SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_no ASC",
  );

  const insertTask = db.prepare(
    `INSERT INTO tasks (id, capability, input, status, created_at, started_at, completed_at, error)
     VALUES (@id, @capability, @input, @status, @created_at, @started_at, @completed_at, @error)`,
  );
  const updateTaskStmt = db.prepare(
    `UPDATE tasks SET status = @status, started_at = @started_at, completed_at = @completed_at, error = @error WHERE id = @id`,
  );
  const selectTask = db.prepare("SELECT * FROM tasks WHERE id = ?");
  // 崩溃恢复：running 无执行者即视为可重新 claim（本地单进程）；FIFO（created_at + 插入序 rowid）
  const claimNext = db.prepare(
    `SELECT * FROM tasks WHERE status IN ('queued','running') ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const markRunning = db.prepare("UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?");

  const uow: UnitOfWork = {
    createProject(p: Project): void {
      insert.run({
        id: p.id,
        name: p.name,
        created_at: p.createdAt,
        archived_at: p.archivedAt,
        archived_reason: p.archivedReason,
      });
    },
    archiveProject(id: string, archivedAt: string, reason: string | null): void {
      updateArchive.run(archivedAt, reason, id);
    },
    getProject(id: string): Project | null {
      const row = selectById.get(id) as ProjectRow | undefined;
      return row ? toProject(row) : null;
    },
    listProjects(): Project[] {
      return (selectAll.all() as ProjectRow[]).map(toProject);
    },
    createArtifact(a: Artifact): void {
      insertArtifact.run({
        id: a.id,
        project_id: a.projectId,
        kind: a.kind,
        current_version_id: a.currentVersionId,
        created_at: a.createdAt,
      });
    },
    setCurrentVersion(artifactId: string, versionId: string): void {
      updateCurrentVersion.run(versionId, artifactId);
    },
    createVersion(v: ArtifactVersion): void {
      insertVersion.run({
        id: v.id,
        artifact_id: v.artifactId,
        version_no: v.versionNo,
        content_ref: v.contentRef,
        content_hash: v.contentHash,
        status: v.status,
        source_kind: v.sourceKind,
        source_proposal_id: v.sourceProposalId,
        created_at: v.createdAt,
        created_by: v.createdBy,
      });
    },
    setVersionStatus(id: string, status: ArtifactVersionStatus): void {
      updateVersionStatus.run(status, id);
    },
    saveTask(t: TaskRecord): void {
      insertTask.run({
        id: t.id,
        capability: t.capability,
        input: t.input,
        status: t.status,
        created_at: t.createdAt,
        started_at: t.startedAt,
        completed_at: t.completedAt,
        error: t.error,
      });
    },
    updateTask(t: TaskRecord): void {
      updateTaskStmt.run({
        id: t.id,
        status: t.status,
        started_at: t.startedAt,
        completed_at: t.completedAt,
        error: t.error,
      });
    },
    claimNextTask(): TaskRecord | null {
      const row = claimNext.get() as TaskRow | undefined;
      if (!row) return null;
      markRunning.run(new Date().toISOString(), row.id);
      return toTask(claimNext.get() as TaskRow);
    },
  };

  return {
    withTransaction: async <T>(fn: (u: UnitOfWork) => T): Promise<T> => {
      const tx = db.transaction(fn);
      return tx(uow);
    },
    getProject: async (id: string) => uow.getProject(id),
    listProjects: async () => uow.listProjects(),
    getArtifact: async (id: string) => {
      const row = selectArtifact.get(id) as ArtifactRow | undefined;
      return row ? toArtifact(row) : null;
    },
    getArtifactByKind: async (projectId: string, kind: ArtifactKind) => {
      const row = selectArtifactByKind.get(projectId, kind) as ArtifactRow | undefined;
      return row ? toArtifact(row) : null;
    },
    listArtifacts: async (projectId: string) =>
      (selectArtifacts.all(projectId) as ArtifactRow[]).map(toArtifact),
    getVersion: async (id: string) => {
      const row = selectVersion.get(id) as ArtifactVersionRow | undefined;
      return row ? toArtifactVersion(row) : null;
    },
    listVersions: async (artifactId: string) =>
      (selectVersions.all(artifactId) as ArtifactVersionRow[]).map(toArtifactVersion),
    getTask: async (id: string) => {
      const row = selectTask.get(id) as TaskRow | undefined;
      return row ? toTask(row) : null;
    },
  };
}
