import { EventEmitter } from "node:events";
import type { Response } from "express";
import { describe, expect, it } from "vitest";
import { createSseEvents } from "@/src/adapters/events/sse";

function responseFixture(): Response & { ended: boolean } {
  const response = new EventEmitter() as unknown as Response & { ended: boolean };
  response.ended = false;
  Object.defineProperty(response, "writableEnded", { get: () => response.ended });
  (response as unknown as { end: () => Response }).end = () => { response.ended = true; response.emit("close"); return response; };
  return response;
}

describe("project SSE shutdown", () => {
  it("closes every subscriber and rejects no future state from the registry", () => {
    const events = createSseEvents();
    const first = responseFixture();
    const second = responseFixture();
    events.subscribe("project-1", first);
    events.subscribe("project-2", second);
    expect(events.subscriberCount()).toBe(2);

    events.closeAll();

    expect(first.ended).toBe(true);
    expect(second.ended).toBe(true);
    expect(events.subscriberCount()).toBe(0);
  });
});
