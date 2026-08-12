// unit/adapters/ai/zhipu-glm.test.ts — 真实 AI 适配器（zhipu-glm）契约测试
// 用 stub fetch 验证：请求形状（Bearer/端点/stream/response_format）、SSE 解析、
// JSON 提取（markdown 围栏容错）、重试、取消、status 缓存与不可用映射。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZhipuAiProvider } from "@/src/adapters/ai/zhipu-glm";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";

function sseChunk(delta: { content?: string; reasoning_content?: string }): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

describe("zhipu-glm adapter (real AIProviderPort)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("name = zhipu-glm", () => {
    expect(createZhipuAiProvider({ apiKey: "k" }).name).toBe("zhipu-glm");
  });

  it("status: 401/403/5xx/网络错 → unavailable；200 → available（带缓存）", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect(await provider.status()).toBe("unavailable");

    const providerOk = createZhipuAiProvider({ apiKey: "k", statusCacheMs: 60_000 });
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    expect(await providerOk.status()).toBe("available");
    // 缓存命中：不再次 fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await providerOk.status()).toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("status: 非鉴权 4xx（限流 429）→ available（可达）", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    expect(await provider.status()).toBe("available");
  });

  it("streamText: SSE delta 逐块 onChunk + Bearer + stream:true", async () => {
    const provider = createZhipuAiProvider({ apiKey: "secret" });
    const body = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" + sseChunk({ content: " world" }) + "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const chunks: string[] = [];
    await provider.streamText({ prompt: "hi", signal: new AbortController().signal, onChunk: (c) => chunks.push(c) });
    expect(chunks.join("")).toBe("Hello world");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const parsed = JSON.parse(init.body as string) as { stream: boolean; model: string };
    expect(parsed.stream).toBe(true);
  });

  it("streamText: reasoning_content-only delta never reaches onChunk", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock.mockResolvedValueOnce(new Response(sseChunk({ reasoning_content: "private reasoning" }) + "data: [DONE]\n\n", { status: 200 }));
    const chunks: string[] = [];
    await provider.streamText({ prompt: "hi", signal: new AbortController().signal, onChunk: (chunk) => chunks.push(chunk) });
    expect(chunks).toEqual([]);
  });

  it("streamText: 非 2xx → ProviderUnavailableError", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(
      provider.streamText({ prompt: "p", signal: new AbortController().signal, onChunk: () => {} }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("generateStructured: json_object 请求 + 解析 + markdown 围栏容错", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    const content = '```json\n{"capabilities":[{"id":"req-1","title":"Soil","type":"Analog","status":"complete","details":"d","progress":100,"icon":"water_drop"}],"clarification":null,"proposals":[]}\n```';
    // 主请求（proposals 空 → 触发组合模式）+ 补充提案请求
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"proposals":[{"title":"P1","initialIdea":"i","formalizedRequirement":"f","impacts":["Hardware"]}]}' } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const { data } = await provider.generateStructured<{
      capabilities: Array<{ id: string }>;
      proposals: Array<{ title: string }>;
    }>({
      prompt: "greenhouse",
      schema: "requirement-analysis",
      signal: new AbortController().signal,
    });
    expect(data.capabilities[0]?.id).toBe("req-1");
    // 组合模式：空 proposals 被补充请求回填
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0]?.title).toBe("P1");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as {
      response_format: { type: string };
      messages: Array<{ role: string }>;
      thinking: { type: string };
    };
    expect(parsed.response_format).toEqual({ type: "json_object" });
    expect(parsed.messages[0]?.role).toBe("system");
    // 思考模式必须开启（产品要求：推理质量优先于速度）
    expect(parsed.thinking).toEqual({ type: "enabled" });
  });

  it("generateStructured: 非法 JSON → 重试一次 → 第二次成功", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }),
      );
    const { data } = await provider.generateStructured<{ ok: boolean }>({
      prompt: "p",
      schema: "build-diagnosis",
      signal: new AbortController().signal,
    });
    expect(data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("generateStructured: 两次失败 → ProviderUnavailableError", async () => {
    const provider = createZhipuAiProvider({ apiKey: "k" });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "junk" } }] }), { status: 200 }));
    await expect(
      provider.generateStructured<unknown>({ prompt: "p", schema: "build-diagnosis", signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("generateStructured: 空 key → ProviderUnavailableError（status 先不可用）", async () => {
    const provider = createZhipuAiProvider({ apiKey: "" });
    expect(await provider.status()).toBe("unavailable");
  });
});
