import { describe, expect, it } from "vitest";
import { latestTask, mergeTaskTruth, parseAnalysisCapabilities, parseFlashTruth } from "@/app/src/state/hydration";
import type { TaskDto } from "@/app/src/api/client";

const task = (patch: Partial<TaskDto>): TaskDto => ({
  id: "task-1",
  capability: "analyze_requirement",
  input: JSON.stringify({ projectId: "project-1" }),
  status: "running",
  createdAt: "2026-08-12T00:00:00.000Z",
  startedAt: "2026-08-12T00:00:01.000Z",
  completedAt: null,
  error: null,
  output: null,
  ...patch,
});

describe("refresh hydration truth helpers", () => {
  it("terminal live truth wins over a late running refresh, in either event order", () => {
    const completed = task({ status: "completed", completedAt: "2026-08-12T00:00:05.000Z", output: '{"capabilities":[]}' });
    const running = task({ status: "running", completedAt: null });
    expect(mergeTaskTruth(completed, running)?.status).toBe("completed");
    expect(mergeTaskTruth(running, completed)?.status).toBe("completed");
  });

  it("does not enum-sort conflicting terminal truth", () => {
    const failed = task({ status: "failed", completedAt: "2026-08-12T00:00:03.000Z", error: "failed" });
    const cancelled = task({ status: "cancelled", completedAt: "2026-08-12T00:00:04.000Z" });
    expect(mergeTaskTruth(failed, cancelled)?.status).toBe("cancelled");
    expect(mergeTaskTruth(cancelled, failed)?.status).toBe("cancelled");
  });

  it("selects the newest task per capability and restores durable analysis output", () => {
    const old = task({ id: "old", createdAt: "2026-08-11T00:00:00.000Z" });
    const newest = task({ id: "new", status: "completed", createdAt: "2026-08-12T00:00:00.000Z", output: JSON.stringify({ capabilities: [{ id: "req-1", title: "Moisture", type: "sensor", status: "complete", details: "durable", progress: 100, icon: "water_drop" }] }) });
    expect(latestTask([old, newest], "analyze_requirement")?.id).toBe("new");
    expect(parseAnalysisCapabilities(newest.output)).toHaveLength(1);
  });

  it("accepts durable flash truth but never turns it into a live session", () => {
    const truth = { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "companion-local" };
    expect(parseFlashTruth(JSON.stringify({ truth }))).toEqual(truth);
    expect(parseFlashTruth(null)).toBeNull();
  });
});
