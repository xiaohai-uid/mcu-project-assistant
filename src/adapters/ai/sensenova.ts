// adapters/ai/sensenova.ts — AIProviderPort → SenseNova OpenAI-compatible adapter
// Production selection is explicit in infrastructure/ai-provider.ts; there is no fallback.
import type { AIProviderPort, ProviderStatus, StreamTextRequest, StructuredRequest } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";

export interface SenseNovaAiProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** status() probe cache in milliseconds. */
  statusCacheMs?: number;
  timeoutMs?: number;
}

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
- proposals: REQUIRED, at least 2, at most 5 formalized technical requirements derived from the description (each with a concrete formal spec and impacted domains). Never return an empty proposals array.`,
  "build-diagnosis": `You are an embedded firmware build diagnostician. A PlatformIO/Arduino build of the firmware failed. Return ONLY valid JSON (no markdown, no code fences) matching exactly:
{
  "cause": string,
  "fix": string,
  "file": "platformio.ini",
  "diff": string
}
The diff is a unified-diff fragment applied to the file (lines starting with + are added).`,
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    if (start < 0) throw new Error("no JSON object in response");
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const ch = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return JSON.parse(trimmed.slice(start, index + 1));
      }
    }
    throw new Error("unbalanced JSON in response");
  }
}

export function createSenseNovaAiProvider(opts: SenseNovaAiProviderOptions): AIProviderPort {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const probeBody = { model: opts.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  const workBody = { thinking: { type: "enabled" } };
  let lastStatusAt = 0;
  let lastStatus: ProviderStatus = "unavailable";

  async function chat(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function probe(): Promise<ProviderStatus> {
    if (!opts.apiKey) return "unavailable";
    try {
      const response = await chat(probeBody, new AbortController().signal);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403 || response.status >= 500) return "unavailable";
        console.warn(`[sensenova] probe failed ${response.status}: ${body.slice(0, 200)}`);
      }
      return "available";
    } catch {
      return "unavailable";
    }
  }

  return {
    name: "sensenova",

    async status(): Promise<ProviderStatus> {
      const now = Date.now();
      const cacheMs = opts.statusCacheMs ?? 60_000;
      if (now - lastStatusAt < cacheMs) return lastStatus;
      lastStatus = await probe();
      lastStatusAt = Date.now();
      return lastStatus;
    },

    async streamText(req: StreamTextRequest): Promise<void> {
      const response = await chat(
        {
          ...workBody,
          model: opts.model,
          messages: [{ role: "user", content: req.prompt }],
          stream: true,
          max_tokens: 2048,
        },
        req.signal,
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderUnavailableError(`sensenova HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
      if (!response.body) throw new ProviderUnavailableError("sensenova: empty stream body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") break;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
              };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content && !req.signal.aborted) req.onChunk(content);
            } catch {
              // Ignore malformed SSE frames; the provider's final response remains authoritative.
            }
          }
          if (req.signal.aborted) throw new Error("aborted");
        }
      } finally {
        reader.releaseLock();
      }
    },

    async generateStructured<T>(req: StructuredRequest): Promise<{ data: T }> {
      const schemaPrompt = SCHEMA_PROMPTS[req.schema];
      if (!schemaPrompt) throw new Error(`unknown schema: ${req.schema}`);

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (req.signal.aborted) throw new Error("aborted");
        try {
          const response = await chat(
            {
              ...workBody,
              model: opts.model,
              messages: [
                { role: "system", content: schemaPrompt },
                { role: "user", content: req.prompt },
              ],
              response_format: { type: "json_object" },
              max_tokens: 4096,
            },
            req.signal,
          );
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new ProviderUnavailableError(`sensenova HTTP ${response.status}: ${body.slice(0, 200)}`);
          }
          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
          };
          const content = payload.choices?.[0]?.message?.content?.trim();
          if (!content) throw new Error("empty assistant content");
          const parsed = extractJson(content) as T;
          if (parsed == null || (typeof parsed === "object" && Object.keys(parsed as object).length === 0)) {
            throw new Error("empty JSON object");
          }
          return { data: parsed };
        } catch (error) {
          if (error instanceof ProviderUnavailableError) throw error;
          lastError = error;
        }
      }
      throw new ProviderUnavailableError(`sensenova structured output failed: ${String(lastError)}`);
    },
  };
}
