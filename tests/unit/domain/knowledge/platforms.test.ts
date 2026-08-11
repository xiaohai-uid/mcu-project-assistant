// unit/domain/knowledge/platforms — V2 搬运测试 1:1（worker/tests/unit/platforms/test_platform.py）+ ESP32-S3 strapping
import { describe, expect, it } from "vitest";
import { availableDigital, createPlatformRegistry, reservedPinSet } from "@/src/domain/knowledge/platforms";

const registry = createPlatformRegistry();

describe("PlatformRegistry（V2 test_platform 搬运）", () => {
  it("loads arduino_uno（V2 目录数据保真）", () => {
    expect(registry.count).toBeGreaterThanOrEqual(1);
    expect(registry.allIds).toContain("arduino_uno");
  });

  it("get nonexistent raises", () => {
    expect(() => registry.get("esp32")).toThrow(/esp32/);
  });

  it("is_supported", () => {
    expect(registry.isSupported("arduino_uno")).toBe(true);
    expect(registry.isSupported("esp32")).toBe(false);
  });
});

describe("ArduinoUnoDefinition（V2 搬运）", () => {
  const uno = registry.get("arduino_uno");

  it("basic facts", () => {
    expect(uno.id).toBe("arduino_uno");
    expect(uno.family).toBe("avr");
    expect(uno.framework).toBe("arduino");
    expect(uno.logicVoltage).toBe(5.0);
  });

  it("pin pools", () => {
    expect(uno.pins.digital).toHaveLength(14);
    expect(uno.pins.analog).toHaveLength(6);
    expect(uno.pins.pwm).toHaveLength(6);
  });

  it("buses", () => {
    expect(uno.buses["i2c"]?.pins.sda).toBe("A4");
    expect(uno.buses["i2c"]?.pins.scl).toBe("A5");
    expect(uno.buses["i2c"]?.shared).toBe(true);
  });

  it("reserved pins", () => {
    const reserved = reservedPinSet(uno);
    expect(reserved.has("D0")).toBe(true);
    expect(reserved.has("D1")).toBe(true);
    expect(reserved.has("A4")).toBe(true);
    expect(reserved.has("A5")).toBe(true);
  });

  it("available digital excludes reserved", () => {
    const available = availableDigital(uno);
    expect(available).not.toContain("D0");
    expect(available).toContain("D2");
  });

  it("toolchain FQBN", () => {
    expect(uno.toolchain.fqbn).toBe("arduino:avr:uno");
  });
});

describe("ESP32-S3（Golden Journey 目标；strapping 数据完整性）", () => {
  const s3 = registry.get("ESP32-S3");

  it("golden journey 平台存在且为推荐目标", () => {
    expect(s3.id).toBe("ESP32-S3");
    expect(s3.framework).toBe("arduino");
    expect(s3.logicVoltage).toBe(3.3);
  });

  it("strapping 数据：IO0/IO45/IO46/IO12 完整且标注风险", () => {
    const strapping = s3.strappingPins ?? [];
    const ids = strapping.map((s) => s.pin);
    expect(ids).toContain("IO0");
    expect(ids).toContain("IO45");
    expect(ids).toContain("IO46");
    expect(ids).toContain("IO12");
    // IO12 = flash 电压配置（golden journey 冲突触发点）
    const io12 = strapping.find((s) => s.pin === "IO12");
    expect(io12?.reason).toMatch(/flash/i);
  });

  it("候选矩阵：推荐/备选/工业级三类齐全（冻结 UI MCU_CANDIDATES）", () => {
    expect(registry.allIds).toContain("RP2040");
    expect(registry.allIds).toContain("STM32F401RE");
    const rp2040 = registry.get("RP2040");
    const stm32 = registry.get("STM32F401RE");
    expect(rp2040.family).toBe("rp2040");
    expect(stm32.family).toBe("stm32f4");
  });
});
