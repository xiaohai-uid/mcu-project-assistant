// infrastructure/server.ts — 引导：DB → migrate → HTTP（Modular Monolith 入口）
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createSseEvents } from "@/src/adapters/events/sse";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createAiProvider } from "./ai-provider";
import { loadConfig } from "./config";

const config = loadConfig();
const frontendDist = fileURLToPath(new URL("../../app/dist/", import.meta.url));

mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.workspaceDir, { recursive: true });

const db = openDatabase(config.dbPath);
migrate(db);
const persistence = createProjectStore(db);
const events = createSseEvents();

// AI Provider 必须显式选择真实 provider；配置错误在 HTTP server 初始化前 fail-closed。
const ai = createAiProvider();
const compiler = createEsp32ArduinoCompiler();
const tasks = createInProcessTasks({ persistence, events });
if (config.deviceProvider !== "companion") throw new Error("No supported device provider configured");
const device = createCompanionLocalDevice();

async function startServer(): Promise<void> {
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
  });

  // Recovery claims/schedules before listen; long executions continue after HTTP is exposed.
  const recovery = await tasks.recover();
  if (recovery.recovered > 0) console.log(`Scheduled durable task recovery: count=${recovery.recovered}`);

  const server = app.listen(config.port, config.host, () => {
    console.log(`MCU Project Assistant local server listening on http://${config.host}:${config.port} (ai=${ai.name})`);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      await tasks.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    })();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void startServer().catch((err) => {
  console.error(err);
  db.close();
  process.exitCode = 1;
});
