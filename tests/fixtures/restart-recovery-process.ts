import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createProject } from "@/src/domain/models/project";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import type { EventPort } from "@/src/ports/events";
import type { TaskRecord } from "@/src/ports/task-execution";

const [mode, dbPathArg, startedPathArg, countPathArg, resultPathArg] = process.argv.slice(2);
if (!mode || !dbPathArg || !startedPathArg || !countPathArg || !resultPathArg) {
  throw new Error("restart recovery fixture requires mode, db, started, count, and result paths");
}
const dbPath = dbPathArg;
const startedPath = startedPathArg;
const countPath = countPathArg;
const resultPath = resultPathArg;
const taskId = "restart-task";
const events: EventPort = { publish: () => undefined };

function durableTask(projectId: string, status: TaskRecord["status"] = "queued"): TaskRecord {
  return {
    id: taskId,
    capability: "analyze_requirement",
    input: JSON.stringify({ projectId, description: "recover this analysis", lab: {} }),
    status,
    createdAt: "2026-08-12T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    error: null,
    output: null,
  };
}

async function main(): Promise<void> {
  const db = openDatabase(dbPath);
  migrate(db);
  const persistence = createProjectStore(db);

  if (mode === "A") {
    const project = createProject("restart-recovery", () => new Date("2026-08-12T00:00:00.000Z"));
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.saveTask(durableTask(project.id));
    });
    const ai: AIProviderPort = {
      name: "restart-test-ai",
      status: async () => "available",
      streamText: async () => {
        writeFileSync(startedPath, taskId, "utf8");
        await new Promise<void>(() => undefined);
      },
      generateStructured: async <T>() => ({ data: {} as T }),
    };
    const tasks = createInProcessTasks({
      persistence,
      events,
    });
    tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai, compiler: createMockCompiler(), workspaceDir: "workspace" }));
    await tasks.recover();
    // Test-only process hold: production recovery is one-shot and has no timer.
    await new Promise<void>(() => {
      setInterval(() => undefined, 1_000);
    });
    return;
  }

  if (mode !== "B") throw new Error(`Unknown process mode: ${mode}`);
  const project = (await persistence.listProjects())[0];
  if (!project) throw new Error("restart project was not created");
  const ai: AIProviderPort = {
    name: "restart-test-ai",
    status: async () => "available",
    streamText: async (request) => {
      appendFileSync(countPath, "completed\n", "utf8");
      request.onChunk("recovered");
    },
    generateStructured: async <T>() => ({
      data: { capabilities: [], clarification: null, proposals: [] } as T,
    }),
  };
  const tasks = createInProcessTasks({
    persistence,
    events,
  });
  tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai, compiler: createMockCompiler(), workspaceDir: "workspace" }));
  const recovery = await tasks.recover();
  await tasks.waitForIdle();
  const finalTask = await tasks.getTask(taskId);
  writeFileSync(resultPath, JSON.stringify({ recovery, task: finalTask }), "utf8");
  db.close();
}

if (!existsSync(dbPath) && mode === "B") throw new Error("restart database was not created");
void main().catch((error) => {
  writeFileSync(resultPath, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), "utf8");
  process.exitCode = 1;
});
