import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isInsideRepo(candidate) {
  const relation = relative(repoRoot, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function resolveSafeTempBase() {
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

  throw new Error("Unable to resolve a repository-external temporary directory");
}

function removeTempRoot(root) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const waitBuffer = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(waitBuffer), 0, 0, 25);
    }
  }
  throw new Error(`Unable to remove temporary directory: ${root}`, { cause: lastError });
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("run-with-safe-temp requires a command");
  process.exit(2);
}

const safeTempRoot = mkdtempSync(join(resolveSafeTempBase(), "mcu-project-assistant-run-"));
const compileCacheRoot = join(safeTempRoot, "node-compile-cache");
mkdirSync(compileCacheRoot, { recursive: true });
const childEnvironment = {
  ...process.env,
  TEMP: safeTempRoot,
  TMP: safeTempRoot,
  TMPDIR: safeTempRoot,
  NODE_COMPILE_CACHE: compileCacheRoot,
  MCU_TEST_TEMP_ROOT: safeTempRoot,
};

const localEntrypoints = {
  npm: join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  tsc: join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  eslint: join(repoRoot, "node_modules", "eslint", "bin", "eslint.js"),
  vitest: join(repoRoot, "node_modules", "vitest", "vitest.mjs"),
  vite: join(repoRoot, "node_modules", "vite", "bin", "vite.js"),
};
const localEntrypoint = localEntrypoints[command];
const executable = localEntrypoint && existsSync(localEntrypoint) ? process.execPath : command;
const childArgs = localEntrypoint && existsSync(localEntrypoint) ? [localEntrypoint, ...args] : args;

let childExitCode = 1;
let childSignal = null;
const child = spawn(executable, childArgs, {
  cwd: repoRoot,
  env: childEnvironment,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});

const forwardSignal = (signal) => {
  if (child.exitCode === null) child.kill(signal);
};
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error(`Unable to start ${command}: ${error.message}`);
});

await new Promise((resolveChild) => {
  child.on("exit", (code, signal) => {
    childExitCode = code ?? 1;
    childSignal = signal;
    resolveChild();
  });
});

let cleanupFailed = false;
try {
  removeTempRoot(safeTempRoot);
} catch (error) {
  cleanupFailed = true;
  console.error(error instanceof Error ? error.message : "Unable to remove test temporary directory");
}

if (cleanupFailed) {
  process.exitCode = 1;
} else if (childSignal) {
  process.exitCode = 1;
} else {
  process.exitCode = childExitCode;
}
