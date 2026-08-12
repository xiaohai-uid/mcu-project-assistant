import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { TaskRecord } from "@/src/ports/task-execution";

const resources: Array<{ db: SqliteDb; dir: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    try {
      resource.db.close();
    } catch {
      // already closed by the test
    }
    rmSync(resource.dir, { recursive: true, force: true });
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForTask(
  app: ReturnType<typeof createApp>,
  taskId: string,
  predicate: (task: TaskRecord) => boolean,
): Promise<TaskRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request(app).get(`/api/v1/commands/${taskId}`);
    if (response.status === 200 && predicate(response.body as TaskRecord)) return response.body as TaskRecord;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`task ${taskId} did not reach the expected state`);
}

describe("HTTP task cancellation boundary", () => {
  it("cancels a real API task, observes provider abort, and excludes it after fresh runtime recovery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcu-http-cancel-"));
    const dbPath = join(dir, "tasks.db");
    const db = openDatabase(dbPath);
    const resource = { db, dir };
    resources.push(resource);
    migrate(db);
    const persistence = createProjectStore(db);
    const published: LogicalEvent[] = [];
    const events: EventPort = { publish: (event) => { published.push(event); } };
    const started = deferred();
    const aborted = deferred();
    const release = deferred();
    let providerCalls = 0;
    const ai: AIProviderPort = {
      name: "blocking-cancellation-test-ai",
      status: async () => "available",
      streamText: async (input) => {
        providerCalls += 1;
        started.resolve();
        await new Promise<void>((resolve, reject) => {
          if (input.signal.aborted) {
            aborted.resolve();
            reject(new Error("aborted"));
            return;
          }
          input.signal.addEventListener("abort", () => {
            aborted.resolve();
            void release.promise.then(resolve);
          }, { once: true });
        });
      },
      generateStructured: async <T>() => ({ data: {} as T }),
    };
    const tasks = createInProcessTasks({ persistence, events });
    const appDeps: AppDeps = {
      persistence,
      workspaceDir: join(dir, "workspace"),
      content: createWorkspaceFilesContent(join(dir, "workspace")),
      events,
      tasks,
      compiler: createMockCompiler(),
      device: createCompanionLocalDevice(),
      ai,
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    };
    const app = createApp(appDeps);

    const projectResponse = await request(app).post("/api/v1/projects").send({ name: "Cancellation" });
    expect(projectResponse.status).toBe(201);
    const projectId = (projectResponse.body as { id: string }).id;
    const commandResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/commands`)
      .send({ capability: "analyze_requirement", payload: { description: "hold until cancelled" } });
    expect(commandResponse.status).toBe(202);
    const taskId = (commandResponse.body as { taskId: string }).taskId;

    await started.promise;
    await waitForTask(app, taskId, (task) => task.status === "running");
    const cancelResponse = await request(app).post(`/api/v1/commands/${taskId}/cancel`);
    expect(cancelResponse.status).toBe(202);
    await aborted.promise;
    const cancelled = await waitForTask(app, taskId, (task) => task.status === "cancelled");
    const phaseCountAtCancellation = published.filter((event) => event.type === "requirement.analysis.phase").length;
    expect(cancelled).toMatchObject({ status: "cancelled", output: null });
    expect(providerCalls).toBe(1);
    expect(published.some((event) => event.type === "requirement.analysis.completed")).toBe(false);

    const midDb = openDatabase(dbPath);
    migrate(midDb);
    expect(await createProjectStore(midDb).getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
    midDb.close();

    release.resolve();
    await tasks.waitForIdle();
    expect(await persistence.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
    expect(published.filter((event) => event.type === "requirement.analysis.phase")).toHaveLength(phaseCountAtCancellation);
    expect(published.some((event) => event.type === "requirement.analysis.cancelled")).toBe(true);
    db.close();
    const freshDb = openDatabase(dbPath);
    resource.db = freshDb;
    migrate(freshDb);
    const freshPersistence = createProjectStore(freshDb);
    let recoveryExecutions = 0;
    const recoveredTasks = createInProcessTasks({
      persistence: freshPersistence,
      events: { publish: () => undefined },
      executeTask: async () => { recoveryExecutions += 1; },
    });
    await expect(recoveredTasks.recover()).resolves.toEqual({ recovered: 0, failed: 0 });
    expect(recoveryExecutions).toBe(0);
    expect(await freshPersistence.getTask(taskId)).toMatchObject({ status: "cancelled", output: null });
  });
});
