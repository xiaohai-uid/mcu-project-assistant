// infrastructure/server.ts — 引导：DB → migrate → HTTP（Modular Monolith 入口）
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApp } from "@/src/adapters/http/app";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { loadConfig } from "./config";

const config = loadConfig();

mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.workspaceDir, { recursive: true });

const db = openDatabase(config.dbPath);
migrate(db);

const app = createApp({ persistence: createProjectStore(db), workspaceDir: config.workspaceDir });

app.listen(config.port, config.host, () => {
  console.log(`MCU Project Assistant local server listening on http://${config.host}:${config.port}`);
});
