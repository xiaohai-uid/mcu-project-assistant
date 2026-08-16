import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { CommercialReadinessReportDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

describe("commercial readiness report surface", () => {
  it("returns four evidence gates without turning missing evidence into a pass", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcu-readiness-http-"));
    const workspaceDir = join(dir, "ws");
    db = openDatabase(join(dir, "test.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const events = createNoopEvents();
    const deps: AppDeps = {
      persistence,
      workspaceDir,
      content: createWorkspaceFilesContent(workspaceDir),
      events,
      tasks: createInProcessTasks({ persistence, events }),
      compiler: createMockCompiler(),
      device: createCompanionLocalDevice(),
      ai: createMockAiProvider({ slow: false }),
      now: () => new Date("2026-08-16T00:00:00.000Z"),
    };
    app = createApp(deps);

    const project = await request(app).post("/api/v1/projects").send({ name: "Readiness" });
    const report = await request(app).get(`/api/v1/projects/${(project.body as { id: string }).id}/readiness-report`);
    expect(report.status).toBe(200);
    const body = report.body as CommercialReadinessReportDto;
    expect(body.gates.map((gate) => gate.id)).toEqual(["local-ready", "simulation-ready", "physical-accepted", "paid-release-ready"]);
    expect(body.gates.some((gate) => gate.status === "ready")).toBe(false);
    expect(body.conclusion.text).not.toMatch(/%/);
    expect(body.gates.find((gate) => gate.id === "paid-release-ready")?.status).toBe("blocked");
  });
});
