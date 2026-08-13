import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeProjectEvents } from "@/app/src/api/sse";
import { createReconnectHydrationRetry } from "@/app/src/state/reconnect-hydration";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  onerror: ((event: unknown) => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

afterEach(() => {
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SSE reconnect hydration hook", () => {
  it("ignores initial open and requests exactly one durable rehydration per reconnect", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onReconnect = vi.fn();
    const onEvent = vi.fn();
    const close = subscribeProjectEvents("project-1", { onEvent, onReconnect });
    const source = FakeEventSource.instances[0]!;

    source.onopen?.();
    expect(onReconnect).not.toHaveBeenCalled();
    source.onopen?.();
    source.onopen?.();
    expect(onReconnect).toHaveBeenCalledTimes(2);

    source.emit("requirement.analysis.completed", { capabilities: [] });
    expect(onEvent).toHaveBeenCalledWith("requirement.analysis.completed", { capabilities: [] });
    close();
    expect(source.closed).toBe(true);
  });
});

describe("bounded reconnect hydration retry", () => {
  it("retries after a transient hydration failure and stops after success", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const retry = createReconnectHydrationRetry(hydrate);

    retry.request("project-1");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(hydrate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it("uses increasing capped delays instead of a tight retry loop", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn().mockResolvedValue(false);
    const retry = createReconnectHydrationRetry(hydrate, { delaysMs: [100, 250, 500] });

    retry.request("project-1");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(hydrate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hydrate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(hydrate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(hydrate).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(hydrate).toHaveBeenCalledTimes(4);
  });

  it("does not start a parallel loop for repeated reconnect signals", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn().mockResolvedValue(false);
    const retry = createReconnectHydrationRetry(hydrate);

    retry.request("project-1");
    retry.request("project-1");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(hydrate).toHaveBeenCalledTimes(2);
  });

  it("cancels the old project loop and its pending timer", async () => {
    vi.useFakeTimers();
    const hydrate = vi.fn().mockResolvedValue(false);
    const retry = createReconnectHydrationRetry(hydrate);

    retry.request("project-1");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledWith("project-1", expect.any(AbortSignal)));
    retry.request("project-2");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledWith("project-2", expect.any(AbortSignal)));
    await vi.advanceTimersByTimeAsync(100);
    expect(hydrate.mock.calls.filter(([id]) => id === "project-1")).toHaveLength(1);
    expect(hydrate.mock.calls.filter(([id]) => id === "project-2")).toHaveLength(2);
  });

  it("aborts an in-flight hydration when cleanup cancels the retry", async () => {
    const hydrate = vi.fn((_projectId: string, signal: AbortSignal) => new Promise<boolean>((resolve) => {
      signal.addEventListener("abort", () => resolve(false), { once: true });
    }));
    const retry = createReconnectHydrationRetry(hydrate);

    retry.request("project-1");
    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledTimes(1));
    const signal = hydrate.mock.calls[0]![1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    retry.cancel();
    expect(signal.aborted).toBe(true);
  });
});
