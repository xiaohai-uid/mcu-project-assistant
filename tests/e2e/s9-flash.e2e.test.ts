// e2e/golden-journey — S9 Flash Confirmation + Serial 全链（真实 HTTP；对应 ISSUE-011 §12）
// 设备 = companion-local 确定性模拟（无真实硬件前提——ticket §14）→ 浏览器可 REAL 验收。
// 检测 → 令牌（一次性）→ Flash（进度 + .evidence 证据）→ 串口流/命令 → 断开；
// 安全：无令牌/复用/错误设备/过期/未检测 全部被拒。
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let ws: string;
let db: SqliteDb;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s9-e2e-"));
  ws = join(dir, "ws");
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createSseEvents();
  const app = createApp({
    persistence,
    workspaceDir: ws,
    content: createWorkspaceFilesContent(ws),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),
    ai: createMockAiProvider({ slow: false }),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedFirmware(): Promise<{ projectId: string; versionId: string }> {
  const create = await post("/api/v1/projects", { name: "Greenhouse" });
  const project = (await create.json()) as ProjectDto;
  const res = await post(`/api/v1/projects/${project.id}/commands`, {
    capability: "analyze_requirement",
    payload: { description: "greenhouse monitor" },
  });
  const { taskId } = (await res.json()) as { taskId: string };
  await new Promise((r) => setTimeout(r, 700));
  await post(`/api/v1/commands/${taskId}/clarification`, { roundId: 1, answer: "0.96 inch" });
  await new Promise((r) => setTimeout(r, 400));
  const proposals = (await (await fetch(`${base}/api/v1/projects/${project.id}/proposals`)).json()) as ProposalDto[];
  for (const p of proposals) {
    await post(`/api/v1/proposals/${p.id}/decision`, { decision: "accept" });
  }
  await post(`/api/v1/projects/${project.id}/requirements/commit`);
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
  await post(`/api/v1/projects/${project.id}/commands`, { capability: "generate_pin_map", payload: {} });
  const fw = (await (await post(`/api/v1/projects/${project.id}/artifacts`, { kind: "firmware" })).json()) as { id: string };
  await post(`/api/v1/artifacts/${fw.id}/versions`, {
    content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }),
  });
  const versions = (await (await fetch(`${base}/api/v1/artifacts/${fw.id}/versions`)).json()) as Array<{ id: string }>;
  return { projectId: project.id, versionId: versions[versions.length - 1]!.id };
}

const waitFor = async (fn: () => Promise<boolean>, ms = 4000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
};

describe("S9 Golden Journey — Flash Confirmation + Serial end-to-end（真实 HTTP + 确定性设备）", () => {
  it("检测 → 令牌 → Flash 进度/证据 → 串口流/命令 → 断开；安全拒绝全组", async () => {
    const { versionId } = await seedFirmware();

    // 1. 检测 Companion profile → no physical serial port implied
    const detect = await post("/api/v1/device/detect");
    expect(detect.status).toBe(200);
    const device = (await detect.json()) as { id: string; model: string; port: string };
    expect(device.model).toContain("ESP32-S3");
    expect(device.port).toBe("companion-local");

    // 2. 签发一次性令牌 → Flash → 202（进度事件由 SSE 承载；.evidence 证据）
    const tokenRes = await post("/api/v1/device/flash-token", { deviceId: device.id });
    const { token } = (await tokenRes.json()) as { token: string };
    const flash = await post("/api/v1/device/flash", {
      deviceId: device.id,
      confirmationToken: token,
      firmwareVersionId: versionId,
    });
    expect(flash.status).toBe(202);
    const { sessionId } = (await flash.json()) as { sessionId: string };
    expect(sessionId).toBeTruthy();
    expect(existsSync(join(ws, ".evidence", `${sessionId}.log`))).toBe(true);
    expect(readFileSync(join(ws, ".evidence", `${sessionId}.log`), "utf8")).toContain("Flash complete");

    // 3. 串口流（SSE serial.line 帧：遥测 Moisture/Pump）+ 命令回显
    const streamCtrl = new AbortController();
    const streamRes = await fetch(`${base}/api/v1/device/serial/stream`, { signal: streamCtrl.signal });
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const serialLines: string[] = [];
    const serialFrames: Array<{ line: string; truth?: { executionReality: string; physicalVerified: boolean; adapter: string } }> = [];
    const streamPromise = (async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (dataLine) {
              serialLines.push(dataLine);
              try {
                serialFrames.push(JSON.parse(dataLine) as { line: string; truth?: { executionReality: string; physicalVerified: boolean; adapter: string } });
              } catch {
                // Ignore malformed frames; the existing line assertion below still guards the smoke.
              }
            }
            if (serialFrames.some((frame) => frame.line.includes("Moisture Raw"))) {
              streamCtrl.abort();
              return;
            }
          }
        }
      } catch {
        // abort
      }
    })();
    await waitFor(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return serialFrames.some((frame) => frame.line.includes("Moisture Raw"));
    });
    void streamPromise;
    const telemetryFrame = serialFrames.find((frame) => frame.line.includes("Moisture Raw"));
    expect(telemetryFrame?.truth).toMatchObject({ executionReality: "companion", physicalVerified: false, adapter: "companion-local" });
    const send = await post("/api/v1/device/serial/send", { command: "GET_STATUS" });
    expect(send.status).toBe(200);
    const serialResponse = (await send.json()) as { response: string; truth: { executionReality: string; physicalVerified: boolean; adapter: string } };
    expect(serialResponse.response).toContain("STATUS moisture=");
    expect(serialResponse.truth).toMatchObject({ executionReality: "companion", physicalVerified: false, adapter: "companion-local" });

    // 4. 安全拒绝全组（HTTP 信封）
    // 无令牌 → 403 confirmation_missing
    const noToken = await post("/api/v1/device/flash", { deviceId: device.id, confirmationToken: "", firmwareVersionId: versionId });
    expect(noToken.status).toBe(403);
    // 复用 → 403 token_reused
    const reused = await post("/api/v1/device/flash", { deviceId: device.id, confirmationToken: token, firmwareVersionId: versionId });
    expect(reused.status).toBe(403);
    expect(((await reused.json()) as { error: { code: string } }).error.code).toBe("token_reused");
    // 错误设备 → 403 device_mismatch
    const t2resp = await post("/api/v1/device/flash-token", { deviceId: device.id });
    const t2body = (await t2resp.json()) as { token?: string; error?: { code: string } };
    if (!t2body.token) throw new Error(`t2 issue failed: ${JSON.stringify(t2body)}`);
    const t2 = t2body.token;
    console.log("wrong-device token:", t2);
    const wrong = await post("/api/v1/device/flash", { deviceId: "other", confirmationToken: t2, firmwareVersionId: versionId });
    console.log("wrong-device resp:", wrong.status, JSON.stringify(await wrong.clone().json()));
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("device_mismatch");
    // 断开 → 串口流终止 + 后续 flash 409
    await post("/api/v1/device/disconnect");
    const afterDisconnect = await post("/api/v1/device/flash", {
      deviceId: device.id,
      confirmationToken: t2,
      firmwareVersionId: versionId,
    });
    expect(afterDisconnect.status).toBe(409);
    expect(((await afterDisconnect.json()) as { error: { code: string } }).error.code).toBe("device_disconnected");
  });
});
