// domain/knowledge/components.ts — 组件/外设目录（ISSUE-005 §3/§7；ADR-0013 TS 移植）
// V2 worker/.../components/registry.py + catalog/components/*.yaml 数据移植。
// Golden Journey 所需组件子集（soil moisture / relay / oled）1:1 保真；Registry 机制与 V2 等价。
// 禁止把 strapping/约束数据硬编码进 UI——UI 一律经 knowledge 读取。

export interface ComponentDefinition {
  id: string;
  schemaVersion: string;
  displayName: string;
  aliases: string[];
  categories: string[];
  capabilities: string[];
  electrical: {
    logicVoltage: number;
    supplyVoltageMin: number;
    supplyVoltageMax: number;
    typicalCurrentMa: number;
  };
  interfaces: Array<{ type: string; signalCount: number; ioDirection: string; requirements?: Record<string, unknown> }>;
  platformCompatibility: Record<string, string>;
  firmware: { libraries: string[]; includes: string[]; codegenAdapter: string; varName: string };
  purchasing: { searchTerms: string[] };
  safetyNotes: string[];
}

export interface ComponentRegistry {
  count: number;
  allIds: string[];
  get(id: string): ComponentDefinition;
  getOrNone(id: string): ComponentDefinition | null;
  findByAlias(alias: string): ComponentDefinition | null;
  findByName(name: string): ComponentDefinition | null;
  findByCapability(capability: string, platformId?: string): ComponentDefinition[];
}

// ---------- V2 catalog/components/*.yaml（Golden Journey 子集；1:1 数据保真） ----------

const SOIL_MOISTURE: ComponentDefinition = {
  id: "sensor.soil_moisture",
  schemaVersion: "1",
  displayName: "土壤湿度传感器",
  aliases: ["Soil Moisture Sensor", "土壤水分传感器"],
  categories: ["sensor"],
  capabilities: ["soil_moisture_sensing"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 3.3, supplyVoltageMax: 5.5, typicalCurrentMa: 15.0 },
  interfaces: [{ type: "analog", signalCount: 1, ioDirection: "input" }],
  platformCompatibility: { arduino_uno: "supported", "ESP32-S3": "supported", RP2040: "supported", STM32F401RE: "supported" },
  firmware: { libraries: [], includes: [], codegenAdapter: "generic_analog_sensor", varName: "SOIL_MOISTURE" },
  purchasing: { searchTerms: ["soil moisture sensor", "土壤湿度传感器"] },
  safetyNotes: [],
};

const RELAY: ComponentDefinition = {
  id: "actuator.relay",
  schemaVersion: "1",
  displayName: "继电器模块",
  aliases: ["Relay Module", "5V继电器"],
  categories: ["actuator"],
  capabilities: ["high_power_switching"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 4.5, supplyVoltageMax: 5.5, typicalCurrentMa: 70.0 },
  interfaces: [{ type: "digital", signalCount: 1, ioDirection: "output" }],
  platformCompatibility: { arduino_uno: "supported", "ESP32-S3": "supported", RP2040: "supported", STM32F401RE: "supported" },
  firmware: { libraries: [], includes: [], codegenAdapter: "generic_digital_output", varName: "RELAY" },
  purchasing: { searchTerms: ["relay module 5V", "继电器模块"] },
  safetyNotes: ["Requires flyback diode protection on relay coil."],
};

const OLED_096: ComponentDefinition = {
  id: "display.oled_096",
  schemaVersion: "1",
  displayName: "OLED 0.96寸",
  aliases: ["OLED", "SSD1306", "0.96 inch OLED"],
  categories: ["display"],
  capabilities: ["graphical_display"],
  electrical: { logicVoltage: 3.3, supplyVoltageMin: 3.3, supplyVoltageMax: 5.0, typicalCurrentMa: 20.0 },
  interfaces: [{ type: "i2c", signalCount: 2, ioDirection: "output" }],
  platformCompatibility: { arduino_uno: "supported", "ESP32-S3": "supported", RP2040: "supported", STM32F401RE: "supported" },
  firmware: { libraries: ["Adafruit_SSD1306", "Adafruit_GFX"], includes: ["Adafruit_SSD1306.h", "Adafruit_GFX.h"], codegenAdapter: "generic_i2c_display", varName: "OLED" },
  purchasing: { searchTerms: ["OLED 0.96", "SSD1306"] },
  safetyNotes: [],
};

// ---------- V2 测试引用组件（constraint-engine 搬运测试 1:1 所需；worker/tests/unit/constraints/test_engine.py） ----------

const DHT22: ComponentDefinition = {
  id: "sensor.dht22",
  schemaVersion: "1",
  displayName: "DHT22",
  aliases: ["DHT22温湿度传感器", "AM2302"],
  categories: ["sensor"],
  capabilities: ["temperature_sensing", "humidity_sensing"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 3.3, supplyVoltageMax: 5.5, typicalCurrentMa: 2.5 },
  interfaces: [{ type: "digital", signalCount: 1, ioDirection: "input" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: ["DHT sensor library"], includes: ["DHT.h"], codegenAdapter: "dht", varName: "DHT22" },
  purchasing: { searchTerms: ["DHT22 module", "DHT22传感器"] },
  safetyNotes: [],
};

const LCD1602: ComponentDefinition = {
  id: "display.lcd1602",
  schemaVersion: "1",
  displayName: "LCD1602",
  aliases: ["LCD 1602", "16x2 LCD", "LCD1602 I2C"],
  categories: ["display"],
  capabilities: ["text_display"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 4.5, supplyVoltageMax: 5.5, typicalCurrentMa: 5.0 },
  interfaces: [{ type: "i2c", signalCount: 2, ioDirection: "output" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: ["LiquidCrystal_I2C"], includes: ["LiquidCrystal_I2C.h"], codegenAdapter: "lcd", varName: "LCD" },
  purchasing: { searchTerms: ["LCD1602 I2C", "1602液晶屏"] },
  safetyNotes: [],
};

const BMP280: ComponentDefinition = {
  id: "sensor.bmp280",
  schemaVersion: "1",
  displayName: "BMP280",
  aliases: ["BMP280气压传感器"],
  categories: ["sensor"],
  capabilities: ["pressure_sensing", "temperature_sensing", "altitude_sensing"],
  electrical: { logicVoltage: 3.3, supplyVoltageMin: 1.71, supplyVoltageMax: 3.6, typicalCurrentMa: 2.7 },
  interfaces: [{ type: "i2c", signalCount: 2, ioDirection: "input" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: ["Adafruit_BMP280"], includes: ["Adafruit_BMP280.h"], codegenAdapter: "bmp280", varName: "BMP280" },
  purchasing: { searchTerms: ["BMP280 module", "BMP280气压"] },
  safetyNotes: [],
};

const PHOTORESISTOR: ComponentDefinition = {
  id: "sensor.photoresistor",
  schemaVersion: "1",
  displayName: "光敏电阻模块",
  aliases: ["Photoresistor", "LDR", "光敏传感器"],
  categories: ["sensor"],
  capabilities: ["light_sensing"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 3.3, supplyVoltageMax: 5.5, typicalCurrentMa: 5.0 },
  interfaces: [{ type: "analog", signalCount: 1, ioDirection: "input" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: [], includes: [], codegenAdapter: "generic_analog_sensor", varName: "LIGHT" },
  purchasing: { searchTerms: ["photoresistor module", "光敏电阻模块"] },
  safetyNotes: [],
};

const SG90: ComponentDefinition = {
  id: "actuator.sg90",
  schemaVersion: "1",
  displayName: "SG90 舵机",
  aliases: ["SG90", "Servo", "微型舵机"],
  categories: ["actuator"],
  capabilities: ["angular_control"],
  electrical: { logicVoltage: 5.0, supplyVoltageMin: 4.8, supplyVoltageMax: 6.0, typicalCurrentMa: 250.0 },
  interfaces: [{ type: "pwm", signalCount: 1, ioDirection: "output" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: ["Servo"], includes: ["Servo.h"], codegenAdapter: "servo", varName: "SERVO" },
  purchasing: { searchTerms: ["SG90 servo", "SG90舵机"] },
  safetyNotes: [],
};

const HC05: ComponentDefinition = {
  id: "comm.hc_05",
  schemaVersion: "1",
  displayName: "HC-05 蓝牙模块",
  aliases: ["HC-05", "Bluetooth Module", "蓝牙串口模块"],
  categories: ["communication"],
  capabilities: ["bluetooth_communication"],
  electrical: { logicVoltage: 3.3, supplyVoltageMin: 3.6, supplyVoltageMax: 6.0, typicalCurrentMa: 30.0 },
  interfaces: [{ type: "uart", signalCount: 2, ioDirection: "bidirectional" }],
  platformCompatibility: { arduino_uno: "supported" },
  firmware: { libraries: ["SoftwareSerial"], includes: ["SoftwareSerial.h"], codegenAdapter: "bluetooth", varName: "BT" },
  purchasing: { searchTerms: ["HC-05 bluetooth", "HC-05蓝牙"] },
  safetyNotes: [],
};

const CATALOG: ComponentDefinition[] = [SOIL_MOISTURE, RELAY, OLED_096, DHT22, LCD1602, BMP280, PHOTORESISTOR, SG90, HC05];

export function createComponentRegistry(): ComponentRegistry {
  const byId = new Map<string, ComponentDefinition>();
  const byAlias = new Map<string, string>(); // alias_lower -> id
  const byCapability = new Map<string, string[]>(); // capability -> [ids]

  for (const comp of CATALOG) {
    if (byId.has(comp.id)) throw new Error(`Duplicate component id: ${comp.id}`);
    byId.set(comp.id, comp);
    for (const alias of comp.aliases) {
      const key = alias.toLowerCase();
      if (byAlias.has(key)) throw new Error(`Duplicate alias '${alias}'`);
      byAlias.set(key, comp.id);
    }
    const dnKey = comp.displayName.toLowerCase();
    if (!byAlias.has(dnKey)) byAlias.set(dnKey, comp.id);
    for (const cap of comp.capabilities) {
      byCapability.set(cap, [...(byCapability.get(cap) ?? []), comp.id]);
    }
  }

  return {
    get count() {
      return byId.size;
    },
    get allIds() {
      return [...byId.keys()];
    },
    get(id: string): ComponentDefinition {
      const c = byId.get(id);
      if (!c) throw new Error(`Component not found: ${id}`);
      return c;
    },
    getOrNone(id: string): ComponentDefinition | null {
      return byId.get(id) ?? null;
    },
    findByAlias(alias: string): ComponentDefinition | null {
      const id = byAlias.get(alias.toLowerCase());
      return id ? (byId.get(id) ?? null) : null;
    },
    findByName(name: string): ComponentDefinition | null {
      if (byId.has(name)) return byId.get(name)!;
      const exact = this.findByAlias(name);
      if (exact) return exact;
      const nameLower = name.toLowerCase();
      for (const [alias, id] of byAlias) {
        if (alias.includes(nameLower) || nameLower.includes(alias)) {
          return byId.get(id) ?? null;
        }
      }
      return null;
    },
    findByCapability(capability: string, platformId?: string): ComponentDefinition[] {
      const ids = byCapability.get(capability) ?? [];
      let results = ids.map((cid) => byId.get(cid)!).filter(Boolean);
      if (platformId) {
        results = results.filter((c) => c.platformCompatibility[platformId] === "supported");
      }
      return results;
    },
  };
}
