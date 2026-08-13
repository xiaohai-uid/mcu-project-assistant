// shared/resource-limits.ts — process-local resource safety contract.

export const MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REQUIREMENT_CHARS = 256 * 1024;
export const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
export const MAX_BUILD_LOG_BYTES = 2 * 1024 * 1024;
export const MAX_FLASH_EVIDENCE_BYTES = 1024 * 1024;
export const MAX_SERIAL_WRITE_BYTES = 64 * 1024;
export const MAX_SERIAL_HISTORY_LINES = 1_000;
export const MAX_PROJECT_SSE_SUBSCRIBERS = 64;
export const MAX_SERIAL_SUBSCRIBERS = 16;
export const MAX_CONCURRENT_ANALYZE = 4;
export const MAX_CONCURRENT_BUILD = 2;

export class ResourceLimitError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "ResourceLimitError";
    this.code = code;
  }
}

export interface ResourceLease {
  release(): void;
}

/** Fail-closed process-local capacity limiter. It never queues waiters. */
export function createResourceSemaphore(capacity: number): {
  tryAcquire(): ResourceLease | null;
  activeCount(): number;
} {
  let active = 0;
  return {
    tryAcquire(): ResourceLease | null {
      if (active >= capacity) return null;
      active += 1;
      let released = false;
      return {
        release(): void {
          if (released) return;
          released = true;
          active -= 1;
        },
      };
    },
    activeCount(): number {
      return active;
    },
  };
}

export function retainBoundedLine(lines: string[], line: string, maxLines = MAX_SERIAL_HISTORY_LINES): void {
  lines.push(line);
  if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
}

export function assertUtf8Bytes(value: string, maxBytes: number, code: string): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ResourceLimitError(code);
  }
}

export function appendBoundedLine(
  lines: string[],
  line: string,
  currentBytes: { value: number },
  maxBytes: number,
  code: string,
): void {
  const bytes = Buffer.byteLength(`${line}\n`, "utf8");
  if (currentBytes.value + bytes > maxBytes) throw new ResourceLimitError(code);
  lines.push(line);
  currentBytes.value += bytes;
}
