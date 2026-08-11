// unit/domain/knowledge/classification — V2 搬运测试 1:1（shared/tests/test_classification.py；ISSUE-005 §11）
import { describe, expect, it } from "vitest";
import { CATEGORY_MAP, mapFunctionalityToCategory } from "@/src/domain/knowledge/classification";

describe("CategoryMap（V2 test_classification 搬运）", () => {
  it("contains expected keys", () => {
    expect("temperature" in CATEGORY_MAP).toBe(true);
    expect("humidity" in CATEGORY_MAP).toBe(true);
    expect("light" in CATEGORY_MAP).toBe(true);
  });

  it("maps to correct categories", () => {
    expect(CATEGORY_MAP["temperature"]).toBe("sensor");
    expect(CATEGORY_MAP["servo"]).toBe("actuator");
    expect(CATEGORY_MAP["i2c"]).toBe("communication");
  });
});

describe("mapFunctionalityToCategory（V2 搬运）", () => {
  it("returns category for known functionality", () => {
    expect(mapFunctionalityToCategory("temperature")).toBe("sensor");
  });

  it("returns other for unknown functionality", () => {
    expect(mapFunctionalityToCategory("unknown_thing")).toBe("other");
  });

  it("returns category for case insensitive", () => {
    expect(mapFunctionalityToCategory("Temperature")).toBe("sensor");
  });
});
