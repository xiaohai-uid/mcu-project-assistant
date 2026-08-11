// adapters/persistence/sqlite/connection.ts — SQLite 连接（ADR-0004；WAL crash-safe）
import Database from "better-sqlite3";

export type SqliteDb = Database.Database;

export function openDatabase(path: string): SqliteDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
