import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeProjectEvents } from "@/app/src/api/sse";

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
