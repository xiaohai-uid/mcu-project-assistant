// unit/domain/knowledge/compatibility — V2 搬运测试 1:1（shared/tests/test_compatibility.py；ISSUE-005 §11）
import { describe, expect, it } from "vitest";
import { checkCompatibility, allocateTiers, detectConflicts } from "@/src/domain/knowledge/compatibility";

interface CompLike {
  name: string;
  price?: number;
  voltage?: number;
  compatible_platforms?: string;
}

describe("checkCompatibility（V2 搬运）", () => {
  it("compatible when platform in list", () => {
    const comp = { name: "DHT11", compatible_platforms: "arduino,esp32" };
    const result = checkCompatibility(comp, "arduino");
    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("not compatible when platform not in list", () => {
    const comp = { name: "DHT11", compatible_platforms: "arduino,esp32" };
    const result = checkCompatibility(comp, "stm32");
    expect(result.compatible).toBe(false);
    expect(result.reasons).toHaveLength(1);
  });

  it("case insensitive", () => {
    const comp = { name: "DHT11", compatible_platforms: "Arduino,ESP32" };
    expect(checkCompatibility(comp, "ARDUINO").compatible).toBe(true);
  });

  it("empty compatible platforms", () => {
    const comp = { name: "DHT11", compatible_platforms: "" };
    expect(checkCompatibility(comp, "arduino").compatible).toBe(false);
  });
});

describe("allocateTiers（V2 搬运）", () => {
  it("tiers by price", () => {
    const comps: CompLike[] = [
      { name: "LED", price: 1.0 },
      { name: "Sensor", price: 10.0 },
      { name: "Board", price: 25.0 },
    ];
    const result = allocateTiers(comps);
    expect(result.budget).toHaveLength(1);
    expect(result.standard).toHaveLength(1);
    expect(result.premium).toHaveLength(1);
  });

  it("allocates to budget when under 3", () => {
    const result = allocateTiers([{ name: "Resistor", price: 0.5 }]);
    expect(result.budget[0]?.name).toBe("Resistor");
  });

  it("allocates to standard when 3 to 15", () => {
    const result = allocateTiers([{ name: "Sensor", price: 7.0 }]);
    expect(result.standard[0]?.name).toBe("Sensor");
  });

  it("allocates to premium when 15 or more", () => {
    const result = allocateTiers([{ name: "Board", price: 20.0 }]);
    expect(result.premium[0]?.name).toBe("Board");
  });

  it("empty input", () => {
    expect(allocateTiers([])).toEqual({ budget: [], standard: [], premium: [] });
  });

  it("backward compatibility no platform", () => {
    const result = allocateTiers([{ name: "LED", price: 1.0 }]);
    expect("budget" in result).toBe(true);
  });

  it("filters incompatible when platform provided", () => {
    const comps: CompLike[] = [
      { name: "Arduino LED", price: 1.0, compatible_platforms: "arduino" },
      { name: "STM32 Board", price: 20.0, compatible_platforms: "stm32" },
    ];
    const result = allocateTiers(comps, "arduino");
    expect(result.budget).toHaveLength(1);
    expect(result.budget[0]?.name).toBe("Arduino LED");
    expect(result.premium).toHaveLength(0);
  });
});

describe("detectConflicts（V2 搬运）", () => {
  it("no conflicts when same voltage", () => {
    const comps = [
      { name: "A", voltage: 3.3 },
      { name: "B", voltage: 3.3 },
    ];
    expect(detectConflicts(comps)).toEqual([]);
  });

  it("detects voltage mismatch", () => {
    const comps = [
      { name: "A", voltage: 3.3 },
      { name: "B", voltage: 5.0 },
    ];
    const result = detectConflicts(comps);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("voltage_mismatch");
    expect(result[0]?.severity).toBe("warning");
  });

  it("ignores missing voltage", () => {
    const comps = [
      { name: "A", voltage: 3.3 },
      { name: "B", price: 10 },
    ];
    expect(detectConflicts(comps)).toEqual([]);
  });

  it("multiple pairs", () => {
    const comps = [
      { name: "A", voltage: 3.3 },
      { name: "B", voltage: 5.0 },
      { name: "C", voltage: 3.3 },
      { name: "D", voltage: 5.0 },
    ];
    expect(detectConflicts(comps)).toHaveLength(4);
  });

  it("single component no conflicts", () => {
    expect(detectConflicts([{ name: "A", voltage: 3.3 }])).toEqual([]);
  });
});
