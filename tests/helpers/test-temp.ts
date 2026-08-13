import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let processTempRoot: string | null = null;
let ownsProcessTempRoot = false;

function isInsideRepo(candidate: string): boolean {
  const relation = relative(repoRoot, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function assertSafeExternalPath(candidate: string): string {
  const absolute = resolve(candidate);
  if (!isAbsolute(absolute) || isInsideRepo(absolute)) {
    throw new Error("Test temporary directory must be an absolute path outside the repository");
  }
  return absolute;
}

function resolveSafeTempBase(): string {
  const configured = process.env.MCU_TEST_TEMP_ROOT;
  if (configured) return assertSafeExternalPath(configured);

  const candidates = process.platform === "win32"
    ? [
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Temp") : null,
        process.env.USERPROFILE ? join(process.env.USERPROFILE, "AppData", "Local", "Temp") : null,
        join(homedir(), "AppData", "Local", "Temp"),
      ]
    : [
        process.env.XDG_RUNTIME_DIR,
        join(homedir(), ".cache", "mcu-project-assistant", "test-temp"),
        "/tmp",
      ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const absolute = resolve(candidate);
    if (isAbsolute(absolute) && !isInsideRepo(absolute)) {
      mkdirSync(absolute, { recursive: true });
      return absolute;
    }
  }

  throw new Error("Unable to resolve a repository-external test temporary directory");
}

export function getSafeTestTempRoot(): string {
  if (processTempRoot) return processTempRoot;

  const configured = process.env.MCU_TEST_TEMP_ROOT;
  if (configured) {
    processTempRoot = assertSafeExternalPath(configured);
  } else {
    processTempRoot = mkdtempSync(join(resolveSafeTempBase(), "mcu-project-assistant-tests-"));
    ownsProcessTempRoot = true;
  }

  process.once("exit", () => {
    if (!ownsProcessTempRoot || !processTempRoot) return;
    try {
      rmSync(processTempRoot, { recursive: true, force: true });
    } catch {
      // Individual owned-directory cleanup is strict; process-exit cleanup is a final safeguard.
    }
  });
  return processTempRoot;
}

export function configureTestTempEnvironment(): string {
  const root = getSafeTestTempRoot();
  const compileCacheRoot = join(root, "node-compile-cache");
  mkdirSync(compileCacheRoot, { recursive: true });
  process.env.TEMP = root;
  process.env.TMP = root;
  process.env.TMPDIR = root;
  process.env.NODE_COMPILE_CACHE = compileCacheRoot;
  process.env.MCU_TEST_TEMP_ROOT = root;
  return root;
}

export function createTestTempDir(prefix: string): string {
  return mkdtempSync(join(getSafeTestTempRoot(), `${prefix}-`));
}

export function removeOwnedTestTempDir(directory: string): void {
  const absolute = assertSafeExternalPath(directory);
  const root = getSafeTestTempRoot();
  const relation = relative(root, absolute);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error(`Refusing to remove a non-owned test directory: ${absolute}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(absolute, { recursive: true, force: true });
      if (process.platform !== "win32") return;
      return;
    } catch (error) {
      lastError = error;
      if (process.platform === "win32") {
        const waitBuffer = new SharedArrayBuffer(4);
        Atomics.wait(new Int32Array(waitBuffer), 0, 0, 25);
      }
    }
  }
  throw new Error(`Unable to remove owned test directory: ${absolute}`, { cause: lastError });
}
