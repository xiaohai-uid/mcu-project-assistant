import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execPath } from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const fixture = join(process.cwd(), "tests", "fixtures", "owned-child-crash-process.ts");
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const parents: ChildProcess[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const parent of parents.splice(0)) {
    if (parent.exitCode === null) parent.kill("SIGKILL");
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function start(mode: "compiler" | "upload", root: string): ChildProcess {
  const child = spawn(execPath, [tsx, fixture, mode, join(root, "child.pid"), root], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  parents.push(child);
  return child;
}

async function waitForFile(path: string, parent: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    if (parent.exitCode !== null) throw new Error(`parent exited before child marker: ${parent.stderr?.read() ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForExit(parent: ChildProcess): Promise<void> {
  if (parent.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    parent.once("error", reject);
    parent.once("exit", () => resolve());
  });
}

async function waitForDead(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`child ${pid} remained alive after parent death`);
}

describe("parent-death-aware external child ownership", () => {
  it.each(["compiler", "upload"] as const)("terminates the %s child when only the parent is hard-killed", async (mode) => {
    const root = mkdtempSync(join(tmpdir(), `mcu-owned-${mode}-`));
    roots.push(root);
    const parent = start(mode, root);
    const marker = join(root, "child.pid");
    await waitForFile(marker, parent);
    const pid = Number(readFileSync(marker, "utf8"));
    expect(pid).toBeGreaterThan(0);

    parent.kill("SIGKILL");
    await waitForExit(parent);
    await waitForDead(pid);
  }, 30_000);
});
