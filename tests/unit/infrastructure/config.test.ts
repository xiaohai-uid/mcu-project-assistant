import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "@/src/infrastructure/config";

describe("production runtime configuration", () => {
  const valid = {
    MCU_HOST: "127.0.0.1",
    MCU_PORT: "3100",
    MCU_DB_PATH: "./data/test-config.db",
    MCU_WORKSPACE_DIR: "./workspace/test-config",
    MCU_DEVICE_PROVIDER: "companion",
  };

  it("accepts an explicit local companion configuration and resolves paths", () => {
    const config = loadConfig(valid);

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3100,
      dbPath: resolve(process.cwd(), "data/test-config.db"),
      workspaceDir: resolve(process.cwd(), "workspace/test-config"),
      deviceProvider: "companion",
    });
  });

  it.each(["0", "65536", "3000.5", "not-a-port"])('rejects malformed port "%s"', (port) => {
    expect(() => loadConfig({ ...valid, MCU_PORT: port })).toThrow(/MCU_PORT/i);
  });

  it("rejects an empty host instead of falling back silently", () => {
    expect(() => loadConfig({ ...valid, MCU_HOST: "  " })).toThrow(/MCU_HOST/i);
  });

  it("requires an explicit supported device provider and never falls back from physical", () => {
    expect(() => loadConfig({ ...valid, MCU_DEVICE_PROVIDER: undefined })).toThrow(/MCU_DEVICE_PROVIDER/i);
    expect(() => loadConfig({ ...valid, MCU_DEVICE_PROVIDER: "unknown" })).toThrow(/MCU_DEVICE_PROVIDER/i);
    expect(() => loadConfig({ ...valid, MCU_DEVICE_PROVIDER: "physical" })).toThrow(/unavailable|physical/i);
  });

  it("keeps the database and workspace roots separate", () => {
    expect(() =>
      loadConfig({
        ...valid,
        MCU_DB_PATH: "./workspace/test-config/mcu.db",
        MCU_WORKSPACE_DIR: "./workspace/test-config",
      }),
    ).toThrow(/MCU_DB_PATH|workspace/i);
  });

  it("requires tests and production to provide distinct explicit database paths", () => {
    const production = loadConfig({ ...valid, MCU_DB_PATH: "./data/mcu.db" });
    const test = loadConfig({ ...valid, MCU_DB_PATH: "./data/test-config.db" });

    expect(production.dbPath).not.toBe(test.dbPath);
    expect(production.dbPath).toBe(resolve(process.cwd(), "data/mcu.db"));
    expect(test.dbPath).toBe(resolve(process.cwd(), "data/test-config.db"));
  });

  it("keeps environment files ignored while retaining the checked-in example", () => {
    const gitignore = readFileSync(resolve(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain("!.env.example");
  });
});
