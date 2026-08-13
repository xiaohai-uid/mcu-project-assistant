// infrastructure/server.ts — 引导：DB → migrate → HTTP（Modular Monolith 入口）
import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createSseEvents } from "@/src/adapters/events/sse";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createPhysicalArduinoDevice } from "@/src/adapters/device/physical-arduino";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createAiProvider } from "./ai-provider";
import { loadConfig } from "./config";
import { toSafeError } from "@/src/shared-contracts/errors";
import { acquireProductionStateOwnership } from "./backup-restore";
import { createShutdownCoordinator, createShutdownState } from "./shutdown";

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

function waitForListening(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onListening = () => { server.removeListener("error", onError); resolve(); };
    const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

function closeServer(server: Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    try { server.close(finish); } catch { finish(); }
  });
}

async function startServer(): Promise<void> {
  const config = loadConfig();
  const frontendDist = fileURLToPath(new URL("../../app/dist/", import.meta.url));
  mkdirSync(dirname(config.dbPath), { recursive: true });
  mkdirSync(config.workspaceDir, { recursive: true });
  const ownership = acquireProductionStateOwnership(config.dbPath, config.workspaceDir);
  const shutdownState = createShutdownState();
  let released = false;
  let db: ReturnType<typeof openDatabase> | null = null;
  let stopTasks: (() => Promise<void>) | null = null;
  let shutdownDevice: (() => Promise<void>) | null = null;
  let server: Server | null = null;
  let forcedShutdown = false;
  const releaseOwnership = (): void => {
    if (released) return;
    released = true;
    db?.close();
    ownership.release();
  };
  process.once("exit", () => {
    if (!forcedShutdown) releaseOwnership();
  });

  try {
    db = openDatabase(config.dbPath);
    migrate(db);
    const persistence = createProjectStore(db);
    const events = createSseEvents();
    const ai = createAiProvider();
    const compiler = createEsp32ArduinoCompiler({ arduinoCliPath: config.arduinoCliPath, timeoutMs: config.buildTimeoutMs });
    const tasks = createInProcessTasks({ persistence, events });
    stopTasks = tasks.stop;
    const device = config.deviceProvider === "physical"
      ? createPhysicalArduinoDevice({ arduinoCliPath: config.arduinoCliPath, timeoutMs: 5 * 60 * 1000 })
      : createCompanionLocalDevice();
    shutdownDevice = device.shutdown;
    const app = createApp({
      persistence,
      workspaceDir: config.workspaceDir,
      content: createWorkspaceFilesContent(config.workspaceDir),
      events,
      tasks,
      compiler,
      device,
      ai,
      frontendDist,
      shutdown: shutdownState,
    });

    // Recovery claims/schedules before listen; long executions continue after HTTP is exposed.
    const recovery = await tasks.recover();
    if (recovery.recovered > 0) console.log(`Scheduled durable task recovery: count=${recovery.recovered}`);

    server = app.listen(config.port, config.host, () => {
      console.log(`MCU Project Assistant local server listening on http://${config.host}:${config.port} (ai=${ai.name})`);
    });
    await waitForListening(server);

    const shutdown = createShutdownCoordinator({
      state: shutdownState,
      closeSseStreams: app.closeSseStreams,
      stopAccepting: () => {
        server?.closeIdleConnections?.();
        return closeServer(server);
      },
      stopTasks: tasks.stop,
      shutdownDevice: device.shutdown,
      forceClose: () => {
        app.closeSseStreams();
        server?.closeAllConnections?.();
        server?.closeIdleConnections?.();
      },
      releaseOwnership,
      timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
      onTimeout: () => {
        forcedShutdown = true;
        process.exitCode = 1;
        process.exit(1);
      },
    });
    const onSignal = (): void => { void shutdown.beginShutdown(); };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  } catch (error) {
    try { await stopTasks?.(); } catch { /* startup cleanup */ }
    try { await shutdownDevice?.(); } catch { /* startup cleanup */ }
    await closeServer(server);
    releaseOwnership();
    throw error;
  }
}

void startServer().catch((err) => {
  const safe = toSafeError(err);
  const raw = typeof err === "object" && err !== null ? (err as { name?: unknown; message?: unknown }) : {};
  const rawCode = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : "";
  const actionable = raw.name === "BackupRestoreError"
    ? safe.message
    : rawCode === "EADDRINUSE"
      ? "EADDRINUSE: configured HTTP address is already in use"
    : (raw.name === "AiProviderConfigurationError" || (typeof raw.message === "string" && /^MCU_[A-Z0-9_]+\b/.test(raw.message)))
      ? String(raw.message)
      : safe.message;
  console.error(`[startup:${safe.code}] ${actionable}`);
  process.exitCode = 1;
});
