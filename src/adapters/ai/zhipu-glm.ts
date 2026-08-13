// adapters/ai/zhipu-glm.ts — AIProviderPort → 智谱 GLM 真实适配器（揭露真实数据；2026-08-12）
// OpenAI 兼容端点 https://open.bigmodel.cn/api/paas/v4（模型 glm-4.5-flash）。
// streamText → SSE 流式；generateStructured → response_format json_object + schema 契约 prompt。
// 无 fallback：status() 不可用即 unavailable（调用方合法降级）；生产单一路径由 server.ts 显式注入。
import type { AIProviderPort, ProviderStatus, StreamTextRequest, StructuredRequest } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";

function providerErrorForStatus(status: number): ProviderUnavailableError {
  if (status === 408 || status === 504) return new ProviderUnavailableError("AI provider request timed out", "provider_timeout");
  if (status === 429) return new ProviderUnavailableError("AI provider rate limit or quota exceeded", "provider_rate_limited");
  if (status >= 500 || status === 401 || status === 403) return new ProviderUnavailableError("AI provider is unavailable", "provider_unavailable");
  return new ProviderUnavailableError("AI provider returned an invalid response", "provider_protocol_error");
}

export interface ZhipuAiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** status() 探测缓存（毫秒；避免每次分析消耗配额） */
  statusCacheMs?: number;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4.5-flash";

function timedSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; didTimeout: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

/** schema → 系统提示模板（领域契约形状；见 shared-contracts/types.ts） */
const SCHEMA_PROMPTS: Record<string, string> = {
  "requirement-analysis": `You are an embedded-systems requirements engineer. Analyze the user's project description and return ONLY valid JSON (no markdown, no code fences) matching exactly:
{
  "capabilities": [ { "id": "req-N", "title": string, "type": "Analog|Digital|I2C|PWM|Relay/PWM|OLED?|Power|Wireless|...", "status": "complete|partial|pending", "details": string, "progress": number 0-100, "icon": "water_drop|valve|monitor|battery_charging_full|...", "isWarning"?: boolean } ],
  "clarification": { "question": string, "detail"?: string } | null,
  "proposals": [ { "title": string, "initialIdea": string, "formalizedRequirement": string, "impacts": string[], "isNew"?: boolean } ]
}
Rules:
- capabilities: 3-6 entries, one per distinct hardware capability extracted from the description.
- clarification: non-null ONLY if a critical spec is ambiguous (e.g. display size); at most one question. Otherwise null.
- proposals: **REQUIRED, at least 2, at most 5** formalized technical requirements derived from the description (each with a concrete formal spec and impacted domains). The product flow depends on proposals existing — never return an empty proposals array.

Example output shape:
{
  "capabilities": [
    {"id":"req-1","title":"Soil moisture sensing","type":"Analog","status":"complete","details":"Capacitive soil moisture sensor on an ADC pin.","progress":100,"icon":"water_drop"}
  ],
  "clarification": null,
  "proposals": [
    {"title":"Wireless connectivity","initialIdea":"Publish readings over Wi-Fi.","formalizedRequirement":"System must support 802.11 b/g/n for remote telemetry publishing.","impacts":["Hardware","Firmware"]},
    {"title":"Power management","initialIdea":"Powered from USB or battery.","formalizedRequirement":"System must accept 5V USB-C power with stable 3.3V rail.","impacts":["Power Budget"]}
  ]
}`,
  "build-diagnosis": `You are an embedded firmware build diagnostician. A PlatformIO/Arduino build of the firmware failed. Return ONLY valid JSON (no markdown) matching exactly:
{
  "cause": string,
  "fix": string,
  "file": "platformio.ini",
  "diff": string
}
The diff is a unified-diff fragment applied to the file (lines starting with + are added). If the likely fix is adding a library dependency, produce diff lines such as:
+
+lib_deps =
+    adafruit/Adafruit SSD1306@^2.5.10`,
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 模型偶尔包 markdown 围栏或前缀说明 → 提取首个 { ... } 平衡块
    const start = trimmed.indexOf("{");
    if (start < 0) throw new Error("no JSON object in response");
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
      }
    }
    throw new Error("unbalanced JSON in response");
  }
}

export function createZhipuAiProvider(opts: ZhipuAiProviderOptions): AIProviderPort {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  // reasoning 模型（思考模式开启）生成慢：120s 起，可通过 opts.timeoutMs 调大
  const timeoutMs = opts.timeoutMs ?? 240_000;

  /** 探测请求（可达性探测，非内容生成：不消耗推理预算） */
  const PROBE_BODY = { model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 };

  /** 结构化/流式请求：思考模式必须开启（产品要求——推理质量优先于速度；
   * 真实代价：reasoning_content 占 token 预算 + 耗时上升，由 timeoutMs/max_tokens 承载） */
  const WORK_BODY = { thinking: { type: "enabled" } };
  let lastStatusAt = 0;
  let lastStatus: ProviderStatus = "unavailable";

  async function chat(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).catch((error: unknown) => {
        if (timedOut) throw new ProviderUnavailableError("AI provider request timed out", "provider_timeout");
        if (signal.aborted) throw error;
        throw new ProviderUnavailableError("AI provider is unavailable", "provider_unavailable");
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function probe(): Promise<ProviderStatus> {
    if (!opts.apiKey) return "unavailable";
    // max_tokens=1 极小探测（status 缓存内只探测一次）
    try {
      const res = await chat(PROBE_BODY, new AbortController().signal);
      if (!res.ok) {
        await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) return "unavailable";
        if (res.status >= 500) return "unavailable";
        console.warn(`[zhipu-glm] probe failed status=${res.status}`);
        return "available"; // 4xx 非鉴权错误（如限流）仍视为可达
      }
      return "available";
    } catch {
      return "unavailable";
    }
  }

  return {
    name: "zhipu-glm",

    async status(): Promise<ProviderStatus> {
      const now = Date.now();
      const cacheMs = opts.statusCacheMs ?? 60_000;
      if (now - lastStatusAt < cacheMs) return lastStatus;
      lastStatus = await probe();
      lastStatusAt = Date.now();
      return lastStatus;
    },

    async streamText(req: StreamTextRequest): Promise<void> {
      const operation = timedSignal(req.signal, timeoutMs);
      try {
      const res = await chat(
        {
          ...WORK_BODY,
          model,
          messages: [{ role: "user", content: req.prompt }],
          stream: true,
          max_tokens: 2048,
        },
        operation.signal,
      );
      if (!res.ok) {
        await res.text().catch(() => "");
        throw providerErrorForStatus(res.status);
      }
      if (!res.body) throw new ProviderUnavailableError("AI provider returned an invalid response", "provider_protocol_error");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawValidFrame = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
              };
              sawValidFrame = true;
              const delta = parsed.choices?.[0]?.delta;
              const text = delta?.content ?? "";
              if (text && !req.signal.aborted) req.onChunk(text);
            } catch {
              // 忽略畸形帧
            }
          }
          if (req.signal.aborted) throw new Error("aborted");
        }
        if (operation.didTimeout()) throw new ProviderUnavailableError("AI provider request timed out", "provider_timeout");
      } finally {
        reader.releaseLock();
      }
      if (!sawValidFrame) throw new ProviderUnavailableError("AI provider returned an invalid response", "provider_protocol_error");
      } catch (error) {
        if (operation.didTimeout()) throw new ProviderUnavailableError("AI provider request timed out", "provider_timeout");
        throw error;
      } finally {
        operation.dispose();
      }
    },

    async generateStructured<T>(req: StructuredRequest): Promise<{ data: T }> {
      const schemaPrompt = SCHEMA_PROMPTS[req.schema];
      if (!schemaPrompt) throw new Error(`unknown schema: ${req.schema}`);

      // 一次重试（模型偶发输出非法 JSON / 空结果）
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (req.signal.aborted) throw new Error("aborted");
        const operation = timedSignal(req.signal, timeoutMs);
        try {
          const res = await chat(
            {
              ...WORK_BODY,
              model,
              messages: [
                { role: "system", content: schemaPrompt },
                { role: "user", content: req.prompt },
              ],
              response_format: { type: "json_object" },
              max_tokens: 4096,
            },
            operation.signal,
          );
          if (!res.ok) {
            await res.text().catch(() => "");
            throw providerErrorForStatus(res.status);
          }
          const payload = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content;
          if (!content) throw new Error("empty assistant content");
          const parsed = extractJson(content) as T;
          if (parsed == null || (typeof parsed === "object" && Object.keys(parsed as object).length === 0)) {
            throw new Error("empty JSON object");
          }
          // 组合模式：requirement-analysis 若模型缺省/空 proposals（实测 glm-4.5-flash 常见——
          // 主请求倾向省略字段或给空数组；单独聚焦请求则稳定产出），补一次请求（仍纯 AI 输出）
          if (
            req.schema === "requirement-analysis" &&
            ((parsed as { proposals?: unknown[] }).proposals == null ||
              (parsed as { proposals?: unknown[] }).proposals!.length === 0)
          ) {
            const extra = await chat(
              {
                ...WORK_BODY,
                model,
                messages: [
                  {
                    role: "system",
                    content:
                      "You are an embedded-systems requirements engineer. List the formalized technical requirements for the given project description. Return ONLY valid JSON: {\"proposals\":[{\"title\":string,\"initialIdea\":string,\"formalizedRequirement\":string,\"impacts\":string[],\"isNew\"?:boolean}]} with at least 2 and at most 5 entries. Example: {\"proposals\":[{\"title\":\"Wireless connectivity\",\"initialIdea\":\"Publish readings over Wi-Fi.\",\"formalizedRequirement\":\"System must support 802.11 b/g/n for remote telemetry publishing.\",\"impacts\":[\"Hardware\",\"Firmware\"]}]}",
                  },
                  { role: "user", content: req.prompt },
                ],
                response_format: { type: "json_object" },
                max_tokens: 2048,
              },
              operation.signal,
            );
            if (!extra.ok) {
              await extra.text().catch(() => "");
              throw providerErrorForStatus(extra.status);
            }
            const extraPayload = (await extra.json()) as { choices?: Array<{ message?: { content?: string } }> };
            const extraContent = extraPayload.choices?.[0]?.message?.content;
            if (extraContent) {
              const extraParsed = extractJson(extraContent) as { proposals?: unknown[] };
              if (extraParsed?.proposals && extraParsed.proposals.length > 0) {
                (parsed as unknown as { proposals: unknown[] }).proposals = extraParsed.proposals;
              }
            }
          }
          return { data: parsed };
        } catch (err) {
          if (err instanceof ProviderUnavailableError) throw err;
          if (operation.didTimeout()) throw new ProviderUnavailableError("AI provider request timed out", "provider_timeout");
          lastErr = err;
        } finally {
          operation.dispose();
        }
      }
      void lastErr;
      throw new ProviderUnavailableError("AI provider returned an invalid response", "provider_protocol_error");
    },
  };
}
