import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireProductionStateOwnership } from "@/src/infrastructure/backup-restore";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { createShutdownCoordinator, createShutdownState } from "@/src/infrastructure/shutdown";

describe("shutdown coordinator", () => {
  it("marks draining first, drains in order, and shares one promise across signals", async () => {
    const state = createShutdownState();
    const order: string[] = [];
    let sideEffectActive = true;
    let resolveServerClose: (() => void) | undefined;
    const serverClose = new Promise<void>((resolve) => { resolveServerClose = resolve; });
    const coordinator = createShutdownCoordinator({
      state,
      closeSseStreams: () => order.push("sse"),
      stopAccepting: async () => { order.push("stop-accepting"); await serverClose; },
      stopTasks: async () => { expect(state.isDraining()).toBe(true); sideEffectActive = false; order.push("tasks"); },
      shutdownDevice: async () => { order.push("device"); },
      forceClose: () => order.push("force-close"),
      releaseOwnership: () => { expect(sideEffectActive).toBe(false); order.push("release"); },
      timeoutMs: 100,
    });

    const first = coordinator.beginShutdown();
    const second = coordinator.beginShutdown();
    expect(first).toBe(second);
    expect(state.isDraining()).toBe(true);
    resolveServerClose!();
    await first;

    expect(order).toEqual(["stop-accepting", "sse", "tasks", "device", "release"]);
    expect(state.isDraining()).toBe(true);
  });

  it("force-closes and completes local teardown at the timeout boundary", async () => {
    const state = createShutdownState();
    const order: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "mcu-shutdown-forced-"));
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    const ownership = acquireProductionStateOwnership(dbPath, workspaceDir);
    const dbLock = `${dbPath}.state.lock`;
    const workspaceLock = `${workspaceDir}.state.lock`;
    let sideEffectActive = true;
    let releaseCount = 0;
    const forced = createShutdownCoordinator({
      state,
      closeSseStreams: () => order.push("sse"),
      stopAccepting: async () => {
        order.push("stop-accepting");
        return new Promise<void>(() => undefined);
      },
      stopTasks: async () => { order.push("tasks"); return new Promise<void>(() => undefined); },
      shutdownDevice: async () => { order.push("device"); },
      forceClose: () => order.push("force-close"),
      releaseOwnership: () => { releaseCount += 1; sideEffectActive = false; ownership.release(); order.push("release"); },
      timeoutMs: 5,
    });

    await forced.beginShutdown();

    expect(order).toEqual(["stop-accepting", "sse", "tasks", "force-close"]);
    expect(releaseCount).toBe(0);
    expect(sideEffectActive).toBe(true);
    expect(existsSync(dbLock)).toBe(true);
    expect(existsSync(workspaceLock)).toBe(true);
    expect(state.isDraining()).toBe(true);

    const markDead = (path: string): void => {
      const owner = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
      writeFileSync(path, JSON.stringify({ ...owner, pid: 2147483647 }), "utf8");
    };
    markDead(dbLock);
    markDead(workspaceLock);
    const recovered = acquireProductionStateOwnership(dbPath, workspaceDir);
    recovered.release();
    expect(existsSync(dbLock)).toBe(false);
    expect(existsSync(workspaceLock)).toBe(false);
    ownership.release();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps ownership while a controlled side effect is still active, then allows stale recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-shutdown-ownership-"));
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    const ownership = acquireProductionStateOwnership(dbPath, workspaceDir);
    const dbLock = `${dbPath}.state.lock`;
    const workspaceLock = `${workspaceDir}.state.lock`;
    expect(existsSync(dbLock)).toBe(true);
    expect(existsSync(workspaceLock)).toBe(true);

    const markDead = (path: string): void => {
      const owner = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
      writeFileSync(path, JSON.stringify({ ...owner, pid: 2147483647 }), "utf8");
    };
    markDead(dbLock);
    markDead(workspaceLock);
    expect(existsSync(dbLock)).toBe(true);
    expect(existsSync(workspaceLock)).toBe(true);

    const recovered = acquireProductionStateOwnership(dbPath, workspaceDir);
    expect(existsSync(dbLock)).toBe(true);
    expect(existsSync(workspaceLock)).toBe(true);
    recovered.release();
    ownership.release();
    expect(existsSync(dbLock)).toBe(false);
    expect(existsSync(workspaceLock)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("waits for a controlled compiler child before releasing ownership", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-shutdown-child-"));
    const sourceDir = join(root, "source");
    const outputDir = join(root, "output");
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    const marker = join(root, "child.pid");
    mkdirSync(sourceDir, { recursive: true });
    const script = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
    const compiler = createEsp32ArduinoCompiler({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", script],
      timeoutMs: 5_000,
      terminateGraceMs: 20,
    });
    const controller = new AbortController();
    const build = compiler.build({
      target: "esp32-s3",
      toolchain: "esp32-arduino",
      options: {},
      sourceDir,
      outputDir,
    }, () => undefined, controller.signal);
    for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(existsSync(marker)).toBe(true);
    const childPid = Number(readFileSync(marker, "utf8"));
    const ownership = acquireProductionStateOwnership(dbPath, workspaceDir);
    let sideEffectActive = true;
    const coordinator = createShutdownCoordinator({
      state: createShutdownState(),
      closeSseStreams: () => undefined,
      stopAccepting: async () => undefined,
      stopTasks: async () => {
        expect(existsSync(`${dbPath}.state.lock`)).toBe(true);
        controller.abort();
        await build;
        sideEffectActive = false;
      },
      shutdownDevice: async () => undefined,
      forceClose: () => undefined,
      releaseOwnership: () => {
        expect(sideEffectActive).toBe(false);
        ownership.release();
      },
      timeoutMs: 500,
    });

    await coordinator.beginShutdown();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(childPid, 0); } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(existsSync(`${dbPath}.state.lock`)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
