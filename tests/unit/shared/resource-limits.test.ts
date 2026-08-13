import { describe, expect, it } from "vitest";
import {
  appendBoundedLine,
  createResourceSemaphore,
  MAX_SERIAL_HISTORY_LINES,
  ResourceLimitError,
  retainBoundedLine,
} from "@/src/shared/resource-limits";

describe("resource limit primitives", () => {
  it("uses fail-closed, non-queued leases", () => {
    const semaphore = createResourceSemaphore(2);
    const first = semaphore.tryAcquire();
    const second = semaphore.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(semaphore.tryAcquire()).toBeNull();
    expect(semaphore.activeCount()).toBe(2);
    first!.release();
    first!.release();
    expect(semaphore.activeCount()).toBe(1);
    const third = semaphore.tryAcquire();
    expect(third).not.toBeNull();
    second!.release();
    third!.release();
    expect(semaphore.activeCount()).toBe(0);
  });

  it("retains only the newest serial history lines", () => {
    const lines: string[] = [];
    for (let index = 0; index < MAX_SERIAL_HISTORY_LINES + 25; index += 1) retainBoundedLine(lines, `line-${index}`);
    expect(lines).toHaveLength(MAX_SERIAL_HISTORY_LINES);
    expect(lines[0]).toBe("line-25");
    expect(lines.at(-1)).toBe(`line-${MAX_SERIAL_HISTORY_LINES + 24}`);
  });

  it("rejects a bounded log append before mutating the buffer", () => {
    const lines: string[] = [];
    const bytes = { value: 4 };
    expect(() => appendBoundedLine(lines, "12345", bytes, 8, "process_output_limit_exceeded"))
      .toThrowError(new ResourceLimitError("process_output_limit_exceeded"));
    expect(lines).toEqual([]);
    expect(bytes.value).toBe(4);
  });
});
