// domain/knowledge/platforms.ts — 平台知识（ISSUE-005 §3/§7；ADR-0013 TS 移植）
// V2 worker/.../platforms/registry.py + catalog/platforms/*.yaml 数据移植（arduino_uno 1:1 保真）
// + Golden Journey 目标平台（ESP32-S3 strapping 数据 / RP2040 / STM32F401RE，冻结 UI MCU_CANDIDATES 事实源）。
// 静态 catalog（M1 数据为代码常量；未来可配置化再升表/文件）。

export interface PlatformBuses {
  [bus: string]: { pins: Record<string, string>; shared: boolean };
}

export type PlatformObjectLevel = "chip" | "module" | "board" | "component" | "tool";
export type PlatformFactValueClass = "stated" | "recommended" | "typical" | "maximum" | "unknown";
export type PlatformFactConfidence = "official-direct" | "official-index" | "measured" | "user-supplied" | "inferred" | "unsupported";

export interface PlatformSource {
  owner: string;
  url: string;
  title: string;
  revision?: string;
  accessedAt: string;
  confidence: PlatformFactConfidence;
}

export interface PlatformFact {
  key: string;
  value: string;
  unit?: string;
  condition?: string;
  valueClass: PlatformFactValueClass;
  source: PlatformSource;
}

export interface ReferenceKitDefinition {
  id: string;
  boardModel: string;
  moduleModel: string;
  boardRevision: string;
  objectLevel: "board";
  source: PlatformSource;
  facts: PlatformFact[];
  physicalAcceptance: {
    status: "pending" | "accepted";
    reason: string;
  };
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
  // V1 审计（docs/audit/2026-08-22-spec-compliance-audit.md）：进入候选矩阵的平台
  // 必须携带官方来源与事实数组——spec 实现决策"其他平台不能以未经核验的静态事实参与首发推荐"。
  objectLevel?: PlatformObjectLevel;
  source?: PlatformSource;
  facts?: PlatformFact[];
  /** 候选分类（冻结 UI：推荐/备选/工业级）。仅当 objectLevel+source+facts 齐备时才允许设置。 */
  candidateTier?: "recommended" | "alternative" | "industrial";
  /** 外设兼容（候选卡 ⚠️ 约束警告依据） */
  constraints?: string[];
  /** 候选卡规格文本（冻结 UI 呈现） */
  wireless?: string;
  flashSram?: string;
  ioMatrix?: string;
  reason?: string;
  /** 精确到可购买开发板的商业首发身份；宽泛平台记录不得替代它。 */
  referenceKit?: ReferenceKitDefinition;
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
  // V1 审计：模组级对象；精确可购买身份由 referenceKit（DevKitC-1-N8R8 v1.1）承载。
  objectLevel: "module",
  source: {
    owner: "Espressif",
    url: "https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf",
    title: "ESP32-S3-WROOM-1 Datasheet",
    accessedAt: "2026-08-16",
    confidence: "official-direct",
  },
  // 引脚池顺序 = 冻结 UI Golden Journey 参考分配（土壤→IO4、继电器→IO12、OLED→IO8/IO9）：
  // strapping 引脚（IO0/IO12/IO45/IO46）可用但带风险 → 不入 reserved（reserved=系统功能独占），
  // 由 ConstraintEngine 的 STRAPPING_PIN_USAGE 检查标记（Golden Journey 冲突场景数据源）
  pins: {
    digital: ["IO12", "IO4", "IO5", "IO8", "IO9", "IO18", "IO19", "IO20", "IO21", "IO1", "IO2", "IO3", "IO6", "IO7", "IO10", "IO11", "IO13", "IO14", "IO15", "IO16", "IO17", "IO35", "IO36", "IO37", "IO38", "IO39", "IO40", "IO41", "IO42", "IO43", "IO44", "IO45", "IO46", "IO47", "IO48"],
    analog: ["IO4", "IO1", "IO2", "IO3", "IO5", "IO6", "IO7", "IO8", "IO9", "IO10", "IO11", "IO12", "IO13", "IO14", "IO15", "IO16", "IO17", "IO18", "IO19", "IO20"],
    pwm: ["IO5", "IO18", "IO19", "IO21", "IO35", "IO36", "IO37", "IO38", "IO39", "IO40", "IO41", "IO42", "IO43", "IO44", "IO47", "IO48"],
  },
  buses: {
    i2c: { pins: { sda: "IO8", scl: "IO9" }, shared: true },
    spi: { pins: { mosi: "IO35", miso: "IO37", sck: "IO36", ss: "IO42" }, shared: true },
    uart: { pins: { rx: "IO43", tx: "IO44" }, shared: false },
  },
  reservedPins: [],
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
  referenceKit: {
    id: "esp32-s3-devkitc-1-n8r8-v1.1",
    boardModel: "ESP32-S3-DevKitC-1-N8R8",
    moduleModel: "ESP32-S3-WROOM-1-N8R8",
    boardRevision: "v1.1",
    objectLevel: "board",
    source: {
      owner: "Espressif",
      url: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html",
      title: "ESP32-S3-DevKitC-1 User Guide v1.1",
      revision: "v1.1",
      accessedAt: "2026-08-16",
      confidence: "official-direct",
    },
    facts: [
      {
        key: "flash",
        value: "8 MB Quad-SPI",
        valueClass: "stated",
        source: {
          owner: "Espressif",
          url: "https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf",
          title: "ESP32-S3-WROOM-1 Datasheet",
          accessedAt: "2026-08-16",
          confidence: "official-direct",
        },
      },
      {
        key: "psram",
        value: "8 MB Octal-SPI",
        valueClass: "stated",
        source: {
          owner: "Espressif",
          url: "https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf",
          title: "ESP32-S3-WROOM-1 Datasheet",
          accessedAt: "2026-08-16",
          confidence: "official-direct",
        },
      },
      {
        key: "usb",
        value: "USB-to-UART + native USB OTG",
        valueClass: "stated",
        source: {
          owner: "Espressif",
          url: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html",
          title: "ESP32-S3-DevKitC-1 User Guide v1.1",
          revision: "v1.1",
          accessedAt: "2026-08-16",
          confidence: "official-direct",
        },
      },
      {
        key: "logic-voltage",
        value: "3.3",
        unit: "V",
        valueClass: "stated",
        source: {
          owner: "Espressif",
          url: "https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf",
          title: "ESP32-S3-WROOM-1 Datasheet",
          accessedAt: "2026-08-16",
          confidence: "official-direct",
        },
      },
    ],
    physicalAcceptance: {
      status: "pending",
      reason: "当前记录尚未包含这块实物的 USB 识别、上传和串口启动证据。",
    },
  },
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
  // V1 审计挂起（docs/audit/2026-08-22-spec-compliance-audit.md）：本记录的静态事实
  // 无官方一手来源（raspberrypi.com / archive.org 在当前网络不可达，2026-08-22 核对失败）。
  // 按 spec 实现决策"未核验平台不得参与首发推荐"→ 移出候选矩阵。
  // 复入条件：以官方 datasheet 核对后补 objectLevel+source+facts，并同步
  // platform-provenance 测试与 s4/mcu 契约断言。select_mcu 工程路径不受影响。
  wireless: "None (Requires external CYW43439)",
  flashSram: "2MB External Flash / 264KB SRAM",
  ioMatrix: "30 GPIO Pins, 4x 12-bit ADC",
  constraints: ["No integrated Wi-Fi — conflicts with wireless requirement"],
  reason: "High PIO flexibility, but lacks native Wi-Fi/BLE radio hardware.",
};

// ── V1 已核验来源（官方一手文档，抓取核对于 2026-08-22）。
// 常量必须先于引用它们的 STM32F401RE 记录定义（const 无提升）。

const STM32_MCU_PAGE_SOURCE: PlatformSource = {
  owner: "STMicroelectronics",
  url: "https://www.st.com/en/microcontrollers-microprocessors/stm32f401re.html",
  title: "STM32F401RE — Arm Cortex-M4 with DSP and FPU, up to 512 Kbytes of Flash memory, 84 MHz CPU",
  accessedAt: "2026-08-22",
  confidence: "official-direct",
};

const STM32_BOARDS_TXT_SOURCE: PlatformSource = {
  owner: "STMicroelectronics (stm32duino)",
  url: "https://raw.githubusercontent.com/stm32duino/Arduino_Core_STM32/main/boards.txt",
  title: "Arduino_Core_STM32 boards.txt — NUCLEO_F401RE board definition (build.mcu=cortex-m4, maximum_size=524288)",
  revision: "main @ 2026-08-22",
  accessedAt: "2026-08-22",
  confidence: "official-direct",
};

const STM32_NUCLEO_F401RE_SOURCE: PlatformSource = {
  owner: "STMicroelectronics",
  url: "https://www.st.com/en/evaluation-tools/nucleo-f401re.html",
  title: "STM32 Nucleo-64 development board with STM32F401RE MCU, supports Arduino and ST morpho connectivity",
  accessedAt: "2026-08-22",
  confidence: "official-direct",
};

const STM32_F401RE_FACTS: PlatformFact[] = [
  {
    key: "core",
    value: "Arm Cortex-M4 with DSP and FPU @ 84 MHz",
    valueClass: "stated",
    source: STM32_MCU_PAGE_SOURCE,
  },
  {
    key: "flash",
    value: "512",
    unit: "KB",
    condition: "官方构建配置 upload.maximum_size=524288 B（NUCLEO_F401RE）",
    valueClass: "stated",
    source: STM32_BOARDS_TXT_SOURCE,
  },
  {
    key: "sram",
    value: "96",
    unit: "KB",
    condition: "官方构建配置 upload.maximum_data_size=98304 B（NUCLEO_F401RE）",
    valueClass: "stated",
    source: STM32_BOARDS_TXT_SOURCE,
  },
  {
    key: "arduino-core-board",
    value: "stm32:stm32 · Nucleo_64 · pnum=NUCLEO_F401RE · build.mcu=cortex-m4",
    condition: "官方 Arduino 核心仓库 boards.txt 板型定义",
    valueClass: "stated",
    source: STM32_BOARDS_TXT_SOURCE,
  },
  {
    key: "gpio",
    value: "78",
    unit: "fast I/Os",
    condition: "芯片级数字（官方页原文 'Up to 78 fast I/Os'）；Nucleo-64 板仅经排针引出子集",
    valueClass: "stated",
    source: STM32_MCU_PAGE_SOURCE,
  },
  {
    key: "board-identity",
    value: "STM32 Nucleo-64 development board with STM32F401RE MCU (Arduino UNO R3 + ST morpho connectivity)",
    valueClass: "stated",
    source: STM32_NUCLEO_F401RE_SOURCE,
  },
  {
    key: "wireless",
    value: "No radio integrated",
    condition: "官方外设摘要不含任何 RF 外设；无线需外接模块",
    valueClass: "stated",
    source: STM32_MCU_PAGE_SOURCE,
  },
];

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
  // 官方 boards.txt 核对：板 Nucleo_64 + pnum NUCLEO_F401RE，build.mcu=cortex-m4（F4 家族）
  toolchain: { type: "arduino_cli", fqbn: "stm32:stm32:Nucleo_64:pnum=NUCLEO_F401RE", core: "stm32:stm32" },
  codegenProfile: "arduino_stm32",
  // 已核验来源（2026-08-22 经官方 st.com 页面抓取核对；见 docs/audit/2026-08-22-spec-compliance-audit.md V1）
  objectLevel: "board",
  source: STM32_NUCLEO_F401RE_SOURCE,
  facts: STM32_F401RE_FACTS,
  candidateTier: "industrial",
  wireless: "None",
  flashSram: "512KB Flash / 96KB SRAM",
  ioMatrix: "50 GPIO Pins, 12-bit ADC 2.4 MSPS",
  constraints: ["No integrated Wi-Fi", "Arduino/ESP-IDF 生态外——固件路径不同"],
  reason: "Ultra-reliable industrial HAL target with zero integrated wireless.",
};

const CATALOG: PlatformDefinition[] = [ARDUINO_UNO, ESP32_S3, RP2040, STM32F401RE];
