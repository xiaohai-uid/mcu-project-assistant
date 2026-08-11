// infrastructure/config.ts — 本地配置（M1 单用户；app-data 由未来 Slice 管理）
import { join } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  workspaceDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = process.cwd();
  return {
    host: "127.0.0.1", // M1 本地单用户；绑定回环（Security Spec §5）
    port: Number(env.MCU_PORT ?? 3000),
    dbPath: env.MCU_DB_PATH ?? join(root, "data", "mcu.db"),
    workspaceDir: env.MCU_WORKSPACE_DIR ?? join(root, "workspace"),
  };
}
