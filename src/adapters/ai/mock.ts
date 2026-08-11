// adapters/ai/mock.ts — AIProviderPort → Mock 适配器（ADR-0010；ISSUE-003 §3/§5）
// 冻结 UI 脚本数据（app/src/mock/engine.ts 的 DISCOVERY_*）迁移到本文件 = 行为契约源；
// Mock 适配器贯穿开发与测试（State Lab 同源）。真实 provider 适配器留待后续 Slice。
// hint（lab 注入：slow/fail/partial/providerDown）仅供开发 harness 使用；生产适配器忽略未知字段。
import type { AIProviderPort, ProviderStatus, StreamTextRequest, StructuredRequest } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import type { AnalysisCapabilityDto, RequirementAnalysisOutput } from "@/src/shared-contracts/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- 冻结脚本数据（行为契约源；原 app/src/mock/engine.ts DISCOVERY_*） ----------

const DISCOVERY_STREAM = [
  "Parsing project description…",
  "Detected analog sensing requirement (soil moisture).",
  "Detected digital output requirement (relay driver).",
  "Checking I2C bus availability for display module…",
  "Analyzing power budget: 5V USB vs LiPo + TP4056.",
  "Evaluating wireless connectivity options (Wi-Fi / BLE).",
  "Formalizing specifications…",
];

const CAPABILITIES: AnalysisCapabilityDto[] = [
  {
    id: "req-1",
    title: "Soil moisture monitoring",
    type: "Analog",
    status: "complete",
    details: "Capacitive soil moisture sensor mapped to ADC pin IO4.",
    progress: 100,
    icon: "water_drop",
  },
  {
    id: "req-2",
    title: "Water pump control",
    type: "Relay/PWM",
    status: "complete",
    details: "5V relay switch driven via transistor/MOSFET on IO12.",
    progress: 100,
    icon: "valve",
  },
  {
    id: "req-3",
    title: "Local status display",
    type: "OLED?",
    status: "pending",
    details: "Pending confirmation for 0.96 inch I2C OLED display (SDA: IO8, SCL: IO9).",
    progress: 60,
    icon: "monitor",
    isWarning: true,
  },
  {
    id: "req-4",
    title: "Battery/Power management",
    type: "Power",
    status: "complete",
    details: "Requires 5V USB-C power or 3.7V LiPo with TP4056 charging IC.",
    progress: 100,
    icon: "battery_charging_full",
  },
];

const CLARIFICATION = {
  question: "Which display size do you need?",
  detail: '0.96" (128x64, SSD1306) is the most common. 1.3" (SH1106) is also available.',
};

export interface MockAiProviderOptions {
  slow?: boolean;
  /** lab：下一次解析失败（503 model overloaded） */
  failNext?: boolean;
  /** lab：部分解析（req-3 pending）→ 走澄清 */
  partialNext?: boolean;
  /** lab：provider 不可用 */
  providerDown?: boolean;
}

function hintOf(opts: MockAiProviderOptions, hint?: Record<string, unknown>): MockAiProviderOptions {
  return {
    slow: (hint?.slow as boolean | undefined) ?? opts.slow,
    failNext: (hint?.failNext as boolean | undefined) ?? opts.failNext,
    partialNext: (hint?.partialNext as boolean | undefined) ?? opts.partialNext,
    providerDown: (hint?.providerDown as boolean | undefined) ?? opts.providerDown,
  };
}

export function createMockAiProvider(opts: MockAiProviderOptions = {}): AIProviderPort {
  return {
    async status(): Promise<ProviderStatus> {
      return opts.providerDown ? "unavailable" : "available";
    },

    async streamText(req: StreamTextRequest): Promise<void> {
      const o = hintOf(opts, req.hint);
      const delay = (ms: number) => sleep(o.slow ? ms * 4 : ms);
      if (o.providerDown) {
        await delay(100);
        throw new ProviderUnavailableError("AI provider unreachable: connection timeout");
      }
      if (o.failNext) {
        await delay(150);
        throw new ProviderUnavailableError("Discovery service returned HTTP 503 (model overloaded)");
      }
      for (const chunk of DISCOVERY_STREAM) {
        if (req.signal.aborted) throw new Error("aborted");
        req.onChunk(chunk);
        await delay(30);
      }
    },

    async generateStructured<T>(req: StructuredRequest): Promise<{ data: T }> {
      const o = hintOf(opts, req.context);
      if (req.signal.aborted) throw new Error("aborted");
      if (o.providerDown || o.failNext) throw new ProviderUnavailableError("provider unavailable");

      if (req.schema === "requirement-analysis") {
        const roundId = (req.context?.roundId as number | undefined) ?? 0;
        const capabilities = CAPABILITIES.map((c) =>
          c.id === "req-3"
            ? roundId > 0
              ? {
                  ...c,
                  status: "complete" as const,
                  details: '0.96" I2C OLED display (SSD1306) confirmed.',
                }
              : c
            : c,
        );
        const output: RequirementAnalysisOutput = {
          capabilities,
          clarification: roundId === 0 && !o.partialNext ? CLARIFICATION : null,
        };
        return { data: output as T };
      }
      throw new Error(`unknown schema: ${req.schema}`);
    },
  };
}
