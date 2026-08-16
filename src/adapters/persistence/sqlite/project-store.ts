// adapters/persistence/sqlite/project-store.ts — PersistencePort 的 SQLite 实现（S1 projects + S2 artifacts/versions + S3A tasks）
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { Project } from "@/src/domain/models/project";
import type { TaskRecord } from "@/src/ports/task-execution";
import type { Proposal } from "@/src/domain/models/proposal";
import type { ArtifactKind, ArtifactVersionStatus, BomItemDto, PhysicalAcceptanceRecordDto, PriceObservationDto, StaleMarkDto, TaskStatusDto, ValidationRecordDto } from "@/src/shared-contracts/types";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { SqliteDb } from "./connection";
import type { IdempotencyRecord, IdempotencyRequest } from "@/src/shared/idempotency";
import {
  IdempotencyRecordCorruptError,
  isBuildOutputArray,
  isDecisionHistory,
  isDiagnosticArray,
  isRecord,
  isStringArray,
  parsePersistedJson,
} from "@/src/shared/persistence-integrity";

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

interface IdempotencyRow {
  scope: string;
  key: string;
  request_hash: string;
  response_status: number;
  response_body_json: string;
  created_at: string;
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
  toolchain_core_version?: string | null;
  toolchain_evidence?: string;
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
  readiness_status?: string;
  readiness_reasons?: string;
}

interface PhysicalAcceptanceRow {
  id: string;
  project_id: string;
  build_id: string;
  artifact_version_id: string;
  reference_kit_id: string;
  board_model: string;
  board_revision: string;
  device_id: string | null;
  usb_port: string | null;
  usb_vid: string | null;
  usb_pid: string | null;
  usb_serial_number: string | null;
  firmware_sha256: string | null;
  upload_status: string;
  verification_status: string;
  serial_status: string;
  serial_observation: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  completed_at: string | null;
}

interface BomItemRow {
  id: string;
  project_id: string;
  component_id: string;
  display_name: string;
  source_kind: string;
  identity_status: string;
  manufacturer: string | null;
  manufacturer_part_number: string | null;
  supplier_sku: string | null;
  quantity: number;
  unresolved_reason: string | null;
  created_at: string;
}

interface PriceObservationRow {
  id: string;
  bom_item_id: string;
  supplier: string;
  supplier_sku: string;
  manufacturer_part_number: string | null;
  quantity_tier: number;
  currency: string;
  unit_price: number | null;
  line_total: number | null;
  shipping: number | null;
  tax: number | null;
  fees: number | null;
  stock_status: string;
  source_url: string;
  observed_at: string;
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
  if (row.capability === "analyze_requirement" || row.capability === "run_build" || row.capability === "flash_device") {
    parsePersistedJson(row.input, "task", row.id, "input", isRecord);
    if (row.output !== null) parsePersistedJson(row.output, "task", row.id, "output", isRecord);
  }
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
  parsePersistedJson(row.payload, "proposal", row.id, "payload", (_value: unknown): _value is unknown => true);
  return {
    id: row.id,
    projectId: row.project_id,
    artifactId: row.artifact_id,
    baseVersionId: row.base_version_id,
    type: row.type as Proposal["type"],
    payload: row.payload,
    diff: row.diff ? parsePersistedJson(row.diff, "proposal", row.id, "diff", isRecord) : null,
    impacts: parsePersistedJson(row.impacts, "proposal", row.id, "impacts", isStringArray),
    reason: row.reason,
    status: row.status as Proposal["status"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisionHistory: parsePersistedJson(row.decision_history, "proposal", row.id, "decision_history", isDecisionHistory) as Proposal["decisionHistory"],
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
    toolchainCoreVersion: row.toolchain_core_version ?? null,
    toolchainEvidence: (row.toolchain_evidence ?? "unknown") as BuildRecord["toolchainEvidence"],
    options: parsePersistedJson(row.options, "build", row.id, "options", isRecord),
    status: row.status as BuildRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    stdoutRef: row.stdout_ref,
    stderrRef: row.stderr_ref,
    exitCode: row.exit_code,
    diagnostics: parsePersistedJson(row.diagnostics, "build", row.id, "diagnostics", isDiagnosticArray) as BuildRecord["diagnostics"],
    sourceDir: row.source_dir ?? null,
    outputDir: row.output_dir ?? null,
    command: row.command_json ? parsePersistedJson(row.command_json, "build", row.id, "command_json", isStringArray) : [],
    outputs: row.outputs_json ? parsePersistedJson(row.outputs_json, "build", row.id, "outputs_json", isBuildOutputArray) as unknown as NonNullable<BuildRecord["outputs"]> : [],
    readinessStatus: (row.readiness_status ?? "blocked") as BuildRecord["readinessStatus"],
    readinessReasons: row.readiness_reasons ? parsePersistedJson(row.readiness_reasons, "build", row.id, "readiness_reasons", isStringArray) : [],
  };
}

function toPhysicalAcceptance(row: PhysicalAcceptanceRow): PhysicalAcceptanceRecordDto {
  return {
    id: row.id,
    projectId: row.project_id,
    buildId: row.build_id,
    artifactVersionId: row.artifact_version_id,
    referenceKitId: row.reference_kit_id,
    boardModel: row.board_model,
    boardRevision: row.board_revision,
    deviceId: row.device_id,
    usbPort: row.usb_port,
    usbVid: row.usb_vid,
    usbPid: row.usb_pid,
    usbSerialNumber: row.usb_serial_number,
    firmwareSha256: row.firmware_sha256,
    uploadStatus: row.upload_status as PhysicalAcceptanceRecordDto["uploadStatus"],
    verificationStatus: row.verification_status as PhysicalAcceptanceRecordDto["verificationStatus"],
    serialStatus: row.serial_status as PhysicalAcceptanceRecordDto["serialStatus"],
    serialObservation: row.serial_observation,
    status: row.status as PhysicalAcceptanceRecordDto["status"],
    reason: row.reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function toBomItem(row: BomItemRow): BomItemDto {
  return {
    id: row.id,
    projectId: row.project_id,
    componentId: row.component_id,
    displayName: row.display_name,
    sourceKind: row.source_kind as BomItemDto["sourceKind"],
    identityStatus: row.identity_status as BomItemDto["identityStatus"],
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturer_part_number,
    supplierSku: row.supplier_sku,
    quantity: row.quantity,
    unresolvedReason: row.unresolved_reason,
    createdAt: row.created_at,
  };
}

function toPriceObservation(row: PriceObservationRow): PriceObservationDto {
  return {
    id: row.id,
    bomItemId: row.bom_item_id,
    supplier: row.supplier as PriceObservationDto["supplier"],
    supplierSku: row.supplier_sku,
    manufacturerPartNumber: row.manufacturer_part_number,
    quantityTier: row.quantity_tier as PriceObservationDto["quantityTier"],
    currency: row.currency as PriceObservationDto["currency"],
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
    shipping: row.shipping,
    tax: row.tax,
    fees: row.fees,
    stockStatus: row.stock_status as PriceObservationDto["stockStatus"],
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
  };
}

export function createProjectStore(db: SqliteDb): PersistencePort {
  const insertIdempotency = db.prepare(
    `INSERT INTO idempotency_records (scope, key, request_hash, response_status, response_body_json, created_at)
     VALUES (@scope, @key, @request_hash, @response_status, @response_body_json, @created_at)
     ON CONFLICT(scope, key) DO NOTHING`,
  );
  const selectIdempotency = db.prepare(
    "SELECT scope, key, request_hash, response_status, response_body_json, created_at FROM idempotency_records WHERE scope = ? AND key = ?",
  );
  const updateIdempotency = db.prepare(
    `UPDATE idempotency_records SET response_status = @response_status, response_body_json = @response_body_json
     WHERE scope = @scope AND key = @key AND request_hash = @request_hash`,
  );
  const toIdempotency = (row: IdempotencyRow): IdempotencyRecord => {
    if (!/^[a-f0-9]{64}$/i.test(row.request_hash) || !Number.isInteger(row.response_status) || row.response_status < 100 || row.response_status > 599) {
      throw new IdempotencyRecordCorruptError();
    }
    return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    responseStatus: row.response_status,
    responseBodyJson: row.response_body_json,
    createdAt: row.created_at,
    };
  };
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
    `INSERT INTO build_records (id, artifact_version_id, task_id, target, toolchain, toolchain_version, toolchain_core_version, toolchain_evidence, options, status, started_at, completed_at, stdout_ref, stderr_ref, exit_code, diagnostics, source_dir, output_dir, command_json, outputs_json, readiness_status, readiness_reasons)
     VALUES (@id, @artifact_version_id, @task_id, @target, @toolchain, @toolchain_version, @toolchain_core_version, @toolchain_evidence, @options, @status, @started_at, @completed_at, @stdout_ref, @stderr_ref, @exit_code, @diagnostics, @source_dir, @output_dir, @command_json, @outputs_json, @readiness_status, @readiness_reasons)`,
  );
  const updateBuild = db.prepare(
    `UPDATE build_records SET task_id = @task_id, toolchain_core_version = @toolchain_core_version, toolchain_evidence = @toolchain_evidence, status = @status, completed_at = @completed_at, stdout_ref = @stdout_ref, stderr_ref = @stderr_ref, exit_code = @exit_code, diagnostics = @diagnostics, source_dir = @source_dir, output_dir = @output_dir, command_json = @command_json, outputs_json = @outputs_json, readiness_status = @readiness_status, readiness_reasons = @readiness_reasons WHERE id = @id`,
  );
  const selectBuild = db.prepare("SELECT * FROM build_records WHERE id = ?");
  const selectBuilds = db.prepare(
    "SELECT * FROM build_records WHERE artifact_version_id = ? ORDER BY started_at ASC, rowid ASC",
  );
  const insertPhysicalAcceptance = db.prepare(
    `INSERT INTO physical_acceptance_records
      (id, project_id, build_id, artifact_version_id, reference_kit_id, board_model, board_revision, device_id, usb_port, usb_vid, usb_pid, usb_serial_number, firmware_sha256, upload_status, verification_status, serial_status, serial_observation, status, reason, created_at, completed_at)
     VALUES (@id, @project_id, @build_id, @artifact_version_id, @reference_kit_id, @board_model, @board_revision, @device_id, @usb_port, @usb_vid, @usb_pid, @usb_serial_number, @firmware_sha256, @upload_status, @verification_status, @serial_status, @serial_observation, @status, @reason, @created_at, @completed_at)`,
  );
  const selectLatestPhysicalAcceptance = db.prepare(
    "SELECT * FROM physical_acceptance_records WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
  );
  const insertBomItem = db.prepare(
    `INSERT INTO bom_items (id, project_id, component_id, display_name, source_kind, identity_status, manufacturer, manufacturer_part_number, supplier_sku, quantity, unresolved_reason, created_at)
     VALUES (@id, @project_id, @component_id, @display_name, @source_kind, @identity_status, @manufacturer, @manufacturer_part_number, @supplier_sku, @quantity, @unresolved_reason, @created_at)`,
  );
  const selectBomItems = db.prepare("SELECT * FROM bom_items WHERE project_id = ? ORDER BY created_at ASC, rowid ASC");
  const insertPriceObservation = db.prepare(
    `INSERT INTO price_observations (id, bom_item_id, supplier, supplier_sku, manufacturer_part_number, quantity_tier, currency, unit_price, line_total, shipping, tax, fees, stock_status, source_url, observed_at)
     VALUES (@id, @bom_item_id, @supplier, @supplier_sku, @manufacturer_part_number, @quantity_tier, @currency, @unit_price, @line_total, @shipping, @tax, @fees, @stock_status, @source_url, @observed_at)`,
  );
  const selectPriceObservations = db.prepare("SELECT * FROM price_observations WHERE bom_item_id = ? ORDER BY observed_at ASC, rowid ASC");
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
    "SELECT id, output FROM tasks WHERE capability = ? AND status = 'completed' ORDER BY completed_at DESC, rowid DESC LIMIT 1",
  );
  // 崩溃恢复由 requeueOrphanedTasks 先清理 running；claim 只取 queued，保证并发 claimant 不重复拿同一任务。
  const claimNext = db.prepare(
    `SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at ASC, rowid ASC LIMIT 1`,
  );
  const markRunning = db.prepare("UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?");
  const requeueOrphans = db.prepare("UPDATE tasks SET status = 'queued', started_at = NULL WHERE status = 'running'");
  const selectInterruptedTaskIds = db.prepare("SELECT id FROM tasks WHERE status = 'running' ORDER BY created_at ASC, rowid ASC");
  const orphanBuildDiagnostic = JSON.stringify([{
    code: "build_recovery_orphaned",
    severity: "error",
    message: "Build record was interrupted before its task was durably linked",
  }]);
  const repairOrphanedBuilds = db.prepare(
    `UPDATE build_records
     SET status = 'failed', completed_at = ?, exit_code = 1, diagnostics = ?
     WHERE status = 'running'
       AND (task_id IS NULL OR NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id = build_records.task_id))`,
  );

  const uow: UnitOfWork = {
    claimIdempotency(request: IdempotencyRequest, responseStatus: number, responseBodyJson: string) {
      const result = insertIdempotency.run({
        scope: request.scope,
        key: request.key,
        request_hash: request.requestHash,
        response_status: responseStatus,
        response_body_json: responseBodyJson,
        created_at: request.createdAt,
      });
      if (Number(result.changes) === 1) return { kind: "new" as const };
      const row = selectIdempotency.get(request.scope, request.key) as IdempotencyRow | undefined;
      if (!row) throw new Error("Idempotency record disappeared during atomic claim");
      const record = toIdempotency(row);
      return record.requestHash === request.requestHash
        ? { kind: "replay" as const, record }
        : { kind: "conflict" as const, record };
    },
    updateIdempotency(request: IdempotencyRequest, responseStatus: number, responseBodyJson: string): void {
      updateIdempotency.run({
        scope: request.scope,
        key: request.key,
        request_hash: request.requestHash,
        response_status: responseStatus,
        response_body_json: responseBodyJson,
      });
    },
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
        toolchain_core_version: b.toolchainCoreVersion,
        toolchain_evidence: b.toolchainEvidence,
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
        readiness_status: b.readinessStatus,
        readiness_reasons: JSON.stringify(b.readinessReasons),
      });
    },
    updateBuildRecord(b: BuildRecord): void {
      updateBuild.run({
        id: b.id,
        task_id: b.taskId,
        toolchain_core_version: b.toolchainCoreVersion,
        toolchain_evidence: b.toolchainEvidence,
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
        readiness_status: b.readinessStatus,
        readiness_reasons: JSON.stringify(b.readinessReasons),
      });
    },
    setPreference(key: string, value: string, updatedAt: string): void {
      upsertPreference.run({ key, value, updated_at: updatedAt });
    },
    createPhysicalAcceptance(record: PhysicalAcceptanceRecordDto): void {
      insertPhysicalAcceptance.run({
        id: record.id,
        project_id: record.projectId,
        build_id: record.buildId,
        artifact_version_id: record.artifactVersionId,
        reference_kit_id: record.referenceKitId,
        board_model: record.boardModel,
        board_revision: record.boardRevision,
        device_id: record.deviceId,
        usb_port: record.usbPort,
        usb_vid: record.usbVid,
        usb_pid: record.usbPid,
        usb_serial_number: record.usbSerialNumber,
        firmware_sha256: record.firmwareSha256,
        upload_status: record.uploadStatus,
        verification_status: record.verificationStatus,
        serial_status: record.serialStatus,
        serial_observation: record.serialObservation,
        status: record.status,
        reason: record.reason,
        created_at: record.createdAt,
        completed_at: record.completedAt,
      });
    },
    createBomItem(item: BomItemDto): void {
      insertBomItem.run({
        id: item.id,
        project_id: item.projectId,
        component_id: item.componentId,
        display_name: item.displayName,
        source_kind: item.sourceKind,
        identity_status: item.identityStatus,
        manufacturer: item.manufacturer,
        manufacturer_part_number: item.manufacturerPartNumber,
        supplier_sku: item.supplierSku,
        quantity: item.quantity,
        unresolved_reason: item.unresolvedReason,
        created_at: item.createdAt,
      });
    },
    createPriceObservation(observation: PriceObservationDto): void {
      insertPriceObservation.run({
        id: observation.id,
        bom_item_id: observation.bomItemId,
        supplier: observation.supplier,
        supplier_sku: observation.supplierSku,
        manufacturer_part_number: observation.manufacturerPartNumber,
        quantity_tier: observation.quantityTier,
        currency: observation.currency,
        unit_price: observation.unitPrice,
        line_total: observation.lineTotal,
        shipping: observation.shipping,
        tax: observation.tax,
        fees: observation.fees,
        stock_status: observation.stockStatus,
        source_url: observation.sourceUrl,
        observed_at: observation.observedAt,
      });
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
    recoverInterruptedTasks(): string[] {
      const ids = (selectInterruptedTaskIds.all() as Array<{ id: string }>).map((row) => row.id);
      requeueOrphans.run();
      return ids;
    },
    repairOrphanedBuildRecords(completedAt: string): number {
      return Number(repairOrphanedBuilds.run(completedAt, orphanBuildDiagnostic).changes);
    },
  };

  return {
    withTransaction: async <T>(fn: (u: UnitOfWork) => T): Promise<T> => {
      const tx = db.transaction(fn);
      return tx(uow);
    },
    getIdempotencyRecord: async (scope: string, key: string) => {
      const row = selectIdempotency.get(scope, key) as IdempotencyRow | undefined;
      return row ? toIdempotency(row) : null;
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
        const input = parsePersistedJson(row.input, "task", row.id, "input", isRecord);
        return input.projectId === projectId ? [toTask(row)] : [];
      }),
    latestTaskOutput: async (capability: string) => {
      const row = selectLatestOutput.get(capability) as { id: string; output: string | null } | undefined;
      if (!row || row.output === null) return null;
      parsePersistedJson(row.output, "task", row.id, "output", isRecord);
      return row.output;
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
        rules: parsePersistedJson(row.rules, "validation", row.id, "rules", isStringArray),
        result: row.result as ValidationRecordDto["result"],
        diagnostics: parsePersistedJson(row.diagnostics, "validation", row.id, "diagnostics", isDiagnosticArray) as ValidationRecordDto["diagnostics"],
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
    latestPhysicalAcceptance: async (projectId: string) => {
      const row = selectLatestPhysicalAcceptance.get(projectId) as PhysicalAcceptanceRow | undefined;
      return row ? toPhysicalAcceptance(row) : null;
    },
    listBomItems: async (projectId: string) => (selectBomItems.all(projectId) as BomItemRow[]).map(toBomItem),
    listPriceObservations: async (bomItemId: string) => (selectPriceObservations.all(bomItemId) as PriceObservationRow[]).map(toPriceObservation),
  };
}
