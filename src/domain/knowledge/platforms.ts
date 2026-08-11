// domain/knowledge/platforms.ts — 平台知识（ISSUE-005 §3/§7；ADR-0013 TS 移植）
// V2 worker/.../platforms/registry.py + catalog/platforms/*.yaml 数据移植（arduino_uno 1:1 保真）
// + Golden Journey 目标平台（ESP32-S3 strapping 数据 / RP2040 / STM32F401RE，冻结 UI MCU_CANDIDATES 事实源）。
// 静态 catalog（M1 数据为代码常量；未来可配置化再升表/文件）。

export interface PlatformBuses {
  [bus: string]: { pins: Record<string, string>; shared: boolean };
}

export interface PlatformDefinition {
  id: string;
  schemaVersion: string;
  displayName: string;
  family: string;
  framework: string;
  logicVoltage: number;
  pins: { digital: string[]; analog: string[]; pwm: string[] };
  buses: PlatformBuses;
  reservedPins: Array<{ pin: string; reason: string }>;
  memory: { flashKb: number; sramKb: number; eepromKb: number };
  powerLimits: {
    maxPinCurrentMa: number;
    maxTotalCurrentMa: number;
    vinRange: [number, number];
    regulated5vAvailable: boolean;
    regulated3v3Available: boolean;
  };
  toolchain: { type: string; fqbn: string; core: string };
  codegenProfile: string;
  /** strapping 引脚（ESP32 系；上电引导/电压配置风险） */
  strappingPins?: Array<{ pin: string; reason: string }>;
  /** 候选分类（冻结 UI：推荐/备选/工业级） */
  candidateTier?: "recommended" | "alternative" | "industrial";
  /** 外设兼容（候选卡 ⚠️ 约束警告依据） */
  constraints?: string[];
  /** 候选卡规格文本（冻结 UI 呈现） */
  wireless?: string;
  flashSram?: string;
  ioMatrix?: string;
  reason?: string;
}

export interface PlatformRegistry {
  count: number;
  allIds: string[];
  get(id: string): PlatformDefinition;
  getOrNone(id: string): PlatformDefinition | null;
  isSupported(id: string): boolean;
}

// V2 PlatformDefinition @property 助手（reserved_pin_set / available_*）
export function reservedPinSet(p: PlatformDefinition): Set<string> {
  return new Set(p.reservedPins.map((rp) => rp.pin));
}

export function availableDigital(p: PlatformDefinition): string[] {
  const reserved = reservedPinSet(p);
  return p.pins.digital.filter((pin) => !reserved.has(pin));
}

export function availableAnalog(p: PlatformDefinition): string[] {
  const reserved = reservedPinSet(p);
  return p.pins.analog.filter((pin) => !reserved.has(pin));
}

export function availablePwm(p: PlatformDefinition): string[] {
  const reserved = reservedPinSet(p);
  return p.pins.pwm.filter((pin) => !reserved.has(pin));
}

// ---------- V2 catalog/platforms/arduino_uno.yaml（1:1 数据保真） ----------

const ARDUINO_UNO: PlatformDefinition = {
  id: "arduino_uno",
  schemaVersion: "1",
  displayName: "Arduino UNO",
  family: "avr",
  framework: "arduino",
  logicVoltage: 5.0,
  pins: {
    digital: ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13"],
    analog: ["A0", "A1", "A2", "A3", "A4", "A5"],
    pwm: ["D3", "D5", "D6", "D9", "D10", "D11"],
  },
  buses: {
    i2c: { pins: { sda: "A4", scl: "A5" }, shared: true },
    spi: { pins: { ss: "D10", mosi: "D11", miso: "D12", sck: "D13" }, shared: true },
    uart: { pins: { rx: "D0", tx: "D1" }, shared: false },
  },
  reservedPins: [
    { pin: "D0", reason: "UART RX (Serial)" },
    { pin: "D1", reason: "UART TX (Serial)" },
    { pin: "A4", reason: "I2C SDA (shared bus)" },
    { pin: "A5", reason: "I2C SCL (shared bus)" },
  ],
  memory: { flashKb: 32, sramKb: 2, eepromKb: 1 },
  powerLimits: {
    maxPinCurrentMa: 40,
    maxTotalCurrentMa: 200,
    vinRange: [7.0, 12.0],
    regulated5vAvailable: true,
    regulated3v3Available: false,
  },
  toolchain: { type: "arduino_cli", fqbn: "arduino:avr:uno", core: "arduino:avr" },
  codegenProfile: "arduino_avr",
};

// ---------- Golden Journey 目标平台（冻结 UI MCU_CANDIDATES + ESP32-S3 strapping 工程事实） ----------

const ESP32_S3: PlatformDefinition = {
  id: "ESP32-S3",
  schemaVersion: "1",
  displayName: "ESP32-S3 WROOM-1",
  family: "esp32s3",
  framework: "arduino",
  logicVoltage: 3.3,
  pins: {
    digital: ["IO0", "IO1", "IO2", "IO3", "IO4", "IO5", "IO6", "IO7", "IO8", "IO9", "IO10", "IO11", "IO12", "IO13", "IO14", "IO15", "IO16", "IO17", "IO18", "IO19", "IO20", "IO21", "IO35", "IO36", "IO37", "IO38", "IO39", "IO40", "IO41", "IO42", "IO43", "IO44", "IO45", "IO46", "IO47", "IO48"],
    analog: ["IO1", "IO2", "IO3", "IO4", "IO5", "IO6", "IO7", "IO8", "IO9", "IO10", "IO11", "IO12", "IO13", "IO14", "IO15", "IO16", "IO17", "IO18", "IO19", "IO20"],
    pwm: ["IO1", "IO2", "IO3", "IO4", "IO5", "IO6", "IO7", "IO8", "IO9", "IO10", "IO11", "IO12", "IO13", "IO14", "IO15", "IO16", "IO17", "IO18", "IO19", "IO20", "IO21", "IO35", "IO36", "IO37", "IO38", "IO39", "IO40", "IO41", "IO42", "IO43", "IO44", "IO45", "IO46", "IO47", "IO48"],
  },
  buses: {
    i2c: { pins: { sda: "IO8", scl: "IO9" }, shared: true },
    spi: { pins: { mosi: "IO35", miso: "IO37", sck: "IO36", ss: "IO42" }, shared: true },
    uart: { pins: { rx: "IO43", tx: "IO44" }, shared: false },
  },
  reservedPins: [
    { pin: "IO0", reason: "Strapping: boot mode" },
    { pin: "IO45", reason: "Strapping: chip boot" },
    { pin: "IO46", reason: "Strapping: download boot" },
    { pin: "IO12", reason: "Strapping: flash voltage (1.8V/3.3V)" },
  ],
  memory: { flashKb: 8192, sramKb: 512, eepromKb: 0 },
  powerLimits: {
    maxPinCurrentMa: 40,
    maxTotalCurrentMa: 500,
    vinRange: [3.0, 3.6],
    regulated5vAvailable: false,
    regulated3v3Available: true,
  },
  toolchain: { type: "arduino_cli", fqbn: "esp32:esp32:esp32s3", core: "esp32:esp32" },
  codegenProfile: "arduino_esp32s3",
  strappingPins: [
    { pin: "IO0", reason: "Boot mode select (pull-up/down at reset)" },
    { pin: "IO45", reason: "Chip boot mode (strapping at reset)" },
    { pin: "IO46", reason: "Download boot mode (strapping at reset)" },
    { pin: "IO12", reason: "Flash voltage config (1.8V LDO when pulled high at reset)" },
  ],
  candidateTier: "recommended",
  wireless: "Wi-Fi 4 (802.11b/g/n) + BLE 5.0",
  flashSram: "8MB Flash / 512KB SRAM",
  ioMatrix: "45 Programmable GPIOs, USB-OTG, Vector Ext",
  reason: "Optimal match for analog soil monitoring and concurrent Wi-Fi telemetry.",
};

const RP2040: PlatformDefinition = {
  id: "RP2040",
  schemaVersion: "1",
  displayName: "Raspberry Pi RP2040",
  family: "rp2040",
  framework: "arduino",
  logicVoltage: 3.3,
  pins: {
    digital: ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11", "GP12", "GP13", "GP14", "GP15", "GP16", "GP17", "GP18", "GP19", "GP20", "GP21", "GP22", "GP26", "GP27", "GP28"],
    analog: ["GP26", "GP27", "GP28"],
    pwm: ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7", "GP8", "GP9", "GP10", "GP11", "GP12", "GP13", "GP14", "GP15", "GP16", "GP17", "GP18", "GP19", "GP20", "GP21", "GP22", "GP26", "GP27", "GP28"],
  },
  buses: {
    i2c: { pins: { sda: "GP4", scl: "GP5" }, shared: true },
    spi: { pins: { mosi: "GP7", miso: "GP4", sck: "GP6", ss: "GP5" }, shared: true },
    uart: { pins: { rx: "GP1", tx: "GP0" }, shared: false },
  },
  reservedPins: [],
  memory: { flashKb: 2048, sramKb: 264, eepromKb: 0 },
  powerLimits: {
    maxPinCurrentMa: 50,
    maxTotalCurrentMa: 500,
    vinRange: [1.8, 5.5],
    regulated5vAvailable: false,
    regulated3v3Available: true,
  },
  toolchain: { type: "arduino_cli", fqbn: "rp2040:rp2040:rpipico", core: "rp2040:rp2040" },
  codegenProfile: "arduino_rp2040",
  candidateTier: "alternative",
  wireless: "None (Requires external CYW43439)",
  flashSram: "2MB External Flash / 264KB SRAM",
  ioMatrix: "30 GPIO Pins, 4x 12-bit ADC",
  constraints: ["No integrated Wi-Fi — conflicts with wireless requirement"],
  reason: "High PIO flexibility, but lacks native Wi-Fi/BLE radio hardware.",
};

const STM32F401RE: PlatformDefinition = {
  id: "STM32F401RE",
  schemaVersion: "1",
  displayName: "STM32F401RE Nucleo",
  family: "stm32f4",
  framework: "arduino",
  logicVoltage: 3.3,
  pins: {
    digital: ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PA8", "PA9", "PA10", "PA11", "PA12", "PA15", "PB0", "PB1", "PB2", "PB3", "PB4", "PB5", "PB6", "PB7", "PB8", "PB9", "PB10", "PB12", "PB13", "PB14", "PB15", "PC13", "PC14", "PC15"],
    analog: ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PB0", "PB1"],
    pwm: ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PA8", "PA9", "PA10", "PA11", "PA12", "PA15", "PB0", "PB1", "PB3", "PB4", "PB5", "PB6", "PB7", "PB8", "PB9", "PB10"],
  },
  buses: {
    i2c: { pins: { sda: "PB7", scl: "PB6" }, shared: true },
    spi: { pins: { mosi: "PA7", miso: "PA6", sck: "PA5", ss: "PA4" }, shared: true },
    uart: { pins: { rx: "PA10", tx: "PA9" }, shared: false },
  },
  reservedPins: [],
  memory: { flashKb: 512, sramKb: 96, eepromKb: 0 },
  powerLimits: {
    maxPinCurrentMa: 25,
    maxTotalCurrentMa: 300,
    vinRange: [3.0, 3.6],
    regulated5vAvailable: false,
    regulated3v3Available: true,
  },
  toolchain: { type: "arduino_cli", fqbn: "stm32duino:STM32F1:nucleo_f401re", core: "stm32duino:STM32F1" },
  codegenProfile: "arduino_stm32",
  candidateTier: "industrial",
  wireless: "None",
  flashSram: "512KB Flash / 96KB SRAM",
  ioMatrix: "50 GPIO Pins, 12-bit ADC 2.4 MSPS",
  constraints: ["No integrated Wi-Fi", "Arduino/ESP-IDF 生态外——固件路径不同"],
  reason: "Ultra-reliable industrial HAL target with zero integrated wireless.",
};

const CATALOG: PlatformDefinition[] = [ARDUINO_UNO, ESP32_S3, RP2040, STM32F401RE];

export function createPlatformRegistry(): PlatformRegistry {
  const byId = new Map<string, PlatformDefinition>();
  for (const p of CATALOG) {
    if (byId.has(p.id)) throw new Error(`Duplicate platform id: ${p.id}`);
    byId.set(p.id, p);
  }
  return {
    get count() {
      return byId.size;
    },
    get allIds() {
      return [...byId.keys()];
    },
    get(id: string): PlatformDefinition {
      const p = byId.get(id);
      if (!p) throw new Error(`Platform not found: ${id}. Available: ${[...byId.keys()].join(", ")}`);
      return p;
    },
    getOrNone(id: string): PlatformDefinition | null {
      return byId.get(id) ?? null;
    },
    isSupported(id: string): boolean {
      return byId.has(id);
    },
  };
}
