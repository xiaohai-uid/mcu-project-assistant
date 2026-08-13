import { loadStorageConfig } from "../src/infrastructure/config.ts";
import { createBackup } from "../src/infrastructure/backup-restore.ts";

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
  const args = parseArgs(process.argv.slice(2), new Set(["db", "workspace", "output"]));
  if (!args.get("output")) throw new Error("--output is required");
  const config = loadStorageConfig();
  const result = await createBackup({
    dbPath: args.get("db") ?? config.dbPath,
    workspaceDir: args.get("workspace") ?? config.workspaceDir,
    outputDir: args.get("output") ?? "",
  });
  console.log(JSON.stringify({ backupDir: result.backupDir, manifest: result.manifest }, null, 2));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "backup_failed";
  const message = error instanceof Error ? error.message : "Backup failed";
  console.error(JSON.stringify({ code, message }));
  process.exitCode = 1;
}
