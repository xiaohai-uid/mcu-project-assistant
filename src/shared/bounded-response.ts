import { MAX_AI_RESPONSE_BYTES, ResourceLimitError } from "./resource-limits";

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel();
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    void reader.read().then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function readBoundedResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_AI_RESPONSE_BYTES,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    if (response.body) await response.body.cancel().catch(() => undefined);
    throw new ResourceLimitError("provider_response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResourceLimitError("provider_response_too_large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}
