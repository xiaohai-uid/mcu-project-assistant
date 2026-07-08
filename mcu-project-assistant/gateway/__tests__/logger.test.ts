/**
 * Tests for structured logger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("logger", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("logs error messages to console.error", async () => {
    const { logger } = await import("@/lib/logger");
    logger.error("Something failed", { userId: "user-1", stage: "schematic" });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[ERROR] mcu-gateway: Something failed")
    );
  });

  it("logs warn messages to console.warn", async () => {
    const { logger } = await import("@/lib/logger");
    logger.warn("Deprecated feature used", { feature: "old-api" });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[WARN] mcu-gateway: Deprecated feature used")
    );
  });

  it("logs info messages to console.log", async () => {
    const { logger } = await import("@/lib/logger");
    logger.info("Service started", { port: 3000 });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] mcu-gateway: Service started")
    );
  });

  it("includes timestamp and service name", async () => {
    const { logger } = await import("@/lib/logger");
    logger.info("Test message");

    const output = consoleLogSpy.mock.calls[0][0];
    expect(output).toContain("mcu-gateway");
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});