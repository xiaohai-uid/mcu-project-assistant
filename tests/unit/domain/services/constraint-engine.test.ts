// unit/domain/services/constraint-engine — V2 搬运测试 1:1（worker/tests/unit/constraints/test_engine.py；ISSUE-006 §11）
// 移植验收门：ConstraintEngine TS 移植后这些用例必须全绿。
import { describe, expect, it } from "vitest";
import { ConstraintEngine } from "@/src/domain/services/constraint-engine";
import { createComponentRegistry } from "@/src/domain/knowledge/components";
import { createPlatformRegistry } from "@/src/domain/knowledge/platforms";

const compRegistry = createComponentRegistry();
const platformRegistry = createPlatformRegistry();
const uno = platformRegistry.get("arduino_uno");

describe("TestVoltageCompatibility（V2 搬运）", () => {
  it("5v components pass", () => {
    const components = [
      ["temp_1", compRegistry.get("sensor.dht22")],
      ["display_1", compRegistry.get("display.lcd1602")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(true);
  });

  it("3v3 bus device gets warning not error", () => {
    // BMP280 (I2C-only) max supply 3.6V < 5V -> WARNING (use 3V3 pin), still feasible
    const components = [["pressure_1", compRegistry.get("sensor.bmp280")]] as Array<
      [string, ReturnType<typeof compRegistry.get>]
    >;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(true);
    const voltageWarnings = result.warnings.filter((d) => d.code === "VOLTAGE_INCOMPATIBLE");
    expect(voltageWarnings).toHaveLength(1);
    expect(voltageWarnings[0]?.message).toContain("3V3 pin");
  });
});

describe("TestPinBudget（V2 搬运）", () => {
  it("within budget", () => {
    const components = [
      ["soil_1", compRegistry.get("sensor.soil_moisture")],
      ["light_1", compRegistry.get("sensor.photoresistor")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(true);
    expect(result.pinAllocation).not.toBeNull();
  });

  it("analog overflow", () => {
    // 7 analog sensors exceed 4 available analog pins (A0-A3, A4/A5 reserved)
    const components = Array.from({ length: 7 }, (_, i) => [
      `sensor_${i}`,
      compRegistry.get("sensor.soil_moisture"),
    ]) as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(false);
    expect(result.errors.some((d) => d.code === "ANALOG_PIN_OVERFLOW")).toBe(true);
  });

  it("pwm shortage", () => {
    // 7 PWM devices exceed 6 available PWM pins
    const components = Array.from({ length: 7 }, (_, i) => [
      `servo_${i}`,
      compRegistry.get("actuator.sg90"),
    ]) as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(false);
    expect(result.errors.some((d) => d.code === "PWM_PIN_SHORTAGE")).toBe(true);
  });
});

describe("TestBusConflicts（V2 搬运）", () => {
  it("i2c shared ok", () => {
    const components = [
      ["lcd_1", compRegistry.get("display.lcd1602")],
      ["oled_1", compRegistry.get("display.oled_096")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(true);
    expect(result.pinAllocation).not.toBeNull();
    const i2cBuses = result.pinAllocation!.sharedBuses.filter((b) => b.type === "i2c");
    expect(i2cBuses).toHaveLength(1);
    expect(i2cBuses[0]!.participants).toHaveLength(2);
  });

  it("uart conflict", () => {
    const components = [
      ["bt_1", compRegistry.get("comm.hc_05")],
      ["bt_2", compRegistry.get("comm.hc_05")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(uno, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(false);
    expect(result.errors.some((d) => d.code === "UART_CONFLICT")).toBe(true);
  });
});

describe("TestPinAllocation（V2 搬运）", () => {
  it("deterministic", () => {
    const components = [
      ["temp_1", compRegistry.get("sensor.dht22")],
      ["soil_1", compRegistry.get("sensor.soil_moisture")],
      ["servo_1", compRegistry.get("actuator.sg90")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const r1 = new ConstraintEngine(uno, components).validate();
    const r2 = new ConstraintEngine(uno, components).validate();
    expect(JSON.stringify(r1.pinAllocation)).toBe(JSON.stringify(r2.pinAllocation));
  });

  it("analog gets A pins", () => {
    const components = [["soil_1", compRegistry.get("sensor.soil_moisture")]] as Array<
      [string, ReturnType<typeof compRegistry.get>]
    >;
    const result = new ConstraintEngine(uno, components).validate();
    const analogAssignments = result.pinAllocation!.assignments.filter((a) => a.interface === "analog");
    expect(analogAssignments[0]!.physicalPin.startsWith("A")).toBe(true);
  });

  it("pwm gets pwm pins", () => {
    const components = [["servo_1", compRegistry.get("actuator.sg90")]] as Array<
      [string, ReturnType<typeof compRegistry.get>]
    >;
    const result = new ConstraintEngine(uno, components).validate();
    const pwmAssignments = result.pinAllocation!.assignments.filter((a) => a.interface === "pwm");
    const validPwm = new Set(["D3", "D5", "D6", "D9", "D10", "D11"]);
    expect(validPwm.has(pwmAssignments[0]!.physicalPin)).toBe(true);
  });

  it("infeasible design no allocation", () => {
    const components = Array.from({ length: 7 }, (_, i) => [
      `sensor_${i}`,
      compRegistry.get("sensor.soil_moisture"),
    ]) as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const result = new ConstraintEngine(uno, components).validate();
    expect(result.pinAllocation).toBeNull();
  });
});

describe("Golden Journey：ESP32-S3 strapping 冲突（ISSUE-006 §1/§6 扩展）", () => {
  it("继电器落到 IO12 → STRAPPING_PIN_USAGE warning（冲突卡数据源）", () => {
    const s3 = platformRegistry.get("ESP32-S3");
    const components = [
      ["soil_1", compRegistry.get("sensor.soil_moisture")],
      ["relay_1", compRegistry.get("actuator.relay")],
      ["oled_1", compRegistry.get("display.oled_096")],
    ] as Array<[string, ReturnType<typeof compRegistry.get>]>;
    const engine = new ConstraintEngine(s3, components);
    const result = engine.validate();
    expect(result.isFeasible).toBe(true);
    const strapping = result.warnings.filter((d) => d.code === "STRAPPING_PIN_USAGE");
    expect(strapping.length).toBeGreaterThan(0);
    // IO12 冲突卡字段（pin + reason）
    const io12 = strapping.find((d) => d.details.pin === "IO12");
    expect(io12).toBeDefined();
    expect(String(io12!.details.reason)).toMatch(/flash/i);
  });
});
