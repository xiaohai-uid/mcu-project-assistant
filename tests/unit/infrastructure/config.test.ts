import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig } from "@/src/infrastructure/config";

describe("production runtime configuration", () => {
  const valid = {
    MCU_HOST: "127.0.0.1",
    MCU_PORT: "3100",
    MCU_DB_PATH: resolve("C:/mcu-config-test/data/test-config.db"),
    MCU_WORKSPACE_DIR: resolve("C:/mcu-config-test/workspace/test-config"),
    MCU_DEVICE_PROVIDER: "companion",
  };

  it("accepts an explicit local companion configuration and resolves paths", () => {
    const config = loadConfig(valid);

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3100,
      dbPath: resolve("C:/mcu-config-test/data/test-config.db"),
      workspaceDir: resolve("C:/mcu-config-test/workspace/test-config"),
      deviceProvider: "companion",
      arduinoCliPath: "arduino-cli",
      arduinoCliConfigPath: null,
      buildTimeoutMs: 600000,
      publicMode: false,
      basicAuth: null,
      logLevel: "info",
    });
  });

  it.each(["0", "65536", "3000.5", "not-a-port"])('rejects malformed port "%s"', (port) => {
    expect(() => loadConfig({ ...valid, MCU_PORT: port })).toThrow(/MCU_PORT/i);
  });

  it('rejects malformed log level "verbose"', () => {
    expect(() => loadConfig({ ...valid, MCU_LOG_LEVEL: "verbose" })).toThrow(/MCU_LOG_LEVEL/i);
  });

  it("normalizes and defaults the log level like other optional fields", () => {
    expect(loadConfig({ ...valid, MCU_LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
    expect(loadConfig({ ...valid, MCU_LOG_LEVEL: "" }).logLevel).toBe("info");
  });

  it("rejects relative production storage paths instead of binding them to the current cwd", () => {
    expect(() => loadConfig({ ...valid, MCU_DB_PATH: "./data/relative.db" })).toThrow(/absolute path/i);
    expect(() => loadConfig({ ...valid, MCU_WORKSPACE_DIR: "./workspace/relative" })).toThrow(/absolute path/i);
  });

  it("accepts an absolute Arduino CLI config path and rejects relative paths", () => {
    const configPath = resolve("C:/mcu-config-test/toolchain/arduino-cli.yaml");
    expect(loadConfig({ ...valid, MCU_ARDUINO_CLI_CONFIG_PATH: configPath }).arduinoCliConfigPath).toBe(configPath);
    expect(() => loadConfig({ ...valid, MCU_ARDUINO_CLI_CONFIG_PATH: "toolchain/arduino-cli.yaml" })).toThrow(/absolute path/i);
  });

  it("keeps the checked-in storage examples absolute and accepted by production config", () => {
    const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    const dbPath = /^# MCU_DB_PATH=([^\s#]+)/m.exec(template)?.[1];
    const workspaceDir = /^# MCU_WORKSPACE_DIR=([^\s#]+)/m.exec(template)?.[1];

    expect(dbPath).toBeTruthy();
    expect(workspaceDir).toBeTruthy();
    expect(isAbsolute(dbPath!)).toBe(true);
    expect(isAbsolute(workspaceDir!)).toBe(true);
    expect(loadConfig({ ...valid, MCU_DB_PATH: dbPath, MCU_WORKSPACE_DIR: workspaceDir })).toMatchObject({
      dbPath: resolve(dbPath!),
      workspaceDir: resolve(workspaceDir!),
    });
  });

  it("retains documented application-root storage defaults when paths are omitted", () => {
    const applicationRoot = resolve("C:/mcu-config-test/application");
    const config = loadConfig({ ...valid, MCU_DB_PATH: undefined, MCU_WORKSPACE_DIR: undefined }, applicationRoot);

    expect(config.dbPath).toBe(join(applicationRoot, "data", "mcu.db"));
    expect(config.workspaceDir).toBe(join(applicationRoot, "workspace"));
  });

  it("rejects an empty host instead of falling back silently", () => {
    expect(() => loadConfig({ ...valid, MCU_HOST: "  " })).toThrow(/MCU_HOST/i);
  });

  it("requires explicit credentials before enabling public mode", () => {
    expect(() => loadConfig({ ...valid, MCU_PUBLIC_MODE: "1" })).toThrow(/MCU_PUBLIC_MODE|MCU_BASIC_AUTH/i);
    expect(() => loadConfig({ ...valid, MCU_PUBLIC_MODE: "maybe" })).toThrow(/MCU_PUBLIC_MODE/i);
    expect(() => loadConfig({ ...valid, MCU_PUBLIC_MODE: "1", MCU_BASIC_AUTH_USER: "pilot" })).toThrow(/provided together/i);
  });

  it("accepts a protected public bind address and never accepts it unprotected", () => {
    expect(() => loadConfig({ ...valid, MCU_HOST: "0.0.0.0" })).toThrow(/MCU_HOST/i);
    const config = loadConfig({
      ...valid,
      MCU_HOST: "0.0.0.0",
      MCU_PUBLIC_MODE: "true",
      MCU_BASIC_AUTH_USER: "pilot",
      MCU_BASIC_AUTH_PASSWORD: "a-secure-internal-test-password",
    });
    expect(config.publicMode).toBe(true);
    expect(config.basicAuth).toEqual({ username: "pilot", password: "a-secure-internal-test-password" });
  });

  it("rejects weak or malformed Basic Auth credentials", () => {
    expect(() => loadConfig({ ...valid, MCU_BASIC_AUTH_USER: "pilot" })).toThrow(/provided together/i);
    expect(() => loadConfig({
      ...valid,
      MCU_BASIC_AUTH_USER: "pilot",
      MCU_BASIC_AUTH_PASSWORD: "short",
    })).toThrow(/16 characters/i);
    expect(() => loadConfig({
      ...valid,
      MCU_BASIC_AUTH_USER: "pilot:name",
      MCU_BASIC_AUTH_PASSWORD: "a-secure-internal-test-password",
    })).toThrow(/username/i);
  });

  it("requires an explicit supported device provider and never falls back from physical", () => {
    expect(() => loadConfig({ ...valid, MCU_DEVICE_PROVIDER: undefined })).toThrow(/MCU_DEVICE_PROVIDER/i);
    expect(() => loadConfig({ ...valid, MCU_DEVICE_PROVIDER: "unknown" })).toThrow(/MCU_DEVICE_PROVIDER/i);
    expect(loadConfig({ ...valid, MCU_DEVICE_PROVIDER: "physical" }).deviceProvider).toBe("physical");
  });

  it("keeps the database and workspace roots separate", () => {
    expect(() =>
      loadConfig({
        ...valid,
        MCU_DB_PATH: resolve("C:/mcu-config-test/workspace/test-config/mcu.db"),
        MCU_WORKSPACE_DIR: resolve("C:/mcu-config-test/workspace/test-config"),
      }),
    ).toThrow(/MCU_DB_PATH|workspace/i);
  });

  it("requires tests and production to provide distinct explicit database paths", () => {
    const production = loadConfig({ ...valid, MCU_DB_PATH: resolve("C:/mcu-config-test/data/mcu.db") });
    const test = loadConfig({ ...valid, MCU_DB_PATH: resolve("C:/mcu-config-test/data/test-config.db") });

    expect(production.dbPath).not.toBe(test.dbPath);
    expect(production.dbPath).toBe(resolve("C:/mcu-config-test/data/mcu.db"));
    expect(test.dbPath).toBe(resolve("C:/mcu-config-test/data/test-config.db"));
  });

  it("keeps environment files ignored while retaining the checked-in example", () => {
    const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
  });
});
