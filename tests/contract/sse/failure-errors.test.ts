import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createSseEvents } from "@/src/adapters/events/sse";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { DevicePort, DeviceSession, DeviceInfo, FlashEvent, FlashResult, SerialSession, SerialSessionEvent, SerialResult } from "@/src/ports/device";
import type { LogicalEvent } from "@/src/ports/events";

const iso = "2026-08-13T00:00:00.000Z";

describe("failure SSE logical-event contract", () => {
  it("analysis/provider failures carry safe code/message/timestamp/correlation", () => {
    const analysis: LogicalEvent = {
      type: "requirement.analysis.failed", projectId: "p1", analysisId: "a1", taskId: "t1",
      code: "provider_timeout", message: "AI provider request timed out", timestamp: iso,
    };
    const provider: LogicalEvent = {
      type: "provider.unavailable", provider: "zhipu-glm", projectId: "p1", taskId: "t1",
      code: "provider_unavailable", message: "AI provider is unavailable", timestamp: iso,
    };
    expect(analysis).toMatchObject({ projectId: "p1", taskId: "t1", code: "provider_timeout", timestamp: iso });
    expect(provider).toMatchObject({ projectId: "p1", taskId: "t1", code: "provider_unavailable", timestamp: iso });
    expect(JSON.stringify([analysis, provider])).not.toMatch(/RAW_PROVIDER|REASONING|C:\\secret/i);
  });

  it("build/flash failures carry actionable stable fields", () => {
    const build: LogicalEvent = {
      type: "build.failed", projectId: "p1", buildId: "b1", taskId: "t1", code: "build_output_missing",
      message: "Firmware build produced no verified output", exitCode: 0, timestamp: iso,
    };
    const flash: LogicalEvent = {
      type: "device.flash_failed", projectId: "p1", deviceId: "d1", taskId: "t1", buildId: "b1",
      code: "flash_firmware_hash_mismatch", message: "Firmware artifact hash does not match", timestamp: iso,
      truth: { executionReality: "companion", verification: "failed", physicalVerified: false, adapter: "companion-local" },
    };
    expect(build).toMatchObject({ projectId: "p1", buildId: "b1", code: "build_output_missing", exitCode: 0, timestamp: iso });
    expect(flash).toMatchObject({ projectId: "p1", taskId: "t1", buildId: "b1", code: "flash_firmware_hash_mismatch", timestamp: iso });
  });

  it("serial SSE maps a real transport error to a safe correlated payload", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcu-serial-sse-contract-"));
    let db: SqliteDb | undefined;
    let server: Server | undefined;
    let emitError: ((event: SerialSessionEvent) => void) | undefined;
    let activeSubscriptions = 0;
    const session: SerialSession = {
      sessionId: "serial-1",
      projectId: "project-1",
      deviceId: "device-1",
      executionReality: "physical",
      port: "COM9",
      baudRate: 115200,
      adapter: "fixture",
      openedAt: iso,
      status: "connected",
    };
    const deviceSession: DeviceSession = {
      device: null,
      stage: "connected",
      truth: { executionReality: "physical", verification: "verified", physicalVerified: true, adapter: "fixture" },
      serialStage: "connected",
      serialSessionId: session.sessionId,
      serialLines: [],
    };
    const device: DevicePort = {
      detectBoard: async (): Promise<DeviceInfo> => ({
        id: session.deviceId, model: "fixture", port: session.port, baudRate: session.baudRate, truth: deviceSession.truth,
      }),
      disconnect: async () => undefined,
      flash: async (_input, _onEvent: (event: FlashEvent) => void, _signal): Promise<FlashResult> => ({ exitCode: 0, sessionId: "", truth: deviceSession.truth }),
      session: () => deviceSession,
      openSerialSession: async () => session,
      closeSerialSession: async () => undefined,
      getSerialSession: (projectId, sessionId) => projectId === session.projectId && sessionId === session.sessionId ? session : null,
      subscribeSerialSession: (_projectId, _sessionId, listener) => {
        activeSubscriptions += 1;
        emitError = listener;
        return () => { activeSubscriptions -= 1; emitError = undefined; };
      },
      writeSerial: async (): Promise<SerialResult> => ({ response: null, truth: deviceSession.truth }),
      tickSerial: () => undefined,
      shutdown: async () => undefined,
    };
    try {
      db = openDatabase(join(dir, "test.db"));
      migrate(db);
      const persistence = createProjectStore(db);
      const events = createSseEvents();
      const app = createApp({
        persistence,
        workspaceDir: join(dir, "workspace"),
        content: createWorkspaceFilesContent(join(dir, "workspace")),
        events,
        tasks: createInProcessTasks({ persistence, events }),
        compiler: createMockCompiler(),
        device,
        ai: createMockAiProvider(),
        now: () => new Date(iso),
      });
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/projects/${session.projectId}/device/serial/session/${session.sessionId}/events`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
      for (let attempt = 0; attempt < 50 && !emitError; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(emitError).toBeTypeOf("function");
      emitError!({
        type: "error",
        session,
        code: "SERIAL_SESSION_NOT_OPEN",
        message: "RAW_PROVIDER_SECRET_MARKER C:\\secret\\internal\\path",
        receivedAt: iso,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let body = "";
      for (let attempt = 0; attempt < 20 && !body.includes("serial.session.error"); attempt += 1) {
        const chunk = await reader.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value, { stream: true });
      }
      await reader.cancel();
      expect(body).toContain("event: serial.session.error");
      const data = JSON.parse(body.split("data: ")[1]!.split("\n", 1)[0]!) as Record<string, unknown>;
      expect(data).toMatchObject({
        projectId: session.projectId,
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        code: "serial_session_not_open",
        message: "Serial session is not open",
        timestamp: iso,
      });
      expect(body).not.toMatch(/RAW_PROVIDER_SECRET_MARKER|C:\\secret\\internal\\path/i);

      for (let i = 0; i < 50; i += 1) {
        const repeated = await fetch(`http://127.0.0.1:${address.port}/api/v1/projects/${session.projectId}/device/serial/session/${session.sessionId}/events`);
        expect(repeated.status).toBe(200);
        await repeated.body?.cancel();
      }
      for (let attempt = 0; attempt < 20 && activeSubscriptions !== 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      expect(activeSubscriptions).toBe(0);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
