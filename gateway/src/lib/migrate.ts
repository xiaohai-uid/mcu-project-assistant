import fs from "fs";
import path from "path";
import { pool } from "./database";

const MIGRATIONS_TABLE = "_migrations";

async function ensureTrackingTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW(),
      checksum VARCHAR(64) NOT NULL
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const result = await pool.query(`SELECT filename FROM ${MIGRATIONS_TABLE}`);
  return new Set(result.rows.map((r: { filename: string }) => r.filename));
}

function getMigrationsDir(): string {
  return (
    process.env.MIGRATIONS_DIR ||
    path.resolve(process.cwd(), "../shared/database/migrations")
  );
}

function computeChecksum(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export async function runMigrations(): Promise<void> {
  const dir = getMigrationsDir();

  if (!fs.existsSync(dir)) {
    console.warn(`[migrate] Migrations directory not found: ${dir}, skipping`);
    return;
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] No migration files found");
    return;
  }

  await ensureTrackingTable();
  const applied = await getApplied();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] SKIP ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    const checksum = computeChecksum(sql);

    try {
      await pool.query("BEGIN");
      await pool.query(sql);
      await pool.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES ($1, $2)`,
        [file, checksum]
      );
      await pool.query("COMMIT");
      console.log(`[migrate] OK  ${file}`);
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error(`[migrate] FAIL ${file}:`, err);
      throw err;
    }
  }
}