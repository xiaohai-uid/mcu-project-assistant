// adapters/persistence/sqlite/project-store.ts — PersistencePort 的 SQLite 实现
import type { Project } from "@/src/domain/models/project";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { SqliteDb } from "./connection";

interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
  archived_reason: string | null;
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

export function createProjectStore(db: SqliteDb): PersistencePort {
  const insert = db.prepare(
    "INSERT INTO projects (id, name, created_at, archived_at, archived_reason) VALUES (@id, @name, @created_at, @archived_at, @archived_reason)",
  );
  const updateArchive = db.prepare(
    "UPDATE projects SET archived_at = ?, archived_reason = ? WHERE id = ?",
  );
  const selectById = db.prepare("SELECT * FROM projects WHERE id = ?");
  const selectAll = db.prepare("SELECT * FROM projects ORDER BY created_at ASC");

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
  };

  return {
    withTransaction: async <T>(fn: (u: UnitOfWork) => T): Promise<T> => {
      const tx = db.transaction(fn);
      return tx(uow);
    },
    getProject: async (id: string) => uow.getProject(id),
    listProjects: async () => uow.listProjects(),
  };
}
