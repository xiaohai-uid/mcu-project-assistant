// unit/domain/knowledge/components — V2 搬运测试 1:1（worker/tests/unit/components/test_registry.py 关键子集；ISSUE-005 §11）
// Golden Journey 组件目录（soil moisture / relay / oled）为核心子集；Registry 机制 1:1 保真。
import { describe, expect, it } from "vitest";
import { createComponentRegistry } from "@/src/domain/knowledge/components";

const registry = createComponentRegistry();

describe("ComponentRegistry（V2 test_registry 搬运子集）", () => {
  it("loads golden-journey components", () => {
    expect(registry.count).toBeGreaterThanOrEqual(3);
    expect(registry.allIds).toContain("sensor.soil_moisture");
    expect(registry.allIds).toContain("actuator.relay");
    expect(registry.allIds).toContain("display.oled_096");
  });

  it("all ids accessible", () => {
    for (const cid of registry.allIds) {
      expect(registry.get(cid).id).toBe(cid);
    }
  });

  it("get nonexistent raises", () => {
    expect(() => registry.get("sensor.nonexistent")).toThrow();
  });

  it("get_or_none", () => {
    expect(registry.getOrNone("sensor.soil_moisture")).not.toBeNull();
    expect(registry.getOrNone("sensor.nonexistent")).toBeNull();
  });

  it("is_supported platform compatibility", () => {
    const soil = registry.get("sensor.soil_moisture");
    expect(soil.platformCompatibility["arduino_uno"]).toBe("supported");
  });
});

describe("FindByAlias（V2 搬运）", () => {
  it("english alias", () => {
    const comp = registry.findByAlias("Soil Moisture Sensor");
    expect(comp?.id).toBe("sensor.soil_moisture");
  });

  it("oled alias SSD1306", () => {
    const comp = registry.findByAlias("SSD1306");
    expect(comp?.id).toBe("display.oled_096");
  });

  it("case insensitive", () => {
    expect(registry.findByAlias("relay module")?.id).toBe("actuator.relay");
  });

  it("unknown alias returns null", () => {
    expect(registry.findByAlias("totally_unknown_xyz")).toBeNull();
  });
});

describe("FindByCapability（V2 搬运）", () => {
  it("soil_moisture_sensing", () => {
    const ids = registry.findByCapability("soil_moisture_sensing").map((c) => c.id);
    expect(ids).toContain("sensor.soil_moisture");
  });

  it("high_power_switching", () => {
    const ids = registry.findByCapability("high_power_switching").map((c) => c.id);
    expect(ids).toContain("actuator.relay");
  });

  it("graphical_display", () => {
    const ids = registry.findByCapability("graphical_display").map((c) => c.id);
    expect(ids).toContain("display.oled_096");
  });
});

describe("电气/接口事实（V2 catalog 保真）", () => {
  it("soil moisture：analog 接口 + 5V logic", () => {
    const soil = registry.get("sensor.soil_moisture");
    expect(soil.interfaces[0]?.type).toBe("analog");
    expect(soil.electrical.logicVoltage).toBe(5.0);
  });

  it("relay：digital 输出 + 70mA", () => {
    const relay = registry.get("actuator.relay");
    expect(relay.interfaces[0]?.type).toBe("digital");
    expect(relay.interfaces[0]?.ioDirection).toBe("output");
    expect(relay.electrical.typicalCurrentMa).toBe(70.0);
  });

  it("oled：i2c 2 信号", () => {
    const oled = registry.get("display.oled_096");
    expect(oled.interfaces[0]?.type).toBe("i2c");
    expect(oled.interfaces[0]?.signalCount).toBe(2);
  });
});

describe("ComponentIdentity（02：精确对象层级与来源状态）", () => {
  it("BMP280 是有官方来源的芯片级精确身份", () => {
    const bmp280 = registry.get("sensor.bmp280");

    expect(bmp280.identity).toMatchObject({
      status: "exact",
      sourceStatus: "verified",
      objectLevel: "chip",
      manufacturer: "Bosch Sensortec",
      partNumber: "BMP280",
    });
    expect(bmp280.identity.sources.find((source) => source.url.endsWith("bst-bmp280-ds001.pdf"))).toMatchObject({
      owner: "Bosch Sensortec",
      url: "https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf",
      confidence: "official-direct",
    });
    expect(bmp280.identity.pendingReason).toBeUndefined();
  });

  it("泛化土壤模块保持未决，不静默补齐制造商或料号", () => {
    const soil = registry.get("sensor.soil_moisture");

    expect(soil.identity).toMatchObject({
      status: "unresolved",
      sourceStatus: "pending",
      objectLevel: "module",
    });
    expect(soil.identity.manufacturer).toBeUndefined();
    expect(soil.identity.partNumber).toBeUndefined();
    expect(soil.identity.pendingReason).toMatch(/料号|datasheet|module/i);
    expect(soil.identity.sources[0]?.owner).toBe("ASAIR/Aosong");
  });

  it("SSD1306 控制器来源不升级为 0.96 寸模块身份", () => {
    const oled = registry.get("display.oled_096");

    expect(oled.identity.status).toBe("family");
    expect(oled.identity.sourceStatus).toBe("candidate");
    expect(oled.identity.objectLevel).toBe("module");
    expect(oled.identity.partNumber).toBeUndefined();
    expect(oled.identity.pendingReason).toMatch(/模块|module|address|电平/i);
    expect(oled.identity.sources[0]?.owner).toBe("Solomon Systech");
  });
});
