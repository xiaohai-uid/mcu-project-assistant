import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { createSseEvents } from "@/src/adapters/events/sse";
import { MAX_PROJECT_SSE_SUBSCRIBERS, ResourceLimitError } from "@/src/shared/resource-limits";

function response(write: (frame: string) => boolean = () => true): { res: Response; end: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter();
  const end = vi.fn();
  return { res: Object.assign(emitter, { write, end }) as unknown as Response, end };
}

describe("project SSE resource bounds", () => {
  it("rejects the 65th subscriber for one project", () => {
    const events = createSseEvents();
    const responses = Array.from({ length: MAX_PROJECT_SSE_SUBSCRIBERS }, () => response());
    for (const item of responses) events.subscribe("project-1", item.res);
    expect(() => events.subscribe("project-1", response().res)).toThrowError(
      new ResourceLimitError("subscriber_limit_reached"),
    );
    expect(events.subscriberCount("project-1")).toBe(MAX_PROJECT_SSE_SUBSCRIBERS);
    events.unsubscribe(responses[0]!.res);
    expect(events.subscriberCount("project-1")).toBe(MAX_PROJECT_SSE_SUBSCRIBERS - 1);
  });

  it("disconnects a subscriber that remains backpressured without affecting another project", () => {
    const events = createSseEvents();
    const blocked = response(() => false);
    const fast = response(() => true);
    events.subscribe("project-1", blocked.res);
    events.subscribe("project-2", fast.res);
    events.publish({ type: "device.flashing", projectId: "project-1", deviceId: "d", percent: 10 });
    events.publish({ type: "device.flashing", projectId: "project-1", deviceId: "d", percent: 20 });
    expect(blocked.end).toHaveBeenCalledTimes(1);
    expect(events.subscriberCount("project-1")).toBe(0);
    expect(events.subscriberCount("project-2")).toBe(1);
  });
});
