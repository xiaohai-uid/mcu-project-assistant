import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

function makeApp(frontendDist?: string, persistenceOverride?: ReturnType<typeof createProjectStore>): ReturnType<typeof createApp> {
  const persistence = persistenceOverride ?? createProjectStore(db);
  const events = createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: join(dir, "workspace"),
    content: createWorkspaceFilesContent(join(dir, "workspace")),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),
    ai: createMockAiProvider(),
    frontendDist,
  };
  return createApp(deps);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-error-contract-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  app = makeApp();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("production HTTP error boundary", () => {
  it("maps malformed JSON to a JSON invalid_json envelope", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .set("Content-Type", "application/json")
      .send('{"name":');
    expect(response.status).toBe(400);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: { code: "invalid_json", message: "Request body contains invalid JSON" } });
  });

  it("rejects request bodies above the transport limit before route handling", async () => {
    const response = await request(app)
      .post("/api/v1/projects")
      .send({ name: "x".repeat(2 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { code: "payload_too_large", message: "Request body exceeds the supported size" } });
  });

  it.each([undefined, join(process.cwd(), "app", "dist")])("returns JSON 404 for unknown API routes (%s)", async (frontendDist) => {
    app = makeApp(frontendDist);
    const response = await request(app).get("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.type).toMatch(/json/);
    expect(response.body.error).toEqual({ code: "not_found", message: "API route not found" });
  });

  it("maps an unexpected API exception to internal without stack/path/raw error", async () => {
    const persistence = createProjectStore(db);
    const failingPersistence = {
      ...persistence,
      getProject: async () => { throw new Error("C:\\secret\\internal\\path RAW_PROVIDER_SECRET_MARKER"); },
    } as typeof persistence;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    app = makeApp(undefined, failingPersistence);
    const response = await request(app).get("/api/v1/projects/any-id");
    expect(response.status).toBe(500);
    expect(response.type).toMatch(/json/);
    expect(response.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(JSON.stringify(response.body)).not.toMatch(/RAW_PROVIDER_SECRET_MARKER|stack|C:\\secret|internal\\path/i);
    expect(spy.mock.calls.flat().join(" ")).not.toContain("RAW_PROVIDER_SECRET_MARKER");
    spy.mockRestore();
  });
});
