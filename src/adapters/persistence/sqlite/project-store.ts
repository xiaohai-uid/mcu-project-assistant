// adapters/persistence/sqlite/project-store.ts — PersistencePort 的 SQLite 实现（S1 projects + S2 artifacts/versions + S3A tasks）
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { Project } from "@/src/domain/models/project";
import type { TaskRecord } from "@/src/ports/task-execution";
import type { Proposal } from "@/src/domain/models/proposal";
import type { ArtifactKind, ArtifactVersionStatus, StaleMarkDto, TaskStatusDto, ValidationRecordDto } from "@/src/shared-contracts/types";
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
  output: string | null;
}

interface StaleRow {
  id: string;
  project_id: string;
  artifact_id: string;
  affected_version_id: string | null;
  level: string;
  reason: string;
  source_version_id: string | null;
  triggered_by: string;
  created_at: string;
  resolved_at: string | null;
}

interface ValidationRow {
  id: string;
  artifact_version_id: string;
  kind: string;
  rules: string;
  result: string;
  diagnostics: string;
  started_at: string;
  completed_at: string | null;
}

interface BuildRow {
  id: string;
  artifact_version_id: string;
  task_id: string | null;
  target: string;
  toolchain: string;
  toolchain_version: string | null;
  options: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  stdout_ref: string | null;
  stderr_ref: string | null;
  exit_code: number | null;
  diagnostics: string;
  source_dir?: string | null;
  output_dir?: string | null;
  command_json?: string | null;
  outputs_json?: string | null;
}

interface ProposalRow {
  id: string;
  project_id: string;
  artifact_id: string;
  base_version_id: string | null;
  type: string;
  payload: string;
  diff: string | null;
  impacts: string;
  reason: string | null;
  status: string;
  created_by: string;
  created_at: string;
  decided_at: string | null;
  decision_history: string;
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
    output: row.output,
  };
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    projectId: row.project_id,
    artifactId: row.artifact_id,
    baseVersionId: row.base_version_id,
    type: row.type as Proposal["type"],
    payload: row.payload,
    diff: row.diff ? (JSON.parse(row.diff) as Record<string, unknown>) : null,
    impacts: JSON.parse(row.impacts) as string[],
    reason: row.reason,
    status: row.status as Proposal["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisionHistory: JSON.parse(row.decision_history) as Proposal["decisionHistory"],
    number: 0, // 列表序号由 capability 填充
  };
}

function toBuild(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    artifactVersionId: row.artifact_version_id,
    taskId: row.task_id,
    target: row.target,
    toolchain: row.toolchain,
    toolchainVersion: row.toolchain_version,
    options: JSON.parse(row.options) as Record<string, unknown>,
    status: row.status as BuildRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    stdoutRef: row.stdout_ref,
    stderrRef: row.stderr_ref,
    exitCode: row.exit_code,
    diagnostics: JSON.parse(row.diagnostics) as BuildRecord["diagnostics"],
    sourceDir: row.source_dir ?? null,
    outputDir: row.output_dir ?? null,
    command: row.command_json ? JSON.parse(row.command_json) as string[] : [],
    outputs: row.outputs_json ? JSON.parse(row.outputs_json) as NonNullable<BuildRecord["outputs"]> : [],
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
    `INSERT INTO tasks (id, capability, input, status, created_at, started_at, completed_at, error, output)
     VALUES (@id, @capability, @input, @status, @created_at, @started_at, @completed_at, @error, @output)`,
  );
  const updateTaskStmt = db.prepare(
    `UPDATE tasks
     SET status = @status, started_at = @started_at, completed_at = @completed_at, error = @error, output = @output
     WHERE id = @id AND (
       (status = 'queued' AND @status IN ('running', 'cancelled')) OR
       (status = 'running' AND @status IN ('running', 'completed', 'failed', 'cancelled'))
     )`,
  );
  function updateTaskIfStatus(t: TaskRecord, fromStatuses: TaskRecord["status"][]): boolean {
    if (fromStatuses.length === 0) return false;
    const params = fromStatuses.map((_, index) => `@from_${index}`);
    const stmt = db.prepare(
      `UPDATE tasks
       SET status = @status, started_at = @started_at, completed_at = @completed_at, error = @error, output = @output
       WHERE id = @id AND status IN (${params.join(", ")})`,
    );
    const values: Record<string, string | null> = {
      id: t.id,
      status: t.status,
      started_at: t.startedAt,
      completed_at: t.completedAt,
      error: t.error,
      output: t.output,
    };
    fromStatuses.forEach((status, index) => { values[`from_${index}`] = status; });
    return Number(stmt.run(values).changes) === 1;
  }
  const insertProposal = db.prepare(
    `INSERT INTO proposals (id, project_id, artifact_id, base_version_id, type, payload, diff, impacts, reason, status, created_by, created_at, decided_at, decision_history)
     VALUES (@id, @project_id, @artifact_id, @base_version_id, @type, @payload, @diff, @impacts, @reason, @status, @created_by, @created_at, @decided_at, @decision_history)`,
  );
  const updateProposal = db.prepare(
    `UPDATE proposals SET status = @status, decided_at = @decided_at, decision_history = @decision_history WHERE id = @id`,
  );
  const selectProposal = db.prepare("SELECT * FROM proposals WHERE id = ?");
  const insertValidation = db.prepare(
    `INSERT INTO validation_records (id, artifact_version_id, kind, rules, result, diagnostics, started_at, completed_at)
     VALUES (@id, @artifact_version_id, @kind, @rules, @result, @diagnostics, @started_at, @completed_at)`,
  );
  const insertStale = db.prepare(
    `INSERT INTO stale_marks (id, project_id, artifact_id, affected_version_id, level, reason, source_version_id, triggered_by, created_at, resolved_at)
     VALUES (@id, @project_id, @artifact_id, @affected_version_id, @level, @reason, @source_version_id, @triggered_by, @created_at, @resolved_at)`,
  );
  const resolveStaleStmt = db.prepare(
    "UPDATE stale_marks SET resolved_at = ? WHERE artifact_id = ? AND resolved_at IS NULL",
  );
  const findActiveStale = db.prepare(
    "SELECT id, level FROM stale_marks WHERE artifact_id = ? AND affected_version_id = ? AND resolved_at IS NULL",
  );
  const deleteStaleStmt = db.prepare("DELETE FROM stale_marks WHERE id = ?");
  const selectActiveStale = db.prepare(
    "SELECT * FROM stale_marks WHERE project_id = ? AND resolved_at IS NULL ORDER BY created_at ASC",
  );
  const insertBuild = db.prepare(
    `INSERT INTO build_records (id, artifact_version_id, task_id, target, toolchain, toolchain_version, options, status, started_at, completed_at, stdout_ref, stderr_ref, exit_code, diagnostics, source_dir, output_dir, command_json, outputs_json)
     VALUES (@id, @artifact_version_id, @task_id, @target, @toolchain, @toolchain_version, @options, @status, @started_at, @completed_at, @stdout_ref, @stderr_ref, @exit_code, @diagnostics, @source_dir, @output_dir, @command_json, @outputs_json)`,
  );
  const updateBuild = db.prepare(
    `UPDATE build_records SET task_id = @task_id, status = @status, completed_at = @completed_at, stdout_ref = @stdout_ref, stderr_ref = @stderr_ref, exit_code = @exit_code, diagnostics = @diagnostics, source_dir = @source_dir, output_dir = @output_dir, command_json = @command_json, outputs_json = @outputs_json WHERE id = @id`,
  );
  const selectBuild = db.prepare("SELECT * FROM build_records WHERE id = ?");
  const selectBuilds = db.prepare(
    "SELECT * FROM build_records WHERE artifact_version_id = ? ORDER BY started_at ASC, rowid ASC",
  );
  const upsertPreference = db.prepare(
    "INSERT INTO preferences (key, value, updated_at) VALUES (@key, @value, @updated_at) ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at",
  );
  const selectPreference = db.prepare("SELECT value FROM preferences WHERE key = ?");
  const selectLatestValidation = db.prepare(
    "SELECT * FROM validation_records WHERE artifact_version_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
  );
  const selectProposals = db.prepare("SELECT * FROM proposals WHERE project_id = ? ORDER BY created_at ASC, rowid ASC");
  const selectTask = db.prepare("SELECT * FROM tasks WHERE id = ?");
  const selectTasks = db.prepare("SELECT * FROM tasks ORDER BY created_at ASC, rowid ASC");
  const selectLatestOutput = db.prepare(
    "SELECT output FROM tasks WHERE capability = ? AND status = 'completed' ORDER BY completed_at DESC, rowid DESC LIMIT 1",
  );
  // 崩溃恢复由 requeueOrphanedTasks 先清理 running；claim 只取 queued，保证并发 claimant 不重复拿同一任务。
  const claimNext = db.prepare(
    `SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const markRunning = db.prepare("UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?");
  const requeueOrphans = db.prepare("UPDATE tasks SET status = 'queued', started_at = NULL WHERE status = 'running'");

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
        output: t.output,
      });
    },
    updateTask(t: TaskRecord): void {
      updateTaskStmt.run({
        id: t.id,
        status: t.status,
        started_at: t.startedAt,
        completed_at: t.completedAt,
        error: t.error,
        output: t.output,
      });
    },
    updateTaskIfStatus,
    saveStaleMarks(marks: StaleMarkDto[]): void {
      for (const m of marks) {
        // 合并语义（stale-semantics §3：一个下游可同时多个上游 Stale 源 → 级别取最高）：
        // 同 (artifact_id, affected_version_id) 未解决 mark 已存在且级别 >= 新级别 → 跳过；更高 → 替换
        const existing = findActiveStale.get(m.artifactId, m.affectedVersionId) as
          | { id: string; level: string }
          | undefined;
        if (existing) {
          if (existing.level >= m.level) continue;
          deleteStaleStmt.run(existing.id);
        }
        insertStale.run({
          id: m.id,
          project_id: m.projectId,
          artifact_id: m.artifactId,
          affected_version_id: m.affectedVersionId,
          level: m.level,
          reason: m.reason,
          source_version_id: m.sourceVersionId,
          triggered_by: m.triggeredBy,
          created_at: m.createdAt,
          resolved_at: m.resolvedAt,
        });
      }
    },
    resolveStaleMarks(artifactId: string, versionId: string): void {
      resolveStaleStmt.run(versionId, artifactId);
    },
    createBuildRecord(b: BuildRecord): void {
      insertBuild.run({
        id: b.id,
        artifact_version_id: b.artifactVersionId,
        task_id: b.taskId,
        target: b.target,
        toolchain: b.toolchain,
        toolchain_version: b.toolchainVersion,
        options: JSON.stringify(b.options),
        status: b.status,
        started_at: b.startedAt,
        completed_at: b.completedAt,
        stdout_ref: b.stdoutRef,
        stderr_ref: b.stderrRef,
        exit_code: b.exitCode,
        diagnostics: JSON.stringify(b.diagnostics),
        source_dir: b.sourceDir ?? null,
        output_dir: b.outputDir ?? null,
        command_json: b.command ? JSON.stringify(b.command) : null,
        outputs_json: b.outputs ? JSON.stringify(b.outputs) : null,
      });
    },
    updateBuildRecord(b: BuildRecord): void {
      updateBuild.run({
        id: b.id,
        task_id: b.taskId,
        status: b.status,
        completed_at: b.completedAt,
        stdout_ref: b.stdoutRef,
        stderr_ref: b.stderrRef,
        exit_code: b.exitCode,
        diagnostics: JSON.stringify(b.diagnostics),
        source_dir: b.sourceDir ?? null,
        output_dir: b.outputDir ?? null,
        command_json: b.command ? JSON.stringify(b.command) : null,
        outputs_json: b.outputs ? JSON.stringify(b.outputs) : null,
      });
    },
    setPreference(key: string, value: string, updatedAt: string): void {
      upsertPreference.run({ key, value, updated_at: updatedAt });
    },
    createValidationRecord(v: ValidationRecordDto): void {
      insertValidation.run({
        id: v.id,
        artifact_version_id: v.artifactVersionId,
        kind: v.kind,
        rules: JSON.stringify(v.rules),
        result: v.result,
        diagnostics: JSON.stringify(v.diagnostics),
        started_at: v.startedAt,
        completed_at: v.completedAt,
      });
    },
    createProposal(p: Proposal): void {
      insertProposal.run({
        id: p.id,
        project_id: p.projectId,
        artifact_id: p.artifactId,
        base_version_id: p.baseVersionId,
        type: p.type,
        payload: p.payload,
        diff: p.diff ? JSON.stringify(p.diff) : null,
        impacts: JSON.stringify(p.impacts),
        reason: p.reason,
        status: p.status,
        created_by: p.createdBy,
        created_at: p.createdAt,
        decided_at: p.decidedAt,
        decision_history: JSON.stringify(p.decisionHistory),
      });
    },
    resolveProposal(p: Proposal): void {
      updateProposal.run({
        id: p.id,
        status: p.status,
        decided_at: p.decidedAt,
        decision_history: JSON.stringify(p.decisionHistory),
      });
    },
    claimNextTask(): TaskRecord | null {
      const row = claimNext.get() as TaskRow | undefined;
      if (!row) return null;
      const startedAt = new Date().toISOString();
      markRunning.run(startedAt, row.id);
      return toTask({ ...row, status: "running", started_at: startedAt });
    },
    requeueOrphanedTasks(): number {
      return Number(requeueOrphans.run().changes);
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
    listTasks: async (projectId: string) =>
      (selectTasks.all() as TaskRow[]).flatMap((row) => {
        try {
          const input = JSON.parse(row.input) as { projectId?: unknown };
          return input.projectId === projectId ? [toTask(row)] : [];
        } catch {
          return [];
        }
      }),
    latestTaskOutput: async (capability: string) => {
      const row = selectLatestOutput.get(capability) as { output: string | null } | undefined;
      return row?.output ?? null;
    },
    getProposal: async (id: string) => {
      const row = selectProposal.get(id) as ProposalRow | undefined;
      return row ? toProposal(row) : null;
    },
    activeStaleMarks: async (projectId: string) =>
      (selectActiveStale.all(projectId) as StaleRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        artifactId: row.artifact_id,
        affectedVersionId: row.affected_version_id,
        level: row.level as StaleMarkDto["level"],
        reason: row.reason,
        sourceVersionId: row.source_version_id,
        triggeredBy: row.triggered_by,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at,
      })),
    latestValidation: async (versionId: string) => {
      const row = selectLatestValidation.get(versionId) as ValidationRow | undefined;
      if (!row) return null;
      return {
        id: row.id,
        artifactVersionId: row.artifact_version_id,
        kind: row.kind,
        rules: JSON.parse(row.rules) as string[],
        result: row.result as ValidationRecordDto["result"],
        diagnostics: JSON.parse(row.diagnostics) as ValidationRecordDto["diagnostics"],
        startedAt: row.started_at,
        completedAt: row.completed_at,
      };
    },
    listProposals: async (projectId: string) =>
      (selectProposals.all(projectId) as ProposalRow[]).map(toProposal),
    getBuildRecord: async (id: string) => {
      const row = selectBuild.get(id) as BuildRow | undefined;
      return row ? toBuild(row) : null;
    },
    listBuilds: async (versionId: string) =>
      (selectBuilds.all(versionId) as BuildRow[]).map(toBuild),
    getPreference: async (key: string) => {
      const row = selectPreference.get(key) as { value: string } | undefined;
      return row?.value ?? null;
    },
  };
}
