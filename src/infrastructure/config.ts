// infrastructure/config.ts — 本地配置（M1 单用户；app-data 由未来 Slice 管理）
import { isAbsolute, join, relative, resolve } from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  workspaceDir: string;
  deviceProvider: "companion";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = process.cwd();
  const rawHost = env.MCU_HOST;
  if (rawHost !== undefined && !rawHost.trim()) throw new Error("MCU_HOST must not be empty");
  const host = rawHost?.trim() || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("MCU_HOST must be localhost or 127.0.0.1 for the local execution mode");
  }

  const rawPort = env.MCU_PORT?.trim() || "3000";
  if (!/^\d+$/.test(rawPort)) throw new Error("MCU_PORT must be an integer from 1 to 65535");
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MCU_PORT must be an integer from 1 to 65535");
  }

  const dbPath = resolve(root, env.MCU_DB_PATH?.trim() || join("data", "mcu.db"));
  const workspaceDir = resolve(root, env.MCU_WORKSPACE_DIR?.trim() || "workspace");
  const workspaceRelativeDbPath = relative(workspaceDir, dbPath);
  if (workspaceRelativeDbPath === "" || (!workspaceRelativeDbPath.startsWith("..") && !isAbsolute(workspaceRelativeDbPath))) {
    throw new Error("MCU_DB_PATH must not be inside MCU_WORKSPACE_DIR");
  }

  const deviceProvider = env.MCU_DEVICE_PROVIDER?.trim();
  if (deviceProvider === "physical") {
    throw new Error('MCU_DEVICE_PROVIDER "physical" is unavailable; no physical adapter is configured');
  }
  if (deviceProvider !== "companion") {
    throw new Error('MCU_DEVICE_PROVIDER must be explicitly set to "companion"; refusing an implicit device fallback');
  }

  return {
    host, // M1 local single-user; loopback by default (Security Spec §5)
    port,
    dbPath,
    workspaceDir,
    deviceProvider: "companion",
  };
}
