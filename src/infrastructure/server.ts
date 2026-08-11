// infrastructure/server.ts — 引导：DB → migrate → HTTP（Modular Monolith 入口）
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createSseEvents } from "@/src/adapters/events/sse";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { loadConfig } from "./config";

const config = loadConfig();

mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.workspaceDir, { recursive: true });

const db = openDatabase(config.dbPath);
migrate(db);
const persistence = createProjectStore(db);
const events = createSseEvents();

const app = createApp({
  persistence,
  workspaceDir: config.workspaceDir,
  content: createWorkspaceFilesContent(config.workspaceDir),
  events,
  tasks: createInProcessTasks({ persistence, events }),
  compiler: createEsp32ArduinoCompiler(),
  ai: createMockAiProvider(),
});

app.listen(config.port, config.host, () => {
  console.log(`MCU Project Assistant local server listening on http://${config.host}:${config.port}`);
});
