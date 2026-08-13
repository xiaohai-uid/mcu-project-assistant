// infrastructure/config.ts — 本地配置（M1 单用户；app-data 由未来 Slice 管理）
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  workspaceDir: string;
  deviceProvider: "companion" | "physical";
  arduinoCliPath: string;
  buildTimeoutMs: number;
}

export interface StorageConfig {
  dbPath: string;
  workspaceDir: string;
}

const APPLICATION_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env, applicationRoot = APPLICATION_ROOT): AppConfig {
  const root = applicationRoot;
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

  const rawBuildTimeout = env.MCU_BUILD_TIMEOUT_MS?.trim() || "600000";
  if (!/^\d+$/.test(rawBuildTimeout) || Number(rawBuildTimeout) < 1) {
    throw new Error("MCU_BUILD_TIMEOUT_MS must be a positive integer");
  }
  const buildTimeoutMs = Number(rawBuildTimeout);
  const arduinoCliPath = env.MCU_ARDUINO_CLI_PATH?.trim() || "arduino-cli";

  const storage = loadStorageConfig(env, root);

  const deviceProvider = env.MCU_DEVICE_PROVIDER?.trim();
  if (deviceProvider !== "companion" && deviceProvider !== "physical") {
    throw new Error('MCU_DEVICE_PROVIDER must be explicitly set to "companion" or "physical"; refusing an implicit device fallback');
  }

  return {
    host, // M1 local single-user; loopback by default (Security Spec §5)
    port,
    dbPath: storage.dbPath,
    workspaceDir: storage.workspaceDir,
    deviceProvider,
    arduinoCliPath,
    buildTimeoutMs,
  };
}

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env, applicationRoot = APPLICATION_ROOT): StorageConfig {
  const rawDbPath = env.MCU_DB_PATH?.trim();
  const rawWorkspaceDir = env.MCU_WORKSPACE_DIR?.trim();
  if (rawDbPath && !isAbsolute(rawDbPath)) throw new Error("MCU_DB_PATH must be an absolute path");
  if (rawWorkspaceDir && !isAbsolute(rawWorkspaceDir)) throw new Error("MCU_WORKSPACE_DIR must be an absolute path");
  const dbPath = rawDbPath ? resolve(rawDbPath) : join(applicationRoot, "data", "mcu.db");
  const workspaceDir = rawWorkspaceDir ? resolve(rawWorkspaceDir) : join(applicationRoot, "workspace");
  const workspaceRelativeDbPath = relative(workspaceDir, dbPath);
  if (workspaceRelativeDbPath === "" || (!workspaceRelativeDbPath.startsWith("..") && !isAbsolute(workspaceRelativeDbPath))) {
    throw new Error("MCU_DB_PATH must not be inside MCU_WORKSPACE_DIR");
  }
  return { dbPath, workspaceDir };
}
