import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { validateDatabase } from "@/src/adapters/persistence/sqlite/migrations";
import type { ArtifactVersion } from "@/src/domain/models/artifact";
import { loadVerifiedArtifactContent } from "@/src/shared/persistence-integrity";
import { assertExistingPathContained, assertSafeRelativeReference, resolveContainedPath } from "@/src/shared/filesystem-confinement";

export type BackupRestoreErrorCode =
  | "production_state_in_use"
  | "backup_state_in_use"
  | "backup_output_exists"
  | "backup_failed"
  | "backup_invalid"
  | "backup_incomplete"
  | "backup_hash_mismatch"
  | "backup_format_unsupported"
  | "restore_target_not_empty"
  | "restore_validation_failed";

export class BackupRestoreError extends Error {
  readonly code: BackupRestoreErrorCode;

  constructor(code: BackupRestoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupRestoreError";
    this.code = code;
  }
}

export interface WorkspaceManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
  authoritative: boolean;
}

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  application: { name: "mcu-project-assistant"; version: string };
  schemaVersion: number;
  database: { file: "database.sqlite"; sizeBytes: number; sha256: string };
  workspace: { root: "workspace"; files: WorkspaceManifestFile[] };
}

export interface BackupResult {
  backupDir: string;
  manifest: BackupManifest;
}

export interface RestoreResult {
  dbPath: string;
  workspaceDir: string;
  projectCount: number;
  artifactCount: number;
  versionCount: number;
}

interface StateLock {
  path: string;
  release(): void;
}

export interface ProductionStateOwnership {
  dbPath: string;
  workspaceDir: string;
  release(): void;
}

interface StateLockOwner {
  version: 1;
  ownerId: string;
  pid: number;
  createdAt: string;
  resourcePath: string;
  resourceKind: "database" | "workspace" | "custom";
}

const COMPLETE_MARKER = "BACKUP_COMPLETE";
const MANIFEST_FILE = "manifest.json";
const DEFAULT_STATE_LOCK_SUFFIX = ".state.lock";
const SHA256 = /^[a-f0-9]{64}$/i;
const APP_VERSION = "0.1.0";
const PROCESS_STARTED_AT_MS = Date.now() - process.uptime() * 1000;

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  const missing: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  const existing = existsSync(current) ? realpathSync.native(current) : current;
  return missing.length === 0 ? existing : join(existing, ...missing);
}

function stateResourceLockPath(resourcePath: string): string {
  return `${resourcePath}${DEFAULT_STATE_LOCK_SUFFIX}`;
}

function readLockOwner(absolutePath: string): StateLockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as Partial<StateLockOwner>;
    if (
      parsed.version !== 1
      || typeof parsed.ownerId !== "string"
      || parsed.ownerId.length === 0
      || typeof parsed.pid !== "number"
      || !Number.isInteger(parsed.pid)
      || parsed.pid < 1
      || typeof parsed.createdAt !== "string"
      || typeof parsed.resourcePath !== "string"
      || (parsed.resourceKind !== "database" && parsed.resourceKind !== "workspace" && parsed.resourceKind !== "custom")
    ) return null;
    return parsed as StateLockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStaleLockOwner(owner: StateLockOwner): boolean {
  if (!isProcessAlive(owner.pid)) return true;
  // A container restart can reuse PID 1 while the old lock remains in a
  // named volume. When the PID is ours but the lock predates this process,
  // it belongs to the previous container/process instance.
  if (owner.pid === process.pid) {
    const createdAtMs = Date.parse(owner.createdAt);
    return Number.isFinite(createdAtMs) && createdAtMs < PROCESS_STARTED_AT_MS;
  }
  return false;
}

function acquireStateLock(
  lockPath: string,
  resource: { path?: string; kind?: "database" | "workspace" | "custom" } = {},
): StateLock {
  const absolutePath = resolve(lockPath);
  const owner: StateLockOwner = {
    version: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    createdAt: new Date().toISOString(),
    resourcePath: resolve(resource.path ?? absolutePath),
    resourceKind: resource.kind ?? "custom",
  };
  mkdirSync(dirname(absolutePath), { recursive: true });
  const tryCreate = (): number | null => {
    try {
      return openSync(absolutePath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new BackupRestoreError("backup_failed", `Unable to acquire production state lock: ${absolutePath}`, { cause: error });
      }
      return null;
    }
  };
  let fd = tryCreate();
  if (fd === null) {
    const current = readLockOwner(absolutePath);
    if (!current) {
      throw new BackupRestoreError("backup_state_in_use", `Production state lock is unreadable: ${absolutePath}`);
    }
    if (isStaleLockOwner(current)) {
      try {
        rmSync(absolutePath, { force: true });
      } catch (error) {
        throw new BackupRestoreError("backup_state_in_use", `Production state lock could not be reclaimed: ${absolutePath}`, { cause: error });
      }
      fd = tryCreate();
    }
  }
  if (fd === null) {
    throw new BackupRestoreError("backup_state_in_use", `Production state lock is already held: ${absolutePath}`);
  }
  try {
    writeFileSync(fd, JSON.stringify(owner), "utf8");
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    rmSync(absolutePath, { force: true });
    throw new BackupRestoreError("backup_failed", `Unable to initialize production state lock: ${absolutePath}`, { cause: error });
  }
  let released = false;
  return {
    path: absolutePath,
    release(): void {
      if (released) return;
      released = true;
      closeSync(fd);
      const current = readLockOwner(absolutePath);
      if (current?.ownerId === owner.ownerId) rmSync(absolutePath, { force: true });
    },
  };
}

export function acquireProductionStateOwnership(dbPath: string, workspaceDir: string): ProductionStateOwnership {
  const canonicalDbPath = canonicalPath(dbPath);
  const canonicalWorkspaceDir = canonicalPath(workspaceDir);
  const resources = [
    { path: canonicalDbPath, lockPath: stateResourceLockPath(canonicalDbPath), kind: "database" as const },
    { path: canonicalWorkspaceDir, lockPath: stateResourceLockPath(canonicalWorkspaceDir), kind: "workspace" as const },
  ].sort((left, right) => left.lockPath.localeCompare(right.lockPath));
  const locks: StateLock[] = [];
  try {
    for (const resource of resources) {
      locks.push(acquireStateLock(resource.lockPath, { path: resource.path, kind: resource.kind }));
    }
  } catch (error) {
    for (const lock of locks.reverse()) lock.release();
    if (error instanceof BackupRestoreError && error.code === "backup_state_in_use") {
      throw new BackupRestoreError("production_state_in_use", "Production state is already in use", { cause: error });
    }
    throw error;
  }
  let released = false;
  return {
    dbPath: canonicalDbPath,
    workspaceDir: canonicalWorkspaceDir,
    release(): void {
      if (released) return;
      released = true;
      for (const lock of locks.reverse()) lock.release();
    },
  };
}

function fail(code: BackupRestoreErrorCode, message: string, cause?: unknown): never {
  throw new BackupRestoreError(code, message, cause instanceof Error ? { cause } : undefined);
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function assertNotInside(path: string, root: string, label: string): void {
  if (isContained(root, path)) fail("backup_failed", `${label} must not be inside ${root}`);
}

function normalizeRelativePath(value: string, label: string): string {
  try {
    assertSafeRelativeReference(value);
  } catch (error) {
    fail("backup_invalid", `${label} is not a safe relative path`, error);
  }
  return value.replaceAll("\\", "/");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Bytes(readFileSync(path));
}

function normalizeStandaloneDatabase(path: string): void {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { fileMustExist: true });
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode = DELETE");
  } finally {
    db?.close();
  }
  for (const suffix of ["-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
}

function sortedEntries(root: string, current = root): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(current)) {
    if (name.startsWith(".tmp-") || name.startsWith(".backup-staging-") || name.startsWith(".restore-staging-")) continue;
    const candidate = join(current, name);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) fail("backup_failed", `Workspace symlink/reparse point is not supported: ${candidate}`);
    if (stat.isDirectory()) entries.push(...sortedEntries(root, candidate));
    else if (stat.isFile()) entries.push(candidate);
    else fail("backup_failed", `Unsupported workspace entry: ${candidate}`);
  }
  return entries.sort((a, b) => a.localeCompare(b));
}

function copyWorkspace(source: string, destination: string): WorkspaceManifestFile[] {
  if (!existsSync(source)) fail("backup_failed", `Workspace does not exist: ${source}`);
  const sourceStat = lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) fail("backup_failed", `Workspace must be a real directory: ${source}`);
  assertExistingPathContained(source, source);
  mkdirSync(destination, { recursive: true });
  const files: WorkspaceManifestFile[] = [];
  for (const sourceFile of sortedEntries(source)) {
    const relativePath = normalizeRelativePath(relative(source, sourceFile), "workspace file");
    const destinationFile = resolveContainedPath(destination, resolve(destination, relativePath));
    mkdirSync(dirname(destinationFile), { recursive: true });
    copyFileSync(sourceFile, destinationFile);
    const stat = statSync(destinationFile);
    files.push({
      path: relativePath,
      sizeBytes: stat.size,
      sha256: sha256File(destinationFile),
      authoritative: !relativePath.split("/").at(-1)?.toLowerCase().endsWith("project.json"),
    });
  }
  return files;
}

function assertFileMatches(path: string, expectedSize: number, expectedHash: string, label: string): void {
  if (!existsSync(path)) fail("backup_hash_mismatch", `${label} is missing`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("backup_hash_mismatch", `${label} is not a regular file`);
  if (stat.size !== expectedSize || sha256File(path) !== expectedHash) fail("backup_hash_mismatch", `${label} hash or size mismatch`);
}

function validateWorkspaceManifest(workspaceDir: string, files: WorkspaceManifestFile[], code: BackupRestoreErrorCode): void {
  const expected = new Map(files.map((file) => [file.path, file]));
  let actual: string[];
  try {
    actual = sortedEntries(workspaceDir).map((path) => normalizeRelativePath(relative(workspaceDir, path), "workspace file"));
  } catch (error) {
    if (error instanceof BackupRestoreError) throw new BackupRestoreError(code, error.message, { cause: error });
    throw error;
  }
  if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) fail(code, "Workspace file set does not match the backup manifest");
  for (const file of files) {
    assertFileMatches(resolveContainedPath(workspaceDir, resolve(workspaceDir, file.path)), file.sizeBytes, file.sha256, `Workspace file ${file.path}`);
  }
}

function schemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version?: number | null };
  if (!Number.isInteger(row.version) || (row.version ?? 0) < 1) fail("backup_invalid", "Database schema version is missing");
  return row.version as number;
}

function validateSnapshotDatabase(path: string): { schemaVersion: number; db: Database.Database } {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const supportedSchema = validateDatabase(db);
    return { schemaVersion: supportedSchema, db };
  } catch (error) {
    try { db?.close(); } catch { /* best effort */ }
    if (error instanceof BackupRestoreError) throw error;
    fail("restore_validation_failed", "SQLite snapshot failed integrity or schema validation", error);
  }
}

async function validateReferencedArtifactContent(db: Database.Database, workspaceDir: string): Promise<void> {
  const content = createWorkspaceFilesContent(workspaceDir);
  const rows = db.prepare("SELECT id, artifact_id, version_no, content_ref, content_hash, status, source_kind, source_proposal_id, created_at, created_by FROM artifact_versions").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    try {
      const version = {
        id: String(row.id), artifactId: String(row.artifact_id), versionNo: Number(row.version_no), contentRef: String(row.content_ref),
        contentHash: String(row.content_hash), status: row.status as ArtifactVersion["status"], sourceKind: row.source_kind as ArtifactVersion["sourceKind"],
        sourceProposalId: row.source_proposal_id === null ? null : String(row.source_proposal_id), createdAt: String(row.created_at), createdBy: String(row.created_by),
      } satisfies ArtifactVersion;
      await loadVerifiedArtifactContent(version, content);
    } catch (error) {
      fail("restore_validation_failed", `Referenced artifact content failed validation: ${String(row.id)}`, error);
    }
  }
}

function parseManifest(backupDir: string): BackupManifest {
  const manifestPath = resolveContainedPath(backupDir, join(backupDir, MANIFEST_FILE));
  const markerPath = resolveContainedPath(backupDir, join(backupDir, COMPLETE_MARKER));
  if (!existsSync(markerPath)) fail("backup_incomplete", "Backup completeness marker is missing");
  if (!existsSync(manifestPath)) fail("backup_invalid", "Backup manifest is missing");
  assertExistingPathContained(backupDir, manifestPath);
  assertExistingPathContained(backupDir, markerPath);
  let value: unknown;
  let marker: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, "utf8"));
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    fail("backup_invalid", "Backup manifest or completeness marker is malformed", error);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !marker || typeof marker !== "object" || Array.isArray(marker)) {
    fail("backup_invalid", "Backup manifest or completeness marker has an invalid shape");
  }
  const raw = value as Record<string, unknown>;
  const rawMarker = marker as Record<string, unknown>;
  if (raw.formatVersion !== 1) fail("backup_format_unsupported", "Backup format version is unsupported");
  if (typeof raw.createdAt !== "string" || !raw.application || typeof raw.application !== "object" || !Number.isInteger(raw.schemaVersion)) {
    fail("backup_invalid", "Backup manifest metadata is invalid");
  }
  const database = raw.database as Record<string, unknown> | undefined;
  const workspace = raw.workspace as Record<string, unknown> | undefined;
  if (!database || database.file !== "database.sqlite" || !Number.isInteger(database.sizeBytes) || typeof database.sha256 !== "string" || !SHA256.test(database.sha256)) {
    fail("backup_invalid", "Backup database manifest is invalid");
  }
  if (!workspace || workspace.root !== "workspace" || !Array.isArray(workspace.files)) fail("backup_invalid", "Backup workspace manifest is invalid");
  const files: WorkspaceManifestFile[] = [];
  const seen = new Set<string>();
  for (const item of workspace.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("backup_invalid", "Backup workspace file manifest is invalid");
    const file = item as Record<string, unknown>;
    if (typeof file.path !== "string" || !Number.isInteger(file.sizeBytes) || (file.sizeBytes as number) < 0 || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || typeof file.authoritative !== "boolean") {
      fail("backup_invalid", "Backup workspace file manifest is invalid");
    }
    const path = normalizeRelativePath(file.path, "workspace file");
    if (seen.has(path)) fail("backup_invalid", `Duplicate workspace file manifest entry: ${path}`);
    seen.add(path);
    files.push({ path, sizeBytes: file.sizeBytes as number, sha256: file.sha256 as string, authoritative: file.authoritative as boolean });
  }
  const expectedManifestHash = sha256File(resolveContainedPath(backupDir, join(backupDir, MANIFEST_FILE)));
  if (rawMarker.formatVersion !== 1 || rawMarker.manifestSha256 !== expectedManifestHash) fail("backup_incomplete", "Backup completeness marker does not match manifest");
  return {
    formatVersion: 1,
    createdAt: raw.createdAt as string,
    application: { name: "mcu-project-assistant", version: String((raw.application as Record<string, unknown>).version ?? APP_VERSION) },
    schemaVersion: Number(raw.schemaVersion),
    database: { file: "database.sqlite", sizeBytes: database.sizeBytes as number, sha256: database.sha256 as string },
    workspace: { root: "workspace", files },
  };
}

function validateBackupContents(backupDir: string, manifest: BackupManifest): { databasePath: string; workspacePath: string } {
  const databasePath = resolveContainedPath(backupDir, join(backupDir, manifest.database.file));
  const workspacePath = resolveContainedPath(backupDir, join(backupDir, manifest.workspace.root));
  assertFileMatches(databasePath, manifest.database.sizeBytes, manifest.database.sha256, "Backup database");
  if (!existsSync(workspacePath) || !lstatSync(workspacePath).isDirectory()) fail("backup_invalid", "Backup workspace root is missing");
  assertExistingPathContained(backupDir, workspacePath);
  validateWorkspaceManifest(workspacePath, manifest.workspace.files, "backup_hash_mismatch");
  return { databasePath, workspacePath };
}

export async function createBackup(input: { dbPath: string; workspaceDir: string; outputDir: string }): Promise<BackupResult> {
  const dbPath = resolve(input.dbPath);
  const workspaceDir = resolve(input.workspaceDir);
  const outputDir = resolve(input.outputDir);
  assertNotInside(outputDir, workspaceDir, "Backup output");
  if (existsSync(outputDir)) fail("backup_output_exists", `Backup output already exists: ${outputDir}`);
  if (!existsSync(dbPath) || !lstatSync(dbPath).isFile()) fail("backup_failed", `Database does not exist: ${dbPath}`);
  const ownership = acquireProductionStateOwnership(dbPath, workspaceDir);
  const parent = dirname(outputDir);
  const staging = join(parent, `.backup-staging-${randomUUID()}`);
  try {
    mkdirSync(parent, { recursive: true });
    mkdirSync(staging, { recursive: true });
    const stagedDatabase = join(staging, "database.sqlite");
    const source = openDatabase(dbPath);
    try {
      const supported = validateDatabase(source);
      await source.backup(stagedDatabase);
      normalizeStandaloneDatabase(stagedDatabase);
      const snapshot = validateSnapshotDatabase(stagedDatabase);
      snapshot.db.close();
      if (snapshot.schemaVersion !== supported) fail("backup_invalid", "SQLite schema changed while creating backup");
    } catch (error) {
      fail("backup_failed", "SQLite online backup failed", error);
    } finally {
      source.close();
    }
    const stagedWorkspace = join(staging, "workspace");
    const files = copyWorkspace(workspaceDir, stagedWorkspace);
    const snapshot = validateSnapshotDatabase(stagedDatabase);
    try {
      await validateReferencedArtifactContent(snapshot.db, stagedWorkspace);
      validateWorkspaceManifest(stagedWorkspace, files, "backup_hash_mismatch");
      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        application: { name: "mcu-project-assistant", version: APP_VERSION },
        schemaVersion: schemaVersion(snapshot.db),
        database: { file: "database.sqlite", sizeBytes: statSync(stagedDatabase).size, sha256: sha256File(stagedDatabase) },
        workspace: { root: "workspace", files },
      };
      assertFileMatches(stagedDatabase, manifest.database.sizeBytes, manifest.database.sha256, "Staged backup database");
      for (const file of files) {
        assertFileMatches(resolveContainedPath(stagedWorkspace, resolve(stagedWorkspace, file.path)), file.sizeBytes, file.sha256, `Staged backup workspace file ${file.path}`);
      }
      snapshot.db.close();
      const manifestPath = join(staging, MANIFEST_FILE);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      writeFileSync(join(staging, COMPLETE_MARKER), `${JSON.stringify({ formatVersion: 1, manifestSha256: sha256File(manifestPath) })}\n`, "utf8");
      renameSync(staging, outputDir);
      return { backupDir: outputDir, manifest };
    } finally {
      try { snapshot.db.close(); } catch { /* best effort */ }
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (error instanceof BackupRestoreError) throw error;
    throw new BackupRestoreError("backup_failed", "Backup failed", { cause: error });
  } finally {
    ownership.release();
  }
}

function assertRestoreTargetEmpty(dbPath: string, workspaceDir: string): void {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) fail("restore_target_not_empty", `Restore database target already exists: ${path}`);
  }
  if (existsSync(workspaceDir)) {
    const stat = lstatSync(workspaceDir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || readdirSync(workspaceDir).length > 0) {
      fail("restore_target_not_empty", `Restore workspace target is not empty: ${workspaceDir}`);
    }
  }
}

export async function createRestore(input: { backupDir: string; dbPath: string; workspaceDir: string }): Promise<RestoreResult> {
  const backupDir = resolve(input.backupDir);
  const dbPath = resolve(input.dbPath);
  const workspaceDir = resolve(input.workspaceDir);
  assertNotInside(dbPath, workspaceDir, "Restore database");
  assertNotInside(dbPath, backupDir, "Restore database");
  assertNotInside(backupDir, workspaceDir, "Backup source");
  assertNotInside(workspaceDir, backupDir, "Restore workspace");
  const ownership = acquireProductionStateOwnership(dbPath, workspaceDir);
  let dbStage: string | null = null;
  let workspaceStage: string | null = null;
  let publishedDb = false;
  let publishedWorkspace = false;
  try {
    assertRestoreTargetEmpty(dbPath, workspaceDir);
    const manifest = parseManifest(backupDir);
    const source = validateBackupContents(backupDir, manifest);
    const snapshot = validateSnapshotDatabase(source.databasePath);
    try {
      if (snapshot.schemaVersion !== manifest.schemaVersion) fail("restore_validation_failed", "Backup manifest schema version does not match SQLite snapshot");
      await validateReferencedArtifactContent(snapshot.db, source.workspacePath);
    } finally {
      snapshot.db.close();
    }
    const targetDbParent = dirname(dbPath);
    const targetWorkspaceParent = dirname(workspaceDir);
    mkdirSync(targetDbParent, { recursive: true });
    mkdirSync(targetWorkspaceParent, { recursive: true });
    dbStage = join(targetDbParent, `.restore-staging-${randomUUID()}.sqlite`);
    workspaceStage = join(targetWorkspaceParent, `.restore-staging-${randomUUID()}`);
    copyFileSync(source.databasePath, dbStage);
    copyWorkspace(source.workspacePath, workspaceStage);
    const stagedDb = validateSnapshotDatabase(dbStage);
    try {
      await validateReferencedArtifactContent(stagedDb.db, workspaceStage);
      validateWorkspaceManifest(workspaceStage, manifest.workspace.files, "restore_validation_failed");
    } finally {
      stagedDb.db.close();
    }
    renameSync(dbStage, dbPath);
    dbStage = null;
    publishedDb = true;
    if (existsSync(workspaceDir)) rmSync(workspaceDir, { recursive: true, force: true });
    renameSync(workspaceStage, workspaceDir);
    workspaceStage = null;
    publishedWorkspace = true;
    const restored = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const counts = {
        projectCount: (restored.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count,
        artifactCount: (restored.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as { count: number }).count,
        versionCount: (restored.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count,
      };
      return { dbPath, workspaceDir, ...counts };
    } finally {
      restored.close();
    }
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error;
    throw new BackupRestoreError("restore_validation_failed", "Restore failed before a complete target was published", { cause: error });
  } finally {
    if (dbStage) rmSync(dbStage, { force: true });
    if (workspaceStage) rmSync(workspaceStage, { recursive: true, force: true });
    if (publishedDb && !publishedWorkspace) rmSync(dbPath, { force: true });
    if (publishedWorkspace && !publishedDb) rmSync(workspaceDir, { recursive: true, force: true });
    ownership.release();
  }
}
