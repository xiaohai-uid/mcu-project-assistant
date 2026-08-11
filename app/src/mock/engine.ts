// ============================================================
// 前端静态数据与工具 — Progressive Swap 完成态（S10）
// 生产数据路径全部走真实 HTTP/SSE API（src/adapters/http/app.ts）。
// 此处仅保留与后端无关的 UI 常量（模板/默认提示/工具函数）。
// 历史 mock 脚本（INITIAL_PROJECTS/DISCOVERY_PROPOSALS/autoAssignPins/
// buildFirmwareCode/makeFirmwareProposal/BUILD_*/runBuildScript 等）已在
// S1-S9 换真实 Capability 后删除（ISSUE-012 §3）。
// ============================================================

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- 首页模板 ----------

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

// ---------- 需求解析默认提示 ----------

export const DEFAULT_PROMPT =
  "I want to build an automated greenhouse monitor that measures soil moisture, drives a 5V water pump relay, displays telemetry on an OLED screen, and publishes readings over Wi-Fi.";
