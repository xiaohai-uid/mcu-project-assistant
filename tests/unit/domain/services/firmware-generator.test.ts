// unit/domain/services/firmware-generator — 固件生成器（V2 generator.py REWRITE→TS；ISSUE-008 §11）
// 确定性模板 + 引脚注入；strapping 引脚 → 重映射提案（IO12→IO21）；禁直接写版本（门禁由 Proposal 承担）。
import { describe, expect, it } from "vitest";
import { generateFirmware, STRAPPING_PINS } from "@/src/domain/services/firmware-generator";

const PIN_MAP_IO12 = [
  { component: "Capacitive Soil Sensor", pinId: "IO4", type: "Analog" },
  { component: "5V Pump Relay Driver", pinId: "IO12", type: "Digital" },
  { component: "OLED Display (SDA)", pinId: "IO8", type: "I2C" },
  { component: "OLED Display (SCL)", pinId: "IO9", type: "I2C" },
];

const PIN_MAP_IO21 = PIN_MAP_IO12.map((p) =>
  p.component.includes("Pump") ? { ...p, pinId: "IO21" } : p,
);

describe("firmware-generator（确定性模板 + 引脚注入）", () => {
  it("输出形状：files（src/main.cpp + platformio.ini）+ 引脚元数据", () => {
    const g = generateFirmware({ pinMap: PIN_MAP_IO12, platform: { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" } });
    expect(g.files["src/main.cpp"]).toContain("#include <Adafruit_SSD1306.h>");
    expect(g.files["src/main.cpp"]).toContain("#define SOIL_SENSOR_PIN  4");
    expect(g.files["src/main.cpp"]).toContain("#define OLED_SDA_PIN     8");
    expect(g.files["src/main.cpp"]).toContain("#define OLED_SCL_PIN     9");
    expect(g.files["src/main.cpp"]).toContain("void loop()");
    expect(g.files["platformio.ini"]).toContain("[env:esp32s3]");
    expect(g.files["platformio.ini"]).toContain("Adafruit SSD1306");
    expect(g.relayPin).toBe("IO12");
  });

  it("继电器在 strapping 引脚（IO12）→ 提出重映射 IO21 + boot 风险（bootRisk）", () => {
    const g = generateFirmware({ pinMap: PIN_MAP_IO12, platform: { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" } });
    expect(g.bootRisk).toBe(true);
    expect(g.proposedRelayPin).toBe("IO21");
    // 提案代码注入的是重映射后的引脚（IO21；冻结 UI 参考：PUMP_RELAY_PIN + 3 空格 + 引脚号）
    expect(g.files["src/main.cpp"]).toContain("#define PUMP_RELAY_PIN   21");
  });

  it("继电器不在 strapping 引脚（IO21）→ 无重映射、无风险", () => {
    const g = generateFirmware({ pinMap: PIN_MAP_IO21, platform: { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" } });
    expect(g.bootRisk).toBe(false);
    expect(g.proposedRelayPin).toBeNull();
    expect(g.files["src/main.cpp"]).toContain("#define PUMP_RELAY_PIN   21");
  });

  it("确定性：同输入同输出（可重放）", () => {
    const a = generateFirmware({ pinMap: PIN_MAP_IO12, platform: { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" } });
    const b = generateFirmware({ pinMap: PIN_MAP_IO12, platform: { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" } });
    expect(a.files).toEqual(b.files);
  });

  it("STRAPPING_PINS 常量：ESP32-S3 系已知启动引脚（IO0/IO12/IO45/IO46）", () => {
    expect(STRAPPING_PINS).toContain("IO12");
    expect(STRAPPING_PINS).toContain("IO0");
  });
});
