// adapters/persistence/sqlite/migrations.ts — 版本化迁移（schema 随 Slice 增长）
// S1 仅 projects 表；S2 增 artifacts + artifact_versions（ISSUE-002 §8）；禁止一次性建未来 Slice 的表。
import type { SqliteDb } from "./connection";

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
  source_kind TEXT NOT NULL CHECK (source_kind IN ('manual','ai')),
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
];

export function migrate(db: SqliteDb): void {
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
}
