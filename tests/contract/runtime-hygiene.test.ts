import { existsSync, readdirSync } from "node:fs";
import { execPath } from "node:process";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestTempDir, getSafeTestTempRoot, removeOwnedTestTempDir } from "@/tests/helpers/test-temp";

const repoRoot = resolve(process.cwd());
const wrapper = resolve(repoRoot, "scripts/run-with-safe-temp.mjs");
const tsx = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");

function runPollutedEnv(command: string, args: string[]) {
  return spawnSync(execPath, [wrapper, command, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TEMP: repoRoot,
      TMP: repoRoot,
      TMPDIR: repoRoot,
      MCU_TEST_TEMP_ROOT: "",
      NODE_COMPILE_CACHE: "",
    },
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseProbe(stdout: string): { temp: string; compileCache: string | null } {
  const line = stdout.trim().split(/\r?\n/).find((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error(`Missing runtime probe output: ${stdout}`);
  return JSON.parse(line) as { temp: string; compileCache: string | null };
}

describe("test runtime artifact hygiene", () => {
  it("resolves owned test temp directories outside the repository", () => {
    const directory = createTestTempDir("mcu-hygiene");
    try {
      expect(getSafeTestTempRoot()).not.toBe(repoRoot);
      const relation = relative(repoRoot, directory);
      expect(relation.startsWith("..") || relation.includes(":")).toBe(true);
      expect(existsSync(directory)).toBe(true);
    } finally {
      removeOwnedTestTempDir(directory);
    }
  });

  it("keeps Node compile cache and tsx temp files outside the repo under polluted TEMP/TMP", () => {
    const nodeProbe = runPollutedEnv(execPath, [
      "-e",
      "const m=require('node:module'); console.log(JSON.stringify({temp:require('node:os').tmpdir(),compileCache:m.getCompileCacheDir?.() ?? null}))",
    ]);
    expect(nodeProbe.status).toBe(0);
    const nodePaths = parseProbe(nodeProbe.stdout);
    expect(nodePaths.temp).not.toBe(repoRoot);
    expect(nodePaths.compileCache).not.toContain(repoRoot);

    const tsxProbe = runPollutedEnv(execPath, [
      tsx,
      "-e",
      "console.log(JSON.stringify({temp:require('node:os').tmpdir(),compileCache:require('node:module').getCompileCacheDir?.() ?? null}))",
    ]);
    expect(tsxProbe.status).toBe(0);
    const tsxPaths = parseProbe(tsxProbe.stdout);
    expect(tsxPaths.temp).not.toBe(repoRoot);
    expect(tsxPaths.compileCache).not.toContain(repoRoot);

    const rootResidues = readdirSync(repoRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && (entry.name.startsWith("mcu-physical-fixture-") || entry.name === "node-compile-cache" || entry.name.startsWith("tsx-")))
      .map((entry) => entry.name);
    expect(rootResidues).toEqual([]);
  });
});
