// unit/domain/knowledge/pins — V2 搬运测试 1:1（shared/tests/test_pins.py；ISSUE-006 §11）
import { describe, expect, it } from "vitest";
import {
  assignPins,
  COMPONENT_LIBRARIES,
  PIN_TYPE_MAP,
  PLATFORM_PINS,
  resolveDependencies,
} from "@/src/domain/knowledge/pins";

describe("TestPlatformPins（V2 搬运）", () => {
  it("has arduino", () => {
    expect("arduino" in PLATFORM_PINS).toBe(true);
  });

  it("arduino has digital and analog", () => {
    expect("digital" in PLATFORM_PINS["arduino"]!).toBe(true);
    expect("analog" in PLATFORM_PINS["arduino"]!).toBe(true);
  });
});

describe("TestPinTypeMap（V2 搬运）", () => {
  it("sensor maps to analog", () => {
    expect(PIN_TYPE_MAP["sensor"]).toBe("analog");
  });

  it("actuator maps to digital", () => {
    expect(PIN_TYPE_MAP["actuator"]).toBe("digital");
  });

  it("display maps to i2c", () => {
    expect(PIN_TYPE_MAP["display"]).toBe("i2c");
  });
});

describe("TestComponentLibraries（V2 搬运）", () => {
  it("dht11 has library", () => {
    expect(COMPONENT_LIBRARIES["DHT11"]).toContain("DHT sensor library");
  });

  it("hc_sr04 has newping library", () => {
    expect(COMPONENT_LIBRARIES["HC-SR04"]).toEqual(["NewPing"]);
  });
});

describe("TestAssignPins（V2 搬运）", () => {
  it("assigns pin to sensor component", () => {
    const result = assignPins([{ name: "DHT11", category: "sensor" }], "arduino");
    expect(result).toHaveLength(1);
    expect(result[0]?.componentName).toBe("DHT11");
    expect(result[0]?.connectionType).toBe("digital");
    expect(result[0]?.microcontrollerPin).not.toBe("N/A");
  });

  it("falls back to arduino for unknown platform", () => {
    const result = assignPins([{ name: "LED", category: "actuator" }], "unknown_platform");
    expect(result).toHaveLength(1);
    expect(result[0]?.microcontrollerPin).not.toBe("N/A");
  });

  it("avoids duplicate pins", () => {
    const result = assignPins(
      [
        { name: "Sensor1", category: "sensor" },
        { name: "Sensor2", category: "sensor" },
      ],
      "arduino",
    );
    const pins = result.map((r) => r.microcontrollerPin);
    expect(new Set(pins).size).toBe(2);
  });

  it("none assigned for empty input", () => {
    expect(assignPins([], "arduino")).toEqual([]);
  });

  it("unknown category skipped", () => {
    const result = assignPins([{ name: "Generic", category: "unknown", interface: "digital" }], "arduino");
    expect(result).toHaveLength(0);
  });
});

describe("TestResolveDependencies（V2 搬运）", () => {
  it("known component returns libraries", () => {
    const deps = resolveDependencies([{ name: "DHT11" }]);
    expect(deps).toContain("DHT sensor library");
  });

  it("unknown component returns empty", () => {
    expect(resolveDependencies([{ name: "NonexistentSensor" }])).toEqual([]);
  });

  it("matches by substring", () => {
    const deps = resolveDependencies([{ name: "LCD1602 I2C" }]);
    expect(deps).toContain("LiquidCrystal_I2C");
  });

  it("deduplicates", () => {
    const deps = resolveDependencies([{ name: "DHT11" }, { name: "DHT22" }]);
    expect(deps).toEqual(["DHT sensor library"]);
  });

  it("empty input", () => {
    expect(resolveDependencies([])).toEqual([]);
  });
});
