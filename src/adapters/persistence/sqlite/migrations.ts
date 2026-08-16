// adapters/persistence/sqlite/migrations.ts — 版本化迁移（schema 随 Slice 增长）
// S1 仅 projects 表；S2 增 artifacts + artifact_versions（ISSUE-002 §8）；禁止一次性建未来 Slice 的表。
import type { SqliteDb } from "./connection";
import {
  DatabaseIntegrityError,
  IncompleteDatabaseSchemaError,
  UnsupportedDatabaseSchemaError,
} from "@/src/shared/persistence-integrity";

const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  {
    version: 1,
    name: "create_projects",
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT NULL,
  archived_reason TEXT NULL
);
`,
  },
  {
    version: 2,
    name: "create_artifacts",
    sql: `
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('requirements','hardware','pinmap','wiring','firmware')),
  current_version_id TEXT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, kind)
);
CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version_no INTEGER NOT NULL,
  content_ref TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','accepted')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual','ai','proposal')),
  source_proposal_id TEXT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (artifact_id, version_no)
);
CREATE INDEX idx_versions_artifact ON artifact_versions(artifact_id, version_no);
-- I-2 不可变：content 字段创建后禁改（防篡改；对内容字段的 UPDATE 被拒绝）
CREATE TRIGGER artifact_versions_immutable
BEFORE UPDATE OF content_ref, content_hash ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions content is immutable (I-2)');
END;
`,
  },
  {
    version: 3,
    name: "create_tasks",
    sql: `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  created_at TEXT NOT NULL,
  started_at TEXT NULL,
  completed_at TEXT NULL,
  error TEXT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status, created_at);
`,
  },
  {
    version: 4,
    name: "create_proposals",
    sql: `
ALTER TABLE tasks ADD COLUMN output TEXT NULL;
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  base_version_id TEXT NULL REFERENCES artifact_versions(id),
  type TEXT NOT NULL CHECK (type IN ('requirement','firmware','dependency')),
  payload TEXT NOT NULL,
  diff TEXT NULL,
  impacts TEXT NOT NULL DEFAULT '[]',
  reason TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT NULL,
  decision_history TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_proposals_project ON proposals(project_id);
CREATE INDEX idx_proposals_base ON proposals(base_version_id);
`,
  },
  {
    version: 5,
    name: "create_validation_records",
    sql: `
CREATE TABLE validation_records (
  id TEXT PRIMARY KEY,
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  kind TEXT NOT NULL,
  rules TEXT NOT NULL DEFAULT '[]',
  result TEXT NOT NULL CHECK (result IN ('pass','warn','fail')),
  diagnostics TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT NULL
);
CREATE INDEX idx_validations_version ON validation_records(artifact_version_id);
`,
  },
  {
    version: 6,
    name: "create_stale_marks",
    sql: `
CREATE TABLE stale_marks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  affected_version_id TEXT NULL,
  level TEXT NOT NULL CHECK (level IN ('L1','L2','L3')),
  reason TEXT NOT NULL,
  source_version_id TEXT NULL,
  triggered_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT NULL
);
CREATE INDEX idx_stale_project ON stale_marks(project_id, resolved_at);
-- ISSUE-007 §8：未解决时同一下游只保留一条 mark（部分唯一索引）；级别取最高由 saveStaleMarks 合并
CREATE UNIQUE INDEX idx_stale_active_unique ON stale_marks(artifact_id, affected_version_id) WHERE resolved_at IS NULL;
`,
  },
  {
    version: 7,
    name: "create_build_records",
    sql: `
CREATE TABLE build_records (
  id TEXT PRIMARY KEY,
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  task_id TEXT NULL,
  target TEXT NOT NULL,
  toolchain TEXT NOT NULL,
  toolchain_version TEXT NULL,
  options TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled')),
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  stdout_ref TEXT NULL,
  stderr_ref TEXT NULL,
  exit_code INTEGER NULL,
  diagnostics TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_builds_version ON build_records(artifact_version_id);
`,
  },
  {
    version: 8,
    name: "create_preferences",
    sql: `
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 9,
    name: "add_build_output_evidence",
    sql: `
ALTER TABLE build_records ADD COLUMN source_dir TEXT NULL;
ALTER TABLE build_records ADD COLUMN output_dir TEXT NULL;
ALTER TABLE build_records ADD COLUMN command_json TEXT NULL;
ALTER TABLE build_records ADD COLUMN outputs_json TEXT NULL;
`,
  },
  {
    version: 10,
    name: "create_idempotency_records",
    sql: `
CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_records(created_at);
`,
  },
  {
    version: 11,
    name: "add_build_toolchain_and_readiness_evidence",
    sql: `
ALTER TABLE build_records ADD COLUMN toolchain_core_version TEXT NULL;
ALTER TABLE build_records ADD COLUMN toolchain_evidence TEXT NOT NULL DEFAULT 'unknown' CHECK (toolchain_evidence IN ('real','fixture','unknown'));
ALTER TABLE build_records ADD COLUMN readiness_status TEXT NOT NULL DEFAULT 'blocked' CHECK (readiness_status IN ('local-ready','blocked'));
ALTER TABLE build_records ADD COLUMN readiness_reasons TEXT NOT NULL DEFAULT '[]';
`,
  },
  {
    version: 12,
    name: "create_physical_acceptance_records",
    sql: `
CREATE TABLE physical_acceptance_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  build_id TEXT NOT NULL REFERENCES build_records(id),
  artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  reference_kit_id TEXT NOT NULL,
  board_model TEXT NOT NULL,
  board_revision TEXT NOT NULL,
  device_id TEXT NULL,
  usb_port TEXT NULL,
  usb_vid TEXT NULL,
  usb_pid TEXT NULL,
  usb_serial_number TEXT NULL,
  firmware_sha256 TEXT NULL,
  upload_status TEXT NOT NULL CHECK (upload_status IN ('pending','verified','observed','failed')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','verified','observed','failed')),
  serial_status TEXT NOT NULL CHECK (serial_status IN ('pending','verified','observed','failed')),
  serial_observation TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted','pending','failed')),
  reason TEXT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT NULL
);
CREATE INDEX idx_physical_acceptance_project ON physical_acceptance_records(project_id, created_at);
`,
  },
];

export function migrate(db: SqliteDb): void {
  assertQuickCheck(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version),
  );
  const maxSupportedVersion = Math.max(...MIGRATIONS.map((m) => m.version));
  if ([...applied].some((version) => version > maxSupportedVersion)) {
    throw new UnsupportedDatabaseSchemaError();
  }
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    });
    run();
  }
  assertQuickCheck(db);
  assertCriticalSchema(db);
}

/** Validate an already migrated database without mutating it. */
export function validateDatabase(db: SqliteDb): number {
  assertQuickCheck(db);
  const applied = (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version);
  const maxSupportedVersion = Math.max(...MIGRATIONS.map((m) => m.version));
  if (applied.some((version) => version > maxSupportedVersion)) throw new UnsupportedDatabaseSchemaError();
  assertCriticalSchema(db);
  if (applied.length === 0) throw new IncompleteDatabaseSchemaError();
  return Math.max(...applied);
}

function assertQuickCheck(db: SqliteDb): void {
  let result: unknown;
  try {
    result = db.pragma("quick_check", { simple: true });
  } catch {
    throw new DatabaseIntegrityError();
  }
  if (result !== "ok") throw new DatabaseIntegrityError();
}

function assertCriticalSchema(db: SqliteDb): void {
  const criticalTables = [
    "projects",
    "artifacts",
    "artifact_versions",
    "tasks",
    "build_records",
    "proposals",
    "idempotency_records",
    "schema_migrations",
  ];
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (criticalTables.some((table) => !existing.has(table))) throw new IncompleteDatabaseSchemaError();

  const requiredColumns: Record<string, string[]> = {
    projects: ["id", "name", "created_at"],
    artifacts: ["id", "project_id", "kind", "current_version_id"],
    artifact_versions: ["id", "artifact_id", "version_no", "content_ref", "content_hash"],
    tasks: ["id", "capability", "input", "status", "output"],
    build_records: ["id", "artifact_version_id", "status", "options", "diagnostics", "outputs_json"],
    proposals: ["id", "project_id", "artifact_id", "payload", "status"],
    idempotency_records: ["scope", "key", "request_hash", "response_status", "response_body_json"],
    schema_migrations: ["version", "name", "applied_at"],
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (columns.some((column) => !actual.has(column))) throw new IncompleteDatabaseSchemaError();
  }
}
