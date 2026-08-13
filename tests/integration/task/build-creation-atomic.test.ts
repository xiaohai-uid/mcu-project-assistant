import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import { runBuild } from "@/src/application/capabilities/build";
import { createArtifact } from "@/src/domain/models/artifact";
import { createProject } from "@/src/domain/models/project";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("atomic build/task creation", () => {
  it("creates a BuildRecord with an already-linked durable queued task", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-build-atomic-"));
    roots.push(root);
    const workspaceDir = join(root, "workspace");
    const db = openDatabase(join(root, "state.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const content = createWorkspaceFilesContent(workspaceDir);
    const events = { publish: () => undefined };
    const compiler = createMockCompiler({ lines: [], exitCode: 0 });
    const tasks = createInProcessTasks({ persistence, events });
    tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler, workspaceDir }));
    const project = createProject("atomic build");
    const artifact = createArtifact({ projectId: project.id, kind: "firmware" });
    const source = await content.store({ projectId: project.id, kind: "firmware", versionNo: 1, subpath: "src/main.cpp" }, "void setup(){}\n");
    await persistence.withTransaction((uow) => {
      uow.createProject(project);
      uow.createArtifact(artifact);
      uow.createVersion({ id: "atomic-version", artifactId: artifact.id, versionNo: 1, contentRef: source.contentRef, contentHash: source.contentHash, status: "accepted", sourceKind: "manual", sourceProposalId: null, createdAt: "2026-08-13T00:00:00.000Z", createdBy: "owner" });
    });

    const { buildId } = await runBuild({ projectId: project.id, versionId: "atomic-version" }, { persistence, tasks, events, compiler, workspaceDir });
    const record = await persistence.getBuildRecord(buildId);
    expect(record?.taskId).toBeTruthy();
    const task = await persistence.getTask(record!.taskId!);
    expect(task).toMatchObject({ id: record!.taskId, capability: "run_build" });
    expect(JSON.parse(task!.input)).toMatchObject({ buildId, projectId: project.id, versionId: "atomic-version" });
    await tasks.waitForIdle();
    db.close();
  });
});
