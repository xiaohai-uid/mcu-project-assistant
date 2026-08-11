// domain/knowledge/pins.ts — V2 shared/domain/pins.py TS 移植（ISSUE-006 §3/§11）
// Arduino UNO 引脚分配与组件库解析（legacy 兼容路径）；测试 1:1 搬运（tests/unit/domain/knowledge/pins.test.ts）。

export const PLATFORM_PINS: Record<string, { digital: number[]; analog: string[]; pwm: number[]; i2c: string[]; spi: number[]; uart: number[] }> = {
  arduino: {
    digital: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    analog: ["A0", "A1", "A2", "A3", "A4", "A5"],
    pwm: [3, 5, 6, 9, 10, 11],
    i2c: ["A4", "A5"],
    spi: [10, 11, 12, 13],
    uart: [0, 1],
  },
};

export const PIN_TYPE_MAP: Record<string, string> = {
  sensor: "analog",
  actuator: "digital",
  display: "i2c",
  communication: "uart",
};

export const COMPONENT_LIBRARIES: Record<string, string[]> = {
  DHT11: ["DHT sensor library"],
  DHT22: ["DHT sensor library"],
  "HC-SR04": ["NewPing"],
  LCD1602: ["LiquidCrystal_I2C"],
  "OLED 0.96寸": ["Adafruit_SSD1306", "Adafruit_GFX"],
  "HC-05 蓝牙模块": ["SoftwareSerial"],
  "RC522 RFID": ["MFRC522"],
  BMP280: ["Adafruit_BMP280"],
  "SG90 舵机": ["Servo"],
  土壤湿度传感器: [],
  光敏电阻模块: [],
  声音传感器: [],
  水位传感器: [],
  "MQ-135": [],
  继电器模块: [],
  小型水泵: [],
  蜂鸣器: [],
  "LED 灯带": ["Adafruit_NeoPixel"],
  "L298N 电机驱动": [],
  红外循迹传感器: [],
  "矩阵键盘 4x4": ["Keypad"],
};

// 组件名 → 接口信息（V2 COMPONENT_INTERFACE；未列出的按 category 猜测）
const COMPONENT_INTERFACE: Record<string, { interface: string; pins_needed: number; type: string }> = {
  DHT11: { interface: "digital", pins_needed: 1, type: "input" },
  DHT22: { interface: "digital", pins_needed: 1, type: "input" },
  "HC-SR04": { interface: "digital", pins_needed: 2, type: "input" },
  LCD1602: { interface: "i2c", pins_needed: 2, type: "output" },
  "OLED 0.96寸": { interface: "i2c", pins_needed: 2, type: "output" },
  "HC-05 蓝牙模块": { interface: "uart", pins_needed: 2, type: "bidirectional" },
  "RC522 RFID": { interface: "spi", pins_needed: 4, type: "input" },
  BMP280: { interface: "i2c", pins_needed: 2, type: "input" },
  "SG90 舵机": { interface: "pwm", pins_needed: 1, type: "output" },
  土壤湿度传感器: { interface: "analog", pins_needed: 1, type: "input" },
  光敏电阻模块: { interface: "analog", pins_needed: 1, type: "input" },
  声音传感器: { interface: "analog", pins_needed: 1, type: "input" },
  水位传感器: { interface: "analog", pins_needed: 1, type: "input" },
  "MQ-135": { interface: "analog", pins_needed: 1, type: "input" },
  继电器模块: { interface: "digital", pins_needed: 1, type: "output" },
  小型水泵: { interface: "digital", pins_needed: 1, type: "output" },
  蜂鸣器: { interface: "digital", pins_needed: 1, type: "output" },
  "LED 灯带": { interface: "digital", pins_needed: 1, type: "output" },
  "L298N 电机驱动": { interface: "digital", pins_needed: 3, type: "output" },
  红外循迹传感器: { interface: "digital", pins_needed: 1, type: "input" },
  "矩阵键盘 4x4": { interface: "digital", pins_needed: 8, type: "input" },
};

function sanitizePinName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export interface PinMappingResult {
  componentName: string;
  microcontrollerPin: string;
  connectionType: string;
  ioType: string;
  wireColor: string;
  pinVarName: string;
}

export function assignPins(components: Array<{ name?: string; category?: string; interface?: string }>, platform = "arduino"): PinMappingResult[] {
  const pool: Record<string, Array<string | number>> = JSON.parse(JSON.stringify(PLATFORM_PINS["arduino"] ?? PLATFORM_PINS[platform] ?? PLATFORM_PINS["arduino"]!));
  const usedPins = new Set<string>();
  const assigned: PinMappingResult[] = [];

  const WIRE_BY_TYPE: Record<string, string> = {
    analog: "Yellow",
    digital: "Green",
    i2c: "Blue",
    pwm: "Orange",
    uart: "White",
    spi: "Brown",
  };

  for (const comp of components) {
    const name = comp.name ?? "unknown";
    let info = COMPONENT_INTERFACE[name];

    if (!info) {
      const cat = comp.category ?? "sensor";
      if (cat === "sensor") info = { interface: "analog", pins_needed: 1, type: "input" };
      else if (cat === "actuator") info = { interface: "digital", pins_needed: 1, type: "output" };
      else if (cat === "display") info = { interface: "i2c", pins_needed: 2, type: "output" };
      else if (cat === "communication") info = { interface: "uart", pins_needed: 2, type: "bidirectional" };
      else continue;
    }

    const iface = info.interface;
    const ioType = info.type;

    if (iface === "i2c") {
      assigned.push({
        componentName: name,
        microcontrollerPin: "A4 (SDA) / A5 (SCL)",
        connectionType: "i2c",
        ioType,
        wireColor: "Blue (SDA) / Green (SCL)",
        pinVarName: `PIN_${sanitizePinName(name)}`,
      });
      continue;
    }
    if (iface === "spi") {
      assigned.push({
        componentName: name,
        microcontrollerPin: "D10 (SS) / D11 (MOSI) / D12 (MISO) / D13 (SCK)",
        connectionType: "spi",
        ioType,
        wireColor: "Brown (multi-wire)",
        pinVarName: `PIN_${sanitizePinName(name)}`,
      });
      continue;
    }
    if (iface === "uart") {
      assigned.push({
        componentName: name,
        microcontrollerPin: "D2 (RX) / D3 (TX)",
        connectionType: "uart",
        ioType,
        wireColor: "White (RX/TX)",
        pinVarName: `PIN_${sanitizePinName(name)}`,
      });
      usedPins.add("2");
      usedPins.add("3");
      continue;
    }

    const pinsNeeded = info.pins_needed;
    const poolKey = iface === "analog" ? "analog" : iface === "pwm" ? "pwm" : "digital";
    const avail = (pool[poolKey] ?? []).filter((p) => !usedPins.has(String(p)));

    const assignedPins: string[] = [];
    for (let i = 0; i < pinsNeeded; i++) {
      if (avail.length) {
        const p = avail.shift()!;
        usedPins.add(String(p));
        assignedPins.push(String(p));
      }
    }

    assigned.push({
      componentName: name,
      microcontrollerPin: assignedPins.length ? assignedPins.join(" / ") : "N/A",
      connectionType: iface,
      ioType,
      wireColor: WIRE_BY_TYPE[iface] ?? "Gray",
      pinVarName: `PIN_${sanitizePinName(name)}`,
    });
  }

  return assigned;
}

export function resolveDependencies(components: Array<{ name?: string }>): string[] {
  const deps = new Set<string>();
  for (const comp of components) {
    const name = comp.name ?? "";
    if (name in COMPONENT_LIBRARIES) {
      for (const d of COMPONENT_LIBRARIES[name]!) deps.add(d);
      continue;
    }
    // 子串匹配（legacy：LCD1602 I2C → LCD1602）
    for (const [key, libs] of Object.entries(COMPONENT_LIBRARIES)) {
      if (name.includes(key) || key.includes(name)) {
        for (const d of libs) deps.add(d);
      }
    }
  }
  return [...deps];
}
