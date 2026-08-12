import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import { createFlashTokenStore } from "@/src/application/capabilities/flash";
import { createProject } from "@/src/domain/models/project";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import type { DevicePort } from "@/src/ports/device";
import type { EventPort } from "@/src/ports/events";
import type { TaskRecord } from "@/src/ports/task-execution";

const events: EventPort = { publish: () => undefined };
const openResources: Array<{ db: SqliteDb; dir: string }> = [];

afterEach(() => {
  for (const resource of openResources.splice(0)) {
    try {
      resource.db.close();
    } catch {
      // already closed by the test
    }
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "mcu-task-recovery-"));
  const db = openDatabase(join(dir, "test.db"));
  migrate(db);
  openResources.push({ db, dir });
  return createProjectStore(db);
}

function task(id: string, status: TaskRecord["status"] = "queued"): TaskRecord {
  return {
    id,
    capability: "test_recovery",
    input: JSON.stringify({ id }),
    status,
    createdAt: `2026-08-12T00:00:0${id.slice(-1)}Z`,
    startedAt: status === "queued" ? null : "2026-08-12T00:00:01Z",
    completedAt: ["completed", "failed", "cancelled"].includes(status) ? "2026-08-12T00:00:02Z" : null,
    error: status === "failed" ? "previous failure" : null,
    output: null,
  };
}

async function waitForTerminal(tasks: ReturnType<typeof createInProcessTasks>, id: string): Promise<TaskRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await tasks.getTask(id);
    if (current && ["completed", "failed", "cancelled"].includes(current.status)) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`task ${id} did not reach a terminal state`);
}

describe("durable in-process task recovery", () => {
  it("claims queued and orphaned running tasks and executes each exactly once", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => {
      uow.saveTask(task("t1"));
      uow.saveTask(task("t2", "running"));
    });
    const executed: string[] = [];
    const tasks = createInProcessTasks({
      persistence,
      events,
      executeTask: async (record, ctx) => {
        executed.push(record.id);
        await ctx.setOutput(`recovered:${record.id}`);
      },
    });

    await expect(tasks.recover()).resolves.toEqual({ recovered: 2, failed: 0 });
    await tasks.waitForIdle();
    expect(executed).toEqual(["t1", "t2"]);
    expect((await tasks.getTask("t1"))?.status).toBe("completed");
    expect((await tasks.getTask("t2"))?.status).toBe("completed");
    expect((await tasks.getTask("t2"))?.output).toBe("recovered:t2");
  });

  it("never claims terminal tasks", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => {
      uow.saveTask(task("t1", "completed"));
      uow.saveTask(task("t2", "failed"));
      uow.saveTask(task("t3", "cancelled"));
    });
    let calls = 0;
    const tasks = createInProcessTasks({ persistence, events, executeTask: async () => { calls += 1; } });

    await expect(tasks.recover()).resolves.toEqual({ recovered: 0, failed: 0 });
    expect(calls).toBe(0);
  });

  it("persists a recovered executor throw as failed", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => uow.saveTask(task("t1")));
    const tasks = createInProcessTasks({
      persistence,
      events,
      executeTask: async () => {
        throw new Error("controlled recovery failure");
      },
    });

    await expect(tasks.recover()).resolves.toEqual({ recovered: 1, failed: 0 });
    await tasks.waitForIdle();
    const recovered = await tasks.getTask("t1");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toBe("controlled recovery failure");
  });

  it("keeps the normal new-task execution path intact", async () => {
    const persistence = freshStore();
    const tasks = createInProcessTasks({
      persistence,
      events,
      executeTask: async (_task, ctx) => { await ctx.setOutput("normal-output"); },
    });
    const id = await tasks.submit({ capability: "normal", input: "{}" });

    const completed = await waitForTerminal(tasks, id);
    expect(completed.status).toBe("completed");
    expect(completed.output).toBe("normal-output");
  });

  it("atomically gives one concurrent claimant the only task", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => uow.saveTask(task("t1")));
    const [first, second] = await Promise.all([
      persistence.withTransaction((uow) => uow.claimNextTask()),
      persistence.withTransaction((uow) => uow.claimNextTask()),
    ]);

    expect([first?.id ?? null, second?.id ?? null].filter(Boolean)).toEqual(["t1"]);
    expect([first, second].filter((claim) => claim === null)).toHaveLength(1);
  });

  it("reconstructs analyze_requirement from persisted JSON through the same executor", async () => {
    const persistence = freshStore();
    const project = createProject("recovery-analysis", () => new Date("2026-08-12T00:00:00.000Z"));
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.saveTask({
        ...task("analysis-1"),
        capability: "analyze_requirement",
        input: JSON.stringify({ projectId: project.id, description: "Measure soil moisture", lab: {} }),
      });
    });
    const ai: AIProviderPort = {
      name: "recovery-test-ai",
      status: async () => "available",
      streamText: async (request) => request.onChunk("reconstructed"),
      generateStructured: async <T>() => ({
        data: { capabilities: [], clarification: null, proposals: [] } as T,
      }),
    };
    const tasks = createInProcessTasks({ persistence, events });
    tasks.setExecutor(createProductionTaskExecutor({
      persistence,
      events,
      ai,
      compiler: createMockCompiler(),
      workspaceDir: "workspace",
    }));

    await expect(tasks.recover()).resolves.toEqual({ recovered: 1, failed: 0 });
    await tasks.waitForIdle();
    const recovered = await tasks.getTask("analysis-1");
    expect(recovered?.status).toBe("completed");
    expect(JSON.parse(recovered?.output ?? "{}")).toEqual({ capabilities: [] });
  });

  it("fails recovered flash_device before invoking the device adapter", async () => {
    const persistence = freshStore();
    await persistence.withTransaction((uow) => {
      uow.saveTask({
        ...task("flash-1"),
        capability: "flash_device",
        input: JSON.stringify({ projectId: "project-1", deviceId: "dev-1", buildId: "build-1", artifactVersionId: "fw-v1" }),
      });
    });
    let invocations = 0;
    const device: DevicePort = {
      detectBoard: async () => ({
        id: "dev-1",
        model: "test",
        port: "COM1",
        baudRate: 115200,
        truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "test" },
      }),
      disconnect: async () => undefined,
      flash: async () => {
        invocations += 1;
        return {
          exitCode: 0,
          sessionId: "should-not-exist",
          truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "test" },
        };
      },
      session: () => ({
        device: null,
        stage: "connected",
        truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "test" },
        serialStage: "disconnected",
        serialSessionId: null,
        serialLines: [],
      }),
      openSerialSession: async () => { throw new Error("not used"); },
      closeSerialSession: async () => undefined,
      getSerialSession: () => null,
      subscribeSerialSession: () => () => undefined,
      writeSerial: async () => { throw new Error("not used"); },
      tickSerial: () => undefined,
      shutdown: async () => undefined,
    };
    const tasks = createInProcessTasks({ persistence, events });
    tasks.setExecutor(createProductionTaskExecutor({
      persistence,
      events,
      ai: {
        name: "unused",
        status: async () => "unavailable",
        streamText: async () => undefined,
        generateStructured: async <T>() => ({ data: {} as T }),
      },
      compiler: createMockCompiler(),
      workspaceDir: "workspace",
      device,
      tokens: createFlashTokenStore(),
    }));

    await expect(tasks.recover()).resolves.toEqual({ recovered: 1, failed: 0 });
    await tasks.waitForIdle();
    const recovered = await tasks.getTask("flash-1");
    expect(recovered?.status).toBe("failed");
    expect(recovered?.error).toContain("TASK_RECOVERY_UNSAFE_REPLAY");
    expect(invocations).toBe(0);
  });
});
