// infrastructure/config.ts — 本地配置（M1 单用户；app-data 由未来 Slice 管理）
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BasicAuthConfig {
  username: string;
  password: string;
}

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  workspaceDir: string;
  deviceProvider: "companion" | "physical";
  arduinoCliPath: string;
  arduinoCliConfigPath: string | null;
  buildTimeoutMs: number;
  publicMode: boolean;
  basicAuth: BasicAuthConfig | null;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface StorageConfig {
  dbPath: string;
  workspaceDir: string;
}

const APPLICATION_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env, applicationRoot = APPLICATION_ROOT): AppConfig {
  const root = applicationRoot;
  const publicMode = parseBoolean(env.MCU_PUBLIC_MODE, "MCU_PUBLIC_MODE");
  const rawHost = env.MCU_HOST;
  if (rawHost !== undefined && !rawHost.trim()) throw new Error("MCU_HOST must not be empty");
  const host = rawHost?.trim() || "127.0.0.1";
  if (!publicMode && host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("MCU_HOST must be localhost or 127.0.0.1 unless MCU_PUBLIC_MODE is enabled");
  }
  if (publicMode && host !== "127.0.0.1" && host !== "localhost" && host !== "0.0.0.0" && host !== "::") {
    throw new Error("MCU_HOST must be localhost, 127.0.0.1, 0.0.0.0, or ::");
  }
  const basicAuth = loadBasicAuth(env, publicMode);

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
  const rawArduinoCliConfigPath = env.MCU_ARDUINO_CLI_CONFIG_PATH?.trim();
  if (rawArduinoCliConfigPath && !isAbsolute(rawArduinoCliConfigPath)) {
    throw new Error("MCU_ARDUINO_CLI_CONFIG_PATH must be an absolute path");
  }

  const storage = loadStorageConfig(env, root);

  const deviceProvider = env.MCU_DEVICE_PROVIDER?.trim();
  if (deviceProvider !== "companion" && deviceProvider !== "physical") {
    throw new Error('MCU_DEVICE_PROVIDER must be explicitly set to "companion" or "physical"; refusing an implicit device fallback');
  }

  const rawLogLevel = env.MCU_LOG_LEVEL?.trim().toLowerCase() || "info";
  if (rawLogLevel !== "debug" && rawLogLevel !== "info" && rawLogLevel !== "warn" && rawLogLevel !== "error") {
    throw new Error('MCU_LOG_LEVEL must be one of "debug", "info", "warn", "error"');
  }

  return {
    host, // M1 local single-user; loopback by default (Security Spec §5)
    port,
    dbPath: storage.dbPath,
    workspaceDir: storage.workspaceDir,
    deviceProvider,
    arduinoCliPath,
    arduinoCliConfigPath: rawArduinoCliConfigPath ? resolve(rawArduinoCliConfigPath) : null,
    buildTimeoutMs,
    publicMode,
    basicAuth,
    logLevel: rawLogLevel,
  };
}

function parseBoolean(raw: string | undefined, name: string): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  throw new Error(name + " must be true or false");
}

function loadBasicAuth(env: NodeJS.ProcessEnv, publicMode: boolean): BasicAuthConfig | null {
  const rawUsername = env.MCU_BASIC_AUTH_USER;
  const rawPassword = env.MCU_BASIC_AUTH_PASSWORD;
  const hasUsername = rawUsername !== undefined;
  const hasPassword = rawPassword !== undefined;
  if (hasUsername !== hasPassword) {
    throw new Error("MCU_BASIC_AUTH_USER and MCU_BASIC_AUTH_PASSWORD must be provided together");
  }
  if (!hasUsername && !hasPassword) {
    if (publicMode) throw new Error("MCU_PUBLIC_MODE requires MCU_BASIC_AUTH_USER and MCU_BASIC_AUTH_PASSWORD");
    return null;
  }

  const username = rawUsername!.trim();
  const password = rawPassword!;
  if (!username || username.includes(":") || /[\r\n]/.test(username)) {
    throw new Error("MCU_BASIC_AUTH_USER must be a non-empty username without colon or line breaks");
  }
  if (password.length < 16 || /[\r\n]/.test(password)) {
    throw new Error("MCU_BASIC_AUTH_PASSWORD must be at least 16 characters without line breaks");
  }
  return { username, password };
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
