import { execPath } from "node:process";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestTempDir, removeOwnedTestTempDir } from "@/tests/helpers/test-temp";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";

const children: ChildProcess[] = [];
const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const envNames = [
  "MCU_AI_PROVIDER",
  "MCU_ZHIPU_API_KEY",
  "MCU_ZHIPU_BASE_URL",
  "MCU_ZHIPU_CHAT_MODEL",
  "SENSENOVA_API_KEY",
  "SENSENOVA_BASE_URL",
  "SENSENOVA_CHAT_MODEL",
  "MCU_HOST",
  "MCU_PORT",
  "MCU_DB_PATH",
  "MCU_WORKSPACE_DIR",
  "MCU_DEVICE_PROVIDER",
];

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
});

function start(overrides: Record<string, string>): ChildProcess {
  const env = { ...process.env };
  for (const name of envNames) delete env[name];
  Object.assign(env, overrides);
  const child = spawn(execPath, [tsx, "src/infrastructure/server.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

function waitForExit(child: ChildProcess, timeoutMs = 8_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("startup process did not exit")), timeoutMs);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) return true;
    } catch {
      // The server may still be completing its synchronous bootstrap.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("production startup configuration", () => {
  it("rejects missing and malformed config, then listens with explicit config without logging the key", async () => {
    const dir = createTestTempDir("mcu-config-startup");
    try {
      const missing = start({
        MCU_PORT: "31981",
        MCU_DB_PATH: join(dir, "missing.db"),
        MCU_WORKSPACE_DIR: join(dir, "missing-workspace"),
      });
      expect(await waitForExit(missing)).not.toBe(0);

      const physical = start({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-only-not-a-secret",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
        MCU_DEVICE_PROVIDER: "physical",
        MCU_PORT: "31984",
        MCU_DB_PATH: join(dir, "physical.db"),
        MCU_WORKSPACE_DIR: join(dir, "physical-workspace"),
      });
      expect(await waitForHealth(31984)).toBe(true);
      const physicalDetect = await fetch("http://127.0.0.1:31984/api/v1/device/detect", { method: "POST" });
      expect(physicalDetect.status).toBe(503);
      physical.kill("SIGTERM");
      await waitForExit(physical);

      const invalid = start({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-only-not-a-secret",
        SENSENOVA_BASE_URL: "not-a-url",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
        MCU_DEVICE_PROVIDER: "companion",
        MCU_PORT: "31982",
        MCU_DB_PATH: join(dir, "invalid.db"),
        MCU_WORKSPACE_DIR: join(dir, "invalid-workspace"),
      });
      expect(await waitForExit(invalid)).not.toBe(0);

      const valid = start({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-only-not-a-secret",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
        MCU_DEVICE_PROVIDER: "companion",
        MCU_PORT: "31983",
        MCU_DB_PATH: join(dir, "valid.db"),
        MCU_WORKSPACE_DIR: join(dir, "valid-workspace"),
      });
      expect(await waitForHealth(31983)).toBe(true);
      const output = await new Promise<string>((resolve) => {
        let output = "";
        valid.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        valid.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        valid.once("exit", () => resolve(output));
        valid.kill("SIGTERM");
      });
      expect(output).not.toContain("test-only-not-a-secret");
    } finally {
      removeOwnedTestTempDir(dir);
    }
  }, 30_000);

  it("rejects a non-SQLite database before opening an HTTP listener", async () => {
    const dir = createTestTempDir("mcu-integrity-startup");
    try {
      const dbPath = join(dir, "not-sqlite.db");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(dbPath, "not-a-sqlite", "utf8");
      const child = start({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-only-not-a-secret",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
        MCU_DEVICE_PROVIDER: "companion",
        MCU_PORT: "31985",
        MCU_DB_PATH: dbPath,
        MCU_WORKSPACE_DIR: join(dir, "workspace"),
      });
      expect(await waitForExit(child)).not.toBe(0);
      expect(await waitForHealth(31985, 500)).toBe(false);

      const truncatedPath = join(dir, "truncated.db");
      const database = openDatabase(truncatedPath);
      migrate(database);
      database.pragma("wal_checkpoint(TRUNCATE)");
      database.close();
      const truncatedBytes = readFileSync(truncatedPath).subarray(0, 4096);
      writeFileSync(truncatedPath, truncatedBytes);
      const truncated = start({
        MCU_AI_PROVIDER: "sensenova",
        SENSENOVA_API_KEY: "test-only-not-a-secret",
        SENSENOVA_BASE_URL: "https://example.invalid/v1",
        SENSENOVA_CHAT_MODEL: "deepseek-v4-flash",
        MCU_DEVICE_PROVIDER: "companion",
        MCU_PORT: "31986",
        MCU_DB_PATH: truncatedPath,
        MCU_WORKSPACE_DIR: join(dir, "truncated-workspace"),
      });
      expect(await waitForExit(truncated)).not.toBe(0);
      expect(await waitForHealth(31986, 500)).toBe(false);
      expect(readFileSync(truncatedPath)).toEqual(truncatedBytes);
    } finally {
      removeOwnedTestTempDir(dir);
    }
  }, 15_000);
});
