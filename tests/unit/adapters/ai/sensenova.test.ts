// unit/adapters/ai/sensenova — SenseNova OpenAI-compatible adapter contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSenseNovaAiProvider } from "@/src/adapters/ai/sensenova";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";

function sseChunk(delta: { content?: string; reasoning_content?: string }): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

describe("sensenova adapter (real AIProviderPort)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exposes the provider name and uses the configured endpoint/model", async () => {
    const provider = createSenseNovaAiProvider({
      apiKey: "secret",
      baseUrl: "https://sensenova.example/v1",
      model: "deepseek-v4-flash",
    });
    expect(provider.name).toBe("sensenova");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    expect(await provider.status()).toBe("available");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://sensenova.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "deepseek-v4-flash", max_tokens: 1 });
  });

  it("streamText emits final content and never leaks reasoning_content", async () => {
    const provider = createSenseNovaAiProvider({ apiKey: "k", baseUrl: "https://example/v1", model: "m" });
    const body = sseChunk({ reasoning_content: "private reasoning" }) + sseChunk({ content: "final" }) + "data: [DONE]\n\n";
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const chunks: string[] = [];

    await provider.streamText({ prompt: "hi", signal: new AbortController().signal, onChunk: (chunk) => chunks.push(chunk) });

    expect(chunks).toEqual(["final"]);
  });

  it("generateStructured parses message.content and ignores reasoning_content", async () => {
    const provider = createSenseNovaAiProvider({ apiKey: "k", baseUrl: "https://example/v1", model: "m" });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}', reasoning_content: "private reasoning" } }] }), {
        status: 200,
      }),
    );

    const result = await provider.generateStructured<{ ok: boolean }>({
      prompt: "p",
      schema: "build-diagnosis",
      signal: new AbortController().signal,
    });

    expect(result.data).toEqual({ ok: true });
  });

  it("rejects empty final content even when reasoning_content is present", async () => {
    const provider = createSenseNovaAiProvider({ apiKey: "k", baseUrl: "https://example/v1", model: "m" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "private reasoning" } }] }), {
        status: 200,
      }),
    );

    await expect(
      provider.generateStructured({
        prompt: "p",
        schema: "build-diagnosis",
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps non-2xx work responses to ProviderUnavailableError", async () => {
    const provider = createSenseNovaAiProvider({ apiKey: "k", baseUrl: "https://example/v1", model: "m" });
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));

    await expect(
      provider.streamText({ prompt: "p", signal: new AbortController().signal, onChunk: () => {} }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("bounds a streaming response whose body never reaches DONE", async () => {
    const provider = createSenseNovaAiProvider({ apiKey: "k", baseUrl: "https://example/v1", model: "m", timeoutMs: 20 });
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseChunk({ reasoning_content: "still thinking" })));
      },
    }), { status: 200 }));

    await expect(
      provider.streamText({ prompt: "p", signal: new AbortController().signal, onChunk: () => {} }),
    ).rejects.toMatchObject({ message: expect.stringContaining("timed out") });
  });
});
