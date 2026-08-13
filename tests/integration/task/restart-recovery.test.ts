import { existsSync, readFileSync } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createTestTempDir, removeOwnedTestTempDir } from "@/tests/helpers/test-temp";

const children: ChildProcess[] = [];
const fixture = join(process.cwd(), "tests", "fixtures", "restart-recovery-process.ts");
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

afterEach(() => {
  for (const child of children.splice(0)) {
    if (!child.killed && child.exitCode === null && child.pid) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // process already exited
      }
    }
  }
});

function start(mode: "A" | "B", paths: string[]): ChildProcess {
  const child = spawn(process.execPath, [tsx, fixture, mode, ...paths], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

async function waitForFile(path: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    if (child.exitCode !== null) {
      throw new Error(`process exited before ${path}: ${child.stderr?.read() ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? -1));
  });
}

function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // Node's TerminateProcess fallback handles a wrapper that already exited.
    child.kill("SIGKILL");
  }
}

describe("durable restart recovery", () => {
  it("recovers the same task exactly once in a fresh OS process", async () => {
    const dir = createTestTempDir("mcu-restart-recovery");
    const dbPath = join(dir, "tasks.db");
    const startedPath = join(dir, "started");
    const countPath = join(dir, "completion-count");
    const resultPath = join(dir, "result.json");

    try {
      const processA = start("A", [dbPath, startedPath, countPath, resultPath]);
      await waitForFile(startedPath, processA);

      const beforeRestartDb = openDatabase(dbPath);
      const beforeRestartStore = createProjectStore(beforeRestartDb);
      expect((await beforeRestartStore.getTask("restart-task"))?.status).toBe("running");
      beforeRestartDb.close();

      if (!processA.pid) throw new Error("process A did not expose a pid");
      const processAExit = waitForExit(processA);
      killProcessTree(processA);
      await processAExit;

      const processB = start("B", [dbPath, startedPath, countPath, resultPath]);
      expect(await waitForExit(processB)).toBe(0);

      const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
        recovery: { recovered: number; failed: number };
        task: { id: string; status: string; output: string | null };
      };
      expect(result.recovery).toEqual({ recovered: 1, failed: 0 });
      expect(result.task).toMatchObject({ id: "restart-task", status: "completed", output: JSON.stringify({ capabilities: [] }) });
      expect(readFileSync(countPath, "utf8").trim().split("\n")).toEqual(["completed"]);

      const afterRestartDb = openDatabase(dbPath);
      const afterRestartStore = createProjectStore(afterRestartDb);
      expect(await afterRestartStore.getTask("restart-task")).toMatchObject({
        id: "restart-task",
        status: "completed",
        output: JSON.stringify({ capabilities: [] }),
      });
      afterRestartDb.close();
    } finally {
      removeOwnedTestTempDir(dir);
    }
  }, 30_000);
});
