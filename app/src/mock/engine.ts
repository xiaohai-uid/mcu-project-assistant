// ============================================================
// Mock Engine — Golden Journey 的模拟数据与脚本
// 纯前端、无后端。所有"AI"行为都是确定性脚本 + 延迟/流式模拟。
// 状态语义见 docs/rebuild/ui-state-model.md
// ============================================================
import type {
  BuildDiagnosis,
  BuildLogLine,
  Clarification,
  DiscoveredRequirement,
  FirmwareProposal,
  McuCandidate,
  Peripheral,
  PinIssue,
  PinMapping,
  ProposalItem,
} from "../types";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- 项目 ----------

export const INITIAL_PROJECTS = [
  {
    id: "smart-greenhouse",
    title: "Smart Greenhouse",
    version: "v1.2.4-alpha",
    status: "Stale" as const,
    target: "ESP32-S3",
    rtosOrFramework: "FreeRTOS",
    frameworkType: "RTOS" as const,
    lastEdit: "45 days ago",
    size: "4.2 MB",
    icon: "eco",
  },
  {
    id: "led-controller",
    title: "LED Controller",
    version: "v2.0.0-release",
    status: "Validated" as const,
    target: "RP2040",
    rtosOrFramework: "Pico SDK",
    frameworkType: "Framework" as const,
    lastEdit: "2 hours ago",
    size: "1.1 MB",
    icon: "lightbulb",
  },
];

export const TEMPLATES = [
  {
    id: "iot-weather-station",
    title: "IoT Weather Station",
    description: "ESP32 + BME280 sensor stack with MQTT publishing configured.",
    badge: "ESP-IDF",
    icon: "cloud",
  },
  {
    id: "basic-motor-control",
    title: "Basic Motor Control",
    description: "STM32 PWM generation and H-Bridge driver scaffolding.",
    badge: "HAL",
    icon: "electric_bolt",
  },
];

// ---------- Discovery 脚本 ----------

export const DEFAULT_PROMPT =
  "I want to build an automated greenhouse monitor that measures soil moisture, drives a 5V water pump relay, displays telemetry on an OLED screen, and publishes readings over Wi-Fi.";

export const DISCOVERY_CAPABILITIES: DiscoveredRequirement[] = [
  {
    id: "req-1",
    title: "Soil moisture monitoring",
    type: "Analog",
    status: "complete",
    progress: 100,
    icon: "water_drop",
    details: "Capacitive soil moisture sensor mapped to ADC pin IO4.",
  },
  {
    id: "req-2",
    title: "Water pump control",
    type: "Relay/PWM",
    status: "complete",
    progress: 100,
    icon: "valve",
    details: "5V relay switch driven via transistor/MOSFET on IO12.",
  },
  {
    id: "req-3",
    title: "Local status display",
    type: "OLED?",
    status: "pending",
    progress: 60,
    icon: "monitor",
    isWarning: true,
    details: "Pending confirmation for 0.96 inch I2C OLED display (SDA: IO8, SCL: IO9).",
  },
  {
    id: "req-4",
    title: "Battery/Power management",
    type: "Power",
    status: "partial",
    progress: 40,
    icon: "battery_charging_full",
    details: "Requires 5V USB-C power or 3.7V LiPo with TP4056 charging IC.",
  },
];

export const DISCOVERY_PROPOSALS: ProposalItem[] = [
  {
    id: "prop-1",
    number: "01",
    title: "Wireless Connectivity",
    accepted: true,
    initialIdea: `"I want it to talk to my phone over wifi or bluetooth."`,
    formalizedRequirement:
      "System must support dual-mode connectivity: 802.11 b/g/n (2.4GHz) and BLE 5.0 for concurrent local telemetry and remote configuration.",
    impacts: ["Hardware", "Power Budget"],
  },
  {
    id: "prop-2",
    number: "02",
    title: "Environmental Sensing",
    accepted: true,
    initialIdea: `"Needs to read room temp and humidity accurately."`,
    formalizedRequirement:
      "Integrate high-precision I2C sensor (e.g., SHTC3 or BME280) capable of ±0.2°C thermal accuracy and ±2% RH relative humidity tolerance.",
    impacts: ["Wiring (I2C)", "Hardware"],
  },
  {
    id: "prop-3",
    number: "03",
    title: "Data Persistence",
    accepted: false,
    initialIdea: `"Should remember settings if power dies."`,
    formalizedRequirement:
      "Allocate non-volatile storage (NVS) partition in flash memory (minimum 16KB) for retaining JSON configuration states across power cycles.",
    impacts: ["Firmware"],
  },
];

export const CLARIFICATION: Clarification = {
  question: "Which display size do you need?",
  detail: "0.96\" (128x64, SSD1306) is the most common. 1.3\" (SH1106) is also available.",
  answer: "",
  answered: false,
};

const DISCOVERY_STREAM = [
  "Parsing project description…",
  "Detected analog sensing requirement (soil moisture).",
  "Detected digital output requirement (relay driver).",
  "Checking I2C bus availability for display module…",
  "Analyzing power budget: 5V USB vs LiPo + TP4056.",
  "Evaluating wireless connectivity options (Wi-Fi / BLE).",
  "Formalizing specifications…",
];

// ---------- Hardware ----------

export const MCU_CANDIDATES: McuCandidate[] = [
  {
    id: "ESP32-S3",
    title: "ESP32-S3 WROOM-1",
    badgeKey: "recommended",
    core: "Dual-core Xtensa LX7 (240MHz)",
    wireless: "Wi-Fi 4 (802.11b/g/n) + BLE 5.0",
    gpio: "45 Programmable GPIOs, USB-OTG, Vector Ext",
    flash: "8MB Flash / 512KB SRAM",
    reason: "Optimal match for analog soil monitoring and concurrent Wi-Fi telemetry.",
    constraints: [],
  },
  {
    id: "RP2040",
    title: "Raspberry Pi RP2040",
    badgeKey: "alternative",
    core: "Dual ARM Cortex-M0+ (133MHz)",
    wireless: "None (Requires external CYW43439)",
    gpio: "30 GPIO Pins, 4x 12-bit ADC",
    flash: "2MB External Flash / 264KB SRAM",
    reason: "High PIO flexibility, but lacks native Wi-Fi/BLE radio hardware.",
    constraints: ["No integrated Wi-Fi — conflicts with wireless requirement"],
  },
  {
    id: "STM32F401",
    title: "STM32F401RE Nucleo",
    badgeKey: "industrial",
    core: "ARM Cortex-M4 with FPU (84MHz)",
    wireless: "None",
    gpio: "50 GPIO Pins, 12-bit ADC 2.4 MSPS",
    flash: "512KB Flash / 96KB SRAM",
    reason: "Ultra-reliable industrial HAL target with zero integrated wireless.",
    constraints: ["No integrated Wi-Fi", "Arduino/ESP-IDF 生态外——固件路径不同"],
  },
];

export const PERIPHERALS: Peripheral[] = [
  {
    id: "p1",
    title: "Capacitive Soil Moisture Sensor v1.2",
    type: "Analog In (ADC)",
    interface: "1x ADC Channel (0 - 3.3V)",
    pinsNeeded: "VCC (3.3V), GND, AOUT -> IO4",
    status: "Mapped to IO4",
    icon: "water_drop",
  },
  {
    id: "p2",
    title: "5V Submersible Water Pump + Relay Module",
    type: "Digital Out / PWM",
    interface: "Optocoupler Relay Driver",
    pinsNeeded: "VCC (5V), GND, IN -> IO12",
    status: "Mapped to IO12",
    icon: "valve",
    warningNote: "Requires flyback diode protection on relay coil.",
  },
  {
    id: "p3",
    title: "0.96\" Monochrome OLED Display (SSD1306)",
    type: "I2C Bus",
    interface: "I2C (Address 0x3C)",
    pinsNeeded: "VCC (3.3V), GND, SDA -> IO8, SCL -> IO9",
    status: "Mapped to I2C0",
    icon: "monitor",
  },
];

// ---------- Pin 自动分配（含 strapping 冲突） ----------

export function autoAssignPins(mcu: string): { pins: PinMapping[]; issues: PinIssue[] } {
  if (mcu === "RP2040") {
    return {
      pins: [
        { component: "Capacitive Soil Sensor", pinId: "GP26", type: "Analog", colorDot: "#3b82f6" },
        { component: "5V Pump Relay Driver", pinId: "GP15", type: "Digital", colorDot: "#ef4444" },
        { component: "OLED Display (SDA)", pinId: "GP4", type: "I2C", colorDot: "#a855f7" },
        { component: "OLED Display (SCL)", pinId: "GP5", type: "I2C", colorDot: "#a855f7" },
      ],
      issues: [],
    };
  }
  if (mcu === "STM32F401") {
    return {
      pins: [
        { component: "Capacitive Soil Sensor", pinId: "PA0", type: "Analog", colorDot: "#3b82f6" },
        { component: "5V Pump Relay Driver", pinId: "PB0", type: "Digital", colorDot: "#ef4444" },
        { component: "OLED Display (SDA)", pinId: "PB7", type: "I2C", colorDot: "#a855f7" },
        { component: "OLED Display (SCL)", pinId: "PB6", type: "I2C", colorDot: "#a855f7" },
      ],
      issues: [],
    };
  }
  // ESP32-S3 —— 自动分配把继电器放到 IO12（strapping 冲突触发点）
  return {
    pins: [
      { component: "Capacitive Soil Sensor", pinId: "IO4", type: "Analog", colorDot: "#3b82f6" },
      { component: "5V Pump Relay Driver", pinId: "IO12", type: "Digital", colorDot: "#ef4444" },
      { component: "OLED Display (SDA)", pinId: "IO8", type: "I2C", colorDot: "#a855f7" },
      { component: "OLED Display (SCL)", pinId: "IO9", type: "I2C", colorDot: "#a855f7" },
    ],
    issues: [
      {
        pinId: "IO12",
        severity: "warning",
        title: "Strapping pin conflict",
        detail:
          "IO12 is an ESP32-S3 strapping pin: pulling it high at reset forces 1.8V flash LDO configuration and can cause boot loops.",
      },
    ],
  };
}

// ---------- 固件 ----------

export function buildFirmwareCode(pin: string): string {
  return `/*
 * MCU Project Assistant Generated Firmware
 * Target: ESP32-S3 WROOM-1
 * Application: Automated Greenhouse Monitor
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>

// Pin Definitions
#define SOIL_SENSOR_PIN  4    // Analog ADC1 CH3
#define PUMP_RELAY_PIN   ${pin}   // Digital Output Relay Control
#define OLED_SDA_PIN     8    // I2C SDA
#define OLED_SCL_PIN     9    // I2C SCL

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
    Serial.begin(115200);

    // Initialize I2C with customized pins
    Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);

    pinMode(PUMP_RELAY_PIN, OUTPUT);
    digitalWrite(PUMP_RELAY_PIN, LOW); // Default off

    display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Smart Greenhouse");
    display.display();
}

void loop() {
    int moisture = analogRead(SOIL_SENSOR_PIN);
    bool dry = moisture < 1800;

    digitalWrite(PUMP_RELAY_PIN, dry ? HIGH : LOW);

    display.clearDisplay();
    display.setCursor(0, 0);
    display.print("Moisture: ");
    display.println(moisture);
    display.print("Pump: ");
    display.println(dry ? "ON" : "OFF");
    display.display();

    delay(2000);
}`;
}

export function makeFirmwareProposal(
  fromPin: string,
  toPin: string,
  versionFrom: number
): FirmwareProposal {
  const oldCode = buildFirmwareCode(fromPin);
  const newCode = buildFirmwareCode(toPin);
  return {
    id: "fw-prop-1",
    title: "Resolve GPIO Boot Conflict",
    status: "pending",
    file: "src/main.cpp",
    oldPin: `IO${fromPin}`,
    newPin: `IO${toPin}`,
    oldCode,
    newCode,
    riskTitle: "Boot Issue Risk (IO12)",
    riskDetail:
      "IO12 is an ESP32-S3 strapping pin. Pulling it high at reset forces 1.8V flash LDO configuration, potentially causing boot loops.",
    impacts: ["Wiring Diagram", "src/main.cpp", "Pin Map"],
    versionFrom,
    versionTo: versionFrom + 1,
  };
}

// ---------- Build 脚本 ----------

export const BUILD_SUCCESS_LOGS: BuildLogLine[] = [
  { text: "[BUILD] Initializing CMake toolchain for ESP32-S3 (xtensa-esp32s3-elf-g++)...", kind: "cmd" },
  { text: "[BUILD] Compiling src/main.cpp...", kind: "info" },
  { text: "[BUILD] Linking firmware elf binary (firmware.elf)...", kind: "info" },
  { text: "[BUILD] Generating esptool binary image (firmware.bin)...", kind: "info" },
  { text: "[INFO] Flash size: 8MB, App Partition: 0x10000 (1024KB)", kind: "info" },
  { text: "[BUILD SUCCESS] Memory Usage: RAM: [==--------] 22.4% (117248 bytes), Flash: [===-------] 31.8% (650112 bytes)", kind: "ok" },
];

export const BUILD_FAILURE_LOGS: BuildLogLine[] = [
  { text: "[BUILD] Initializing CMake toolchain for ESP32-S3 (xtensa-esp32s3-elf-g++)...", kind: "cmd" },
  { text: "[BUILD] Compiling src/main.cpp...", kind: "info" },
  { text: "In file included from src/main.cpp:4:", kind: "err" },
  { text: "src/main.cpp:4:10: fatal error: Adafruit_SSD1306.h: No such file or directory", kind: "err" },
  { text: "    4 | #include <Adafruit_SSD1306.h>", kind: "err" },
  { text: "      |          ^~~~~~~~~~~~~~~~~~~~", kind: "err" },
  { text: "compilation terminated.", kind: "err" },
  { text: "[BUILD FAILED] exit code 1", kind: "err" },
];

export const BUILD_DIAGNOSIS: BuildDiagnosis = {
  title: "Missing library dependency",
  cause:
    "src/main.cpp includes <Adafruit_SSD1306.h> but the OLED library is not declared in the project dependencies.",
  fix: "Add the Adafruit SSD1306 library to platformio.ini and rebuild.",
  proposal: {
    file: "platformio.ini",
    diff: `[env:esp32-s3]
 platform = espressif32
 board = esp32-s3-devkitc-1
 framework = arduino
+lib_deps =
+    adafruit/Adafruit SSD1306@^2.5.0
+    adafruit/Adafruit GFX Library@^1.11.0`,
  },
};

// ---------- Companion 串口遥测 ----------

export function makeSerialLine(moisture: number, pumpOn: boolean, t: number): string {
  return `Moisture Raw: ${moisture} (${Math.round((moisture / 4095) * 100)}%) | Pump State: ${
    pumpOn ? "ON [RELAY ACTIVE IO21]" : "OFF"
  } | Temp: ${t.toFixed(1)}C`;
}

// ---------- Discovery 流式脚本 ----------

export interface DiscoveryHooks {
  onStream: (chunk: string) => void;
  onCapability: (cap: DiscoveredRequirement) => void;
  onClarification: (c: Clarification) => void;
  onDone: (caps: DiscoveredRequirement[], props: ProposalItem[]) => void;
  onError: (msg: string) => void;
  isCancelled: () => boolean;
}

export async function runDiscoveryScript(
  prompt: string,
  hooks: DiscoveryHooks,
  opts: { slow?: boolean; fail?: boolean; partial?: boolean; providerDown?: boolean }
): Promise<void> {
  const delay = (ms: number) => sleep(opts.slow ? ms * 4 : ms);
  if (opts.providerDown) {
    await delay(600);
    hooks.onError("AI provider unreachable: connection timeout after 10s");
    return;
  }
  if (opts.fail) {
    await delay(900);
    hooks.onError("Discovery service returned HTTP 503 (model overloaded)");
    return;
  }

  for (const chunk of DISCOVERY_STREAM) {
    if (hooks.isCancelled()) return;
    hooks.onStream(chunk + "\n");
    await delay(650);
  }

  const caps = opts.partial ? DISCOVERY_CAPABILITIES.filter((c) => c.id !== "req-3") : DISCOVERY_CAPABILITIES;
  for (const cap of caps) {
    if (hooks.isCancelled()) return;
    hooks.onCapability(cap);
    await delay(opts.slow ? 800 : 350);
  }

  if (hooks.isCancelled()) return;
  if (!opts.partial) {
    hooks.onClarification(CLARIFICATION);
    return; // 澄清后由 answerClarification 继续
  }
  hooks.onDone(caps, DISCOVERY_PROPOSALS);
}

export async function finishDiscoveryAfterClarification(
  answer: string,
  hooks: Pick<DiscoveryHooks, "onDone" | "isCancelled" | "onStream">,
  opts: { slow?: boolean }
): Promise<void> {
  const delay = (ms: number) => sleep(opts.slow ? ms * 3 : ms);
  hooks.onStream(`Clarification received: "${answer}". Finalizing requirements…\n`);
  await delay(800);
  if (hooks.isCancelled()) return;
  const caps = DISCOVERY_CAPABILITIES.map((c) =>
    c.id === "req-3"
      ? { ...c, status: "complete" as const, progress: 100, isWarning: false, details: "0.96\" I2C OLED display (SSD1306) confirmed." }
      : c
  );
  hooks.onDone(caps, DISCOVERY_PROPOSALS);
}

// ---------- Build 流式脚本 ----------

export interface BuildHooks {
  onLog: (line: BuildLogLine) => void;
  onDone: (logs: BuildLogLine[], ok: boolean) => void;
  isCancelled: () => boolean;
}

export async function runBuildScript(
  fail: boolean,
  hooks: BuildHooks,
  opts: { slow?: boolean }
): Promise<void> {
  const delay = (ms: number) => sleep(opts.slow ? ms * 4 : ms);
  const logs = fail ? BUILD_FAILURE_LOGS : BUILD_SUCCESS_LOGS;
  for (const line of logs) {
    if (hooks.isCancelled()) {
      hooks.onDone([{ text: "[BUILD] Cancelled by user", kind: "warn" }], false);
      return;
    }
    hooks.onLog(line);
    await delay(500);
  }
  hooks.onDone(logs, !fail);
}
