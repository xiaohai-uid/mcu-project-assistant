import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";

describe("serial SSE shutdown cleanup", () => {
  let dir: string | undefined;
  let db: SqliteDb | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("closes the stream and removes the serial listener without closing transport twice", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcu-serial-shutdown-"));
    db = openDatabase(join(dir, "state.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const events = createSseEvents();
    const baseDevice = createCompanionLocalDevice();
    let unsubscribeCount = 0;
    const device = {
      ...baseDevice,
      subscribeSerialSession: (...args: Parameters<typeof baseDevice.subscribeSerialSession>) => {
        const unsubscribe = baseDevice.subscribeSerialSession(...args);
        return () => { unsubscribeCount += 1; unsubscribe(); };
      },
    };
    const tasks = createInProcessTasks({ persistence, events });
    const app = createApp({
      persistence,
      workspaceDir: join(dir, "workspace"),
      content: createWorkspaceFilesContent(join(dir, "workspace")),
      events,
      tasks,
      compiler: createMockCompiler(),
      device,
      ai: createMockAiProvider(),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const detected = await (await fetch(`${base}/api/v1/device/detect`, { method: "POST" })).json() as { id: string };
    const project = await (await fetch(`${base}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "serial shutdown" }),
    })).json() as { id: string };
    const opened = await (await fetch(`${base}/api/v1/projects/${project.id}/device/serial/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: detected.id }),
    })).json() as { sessionId: string };
    const stream = await fetch(`${base}/api/v1/projects/${project.id}/device/serial/session/${opened.sessionId}/events`);
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    expect((await reader.read()).done).toBe(false);

    app.closeSseStreams();
    const closed = await Promise.race([
      reader.read().then((result) => result.done),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(closed).toBe(true);
    expect(unsubscribeCount).toBe(1);
    expect(baseDevice.getSerialSession(project.id, opened.sessionId)).not.toBeNull();

    await device.shutdown();
    expect(baseDevice.getSerialSession(project.id, opened.sessionId)).toBeNull();
  });
});
