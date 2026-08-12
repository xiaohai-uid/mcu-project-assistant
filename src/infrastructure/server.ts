// infrastructure/server.ts — 引导：DB → migrate → HTTP（Modular Monolith 入口）
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createSseEvents } from "@/src/adapters/events/sse";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createZhipuAiProvider } from "@/src/adapters/ai/zhipu-glm";
import { createEsp32ArduinoCompiler } from "@/src/adapters/compiler/esp32-arduino";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
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

// AI Provider 显式选择（无 fallback）：MCU_AI_PROVIDER=zhipu → 真实智谱 GLM（MCU_ZHIPU_API_KEY）；
// 否则 mock（开发/CI/无 key 环境）。单一路径注入，不存在 try/catch 回退 mock。
const ai =
  process.env.MCU_AI_PROVIDER === "zhipu"
    ? createZhipuAiProvider({ apiKey: process.env.MCU_ZHIPU_API_KEY ?? "" })
    : createMockAiProvider();

const app = createApp({
  persistence,
  workspaceDir: config.workspaceDir,
  content: createWorkspaceFilesContent(config.workspaceDir),
  events,
  tasks: createInProcessTasks({ persistence, events }),
  compiler: createEsp32ArduinoCompiler(),
  device: createCompanionLocalDevice(),
  ai,
});

app.listen(config.port, config.host, () => {
  console.log(`MCU Project Assistant local server listening on http://${config.host}:${config.port} (ai=${ai.name})`);
});
