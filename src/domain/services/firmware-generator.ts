// domain/services/firmware-generator.ts — 固件生成器（V2 firmware/generator.py → TS REWRITE；ISSUE-008 §3/§7）
// 确定性模板 + 引脚常量注入；输出 = 提案载荷（files 映射），**不直接写版本**（I-1 Proposal Gate 无例外）。
// 继电器落在 strapping 引脚 → bootRisk + 重映射建议（IO21，冻结 UI 参考）；同输入同输出（可重放）。
export const STRAPPING_PINS = ["IO0", "IO12", "IO45", "IO46"]; // ESP32-S3 系已知启动引脚（知识常量）

export interface PinMapEntry {
  component: string;
  pinId: string;
  type: string;
}

export interface FirmwareFiles {
  "src/main.cpp": string;
  "platformio.ini": string;
}

export interface FirmwareGeneration {
  files: FirmwareFiles;
  relayPin: string | null;
  proposedRelayPin: string | null; // strapping → 建议重映射（null = 无需）
  bootRisk: boolean; // 继电器当前在 strapping 引脚
}

function pinNumber(pinId: string): string {
  return pinId.replace(/^IO/, "");
}

/** 生成完整 sketch（模板 + 引脚注入；形状对齐冻结 UI 参考代码） */
function buildSketch(soilPin: string, relayPin: string, sdaPin: string, sclPin: string, platformName: string): string {
  return `/*
 * MCU Project Assistant Generated Firmware
 * Target: ${platformName}
 * Application: Automated Greenhouse Monitor
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>

// Pin Definitions
#define SOIL_SENSOR_PIN  ${soilPin}    // Analog ADC1 CH3
#define PUMP_RELAY_PIN   ${relayPin}   // Digital Output Relay Control
#define OLED_SDA_PIN     ${sdaPin}    // I2C SDA
#define OLED_SCL_PIN     ${sclPin}    // I2C SCL

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
    Serial.begin(115200);
    Serial.println("MCU_READY");

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

const PLATFORMIO_INI = `[env:esp32s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
lib_deps =
    adafruit/Adafruit SSD1306@^2.5.10
    adafruit/Adafruit GFX Library@^1.11.9
`;

function findPin(pinMap: PinMapEntry[], match: RegExp): string | null {
  return pinMap.find((p) => match.test(p.component))?.pinId ?? null;
}

export function generateFirmware(input: {
  pinMap: PinMapEntry[];
  platform: { id: string; displayName: string };
}): FirmwareGeneration {
  const soilPin = findPin(input.pinMap, /soil/i) ?? "IO4";
  const relayPin = findPin(input.pinMap, /pump|relay/i) ?? "IO12";
  const sdaPin = findPin(input.pinMap, /\(sda\)/i) ?? "IO8";
  const sclPin = findPin(input.pinMap, /\(scl\)/i) ?? "IO9";

  const bootRisk = relayPin !== null && STRAPPING_PINS.includes(relayPin);
  // 冻结 UI 参考：strapping 冲突 → 重映射到 IO21（确定性建议；决策权在用户——Proposal）
  const proposedRelayPin = bootRisk ? "IO21" : null;
  const effectiveRelayPin = proposedRelayPin ?? relayPin ?? "IO12";

  return {
    files: {
      "src/main.cpp": buildSketch(
        pinNumber(soilPin),
        pinNumber(effectiveRelayPin),
        pinNumber(sdaPin),
        pinNumber(sclPin),
        input.platform.displayName,
      ),
      "platformio.ini": PLATFORMIO_INI,
    },
    relayPin,
    proposedRelayPin,
    bootRisk,
  };
}
