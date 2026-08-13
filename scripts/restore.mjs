import { loadStorageConfig } from "../src/infrastructure/config.ts";
import { createRestore } from "../src/infrastructure/backup-restore.ts";

function parseArgs(argv, allowed) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    if (!allowed.has(key) || values.has(key)) throw new Error(`Unknown or duplicate argument: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    values.set(key, value);
    index += 1;
  }
  return values;
}

try {
  const args = parseArgs(process.argv.slice(2), new Set(["backup", "db", "workspace"]));
  const config = loadStorageConfig();
  const backupDir = args.get("backup");
  if (!backupDir) throw new Error("--backup is required");
  const result = await createRestore({
    backupDir,
    dbPath: args.get("db") ?? config.dbPath,
    workspaceDir: args.get("workspace") ?? config.workspaceDir,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "restore_validation_failed";
  const message = error instanceof Error ? error.message : "Restore failed";
  console.error(JSON.stringify({ code, message }));
  process.exitCode = 1;
}
