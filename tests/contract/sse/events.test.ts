// contract/sse/events — SSE 最小实现（implementation-spec §10.3；ISSUE-003 §11）
// 事件帧格式（event:/data:）；终态事件；断线→Query 状态→续流（无 replay/ring buffer）。
import { mkdtempSync, rmSync } from "node:fs";
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
import type { LogicalEvent } from "@/src/ports/events";

let dir: string;
let dbPath: string;
let db: SqliteDb;
let server: Server;
let base: string;
let events: ReturnType<typeof createSseEvents>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s3a-sse-"));
  dbPath = join(dir, "test.db");
  db = openDatabase(dbPath);
  migrate(db);
  const persistence = createProjectStore(db);
  events = createSseEvents();
  const app = createApp({
    persistence,
    workspaceDir: join(dir, "ws"),
    content: createWorkspaceFilesContent(join(dir, "ws")),
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

/** 极简 SSE 客户端：读 fetch 流直到谓词满足或超时 */
async function readEvents(
  url: string,
  predicate: (frames: Array<{ event: string; data: unknown }>) => boolean,
  timeoutMs = 5000,
): Promise<Array<{ event: string; data: unknown }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, { signal: ctrl.signal });
  if (!res.body) throw new Error("no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: Array<{ event: string; data: unknown }> = [];
  let buffer = "";
  try {
    while (true) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch (err) {
        if ((err as Error).name === "AbortError") break; // 超时/中止：返回已收集帧
        throw err;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      // 帧分隔：\n\n
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = raw
          .split("\n")
          .find((l) => l.startsWith("event:"))
          ?.slice(6)
          .trim();
        const dataLine = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!dataLine) continue;
        try {
          frames.push({ event: event ?? "", data: JSON.parse(dataLine) });
        } catch {
          frames.push({ event: event ?? "", data: dataLine });
        }
        if (predicate(frames)) {
          clearTimeout(timer);
          ctrl.abort();
          return frames;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return frames;
}

async function createProject(): Promise<{ id: string }> {
  const res = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Greenhouse" }),
  });
  return (await res.json()) as { id: string };
}

describe("SSE（ADR-0008；implementation-spec §10.3）", () => {
  it("帧格式：event: <type> / data: <json>；分析流事件序到达", async () => {
    const p = await createProject();
    const ssePromise = readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.some((f) => f.event === "requirement.analysis.clarification.requested"),
    );
    // 等待订阅建立
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${base}/api/v1/projects/${p.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse" } }),
    });
    expect(res.status).toBe(202);

    const frames = await ssePromise;
    expect(frames[0]?.event).toBe("requirement.analysis.started");
    const types = frames.map((f) => f.event);
    expect(types).toContain("requirement.analysis.progress");
    expect(types).toContain("requirement.analysis.clarification.requested");
  });

  it("断线→Query 状态→续流（无 replay）：分析结束后新连接零帧；状态经 Query 恢复", async () => {
    const p = await createProject();
    // 1. 先订阅（收澄清），再发起分析；该分析的全部事件都在此连接发生
    const clarSubP = readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.some((f) => f.event === "requirement.analysis.clarification.requested"),
    );
    const res = await fetch(`${base}/api/v1/projects/${p.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse" } }),
    });
    const { taskId } = (await res.json()) as { taskId: string };
    const clarSub = await clarSubP;
    const clar = clarSub.find((f) => f.event === "requirement.analysis.clarification.requested");
    expect(clar).toBeDefined();
    const roundId = (clar!.data as { roundId: number }).roundId;
    // 先订阅 completion（无 replay：必须在回答前注册，否则错过完成事件）
    const doneSubP = readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.some((f) => f.event === "requirement.analysis.completed"),
    );
    await fetch(`${base}/api/v1/commands/${taskId}/clarification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId, answer: "0.96 inch" }),
    });
    const doneSub = await doneSubP;
    expect(doneSub.some((f) => f.event === "requirement.analysis.completed")).toBe(true);

    // 2. 模拟断线重连：新连接只收未来事件；分析已结束 → 1.5s 内零帧（无 replay/ring buffer）
    const second = await readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.length >= 1,
      1500,
    );
    expect(second.length).toBe(0);

    // 3. 断线恢复语义：重连后 Query 当前任务状态（GET /commands/:taskId）→ 续流
    const status = (await (await fetch(`${base}/api/v1/commands/${taskId}`)).json()) as { status: string };
    expect(["queued", "running", "completed", "failed", "cancelled"]).toContain(status.status);
  });

  it("clarification 回答后事件续流（completed 到达）", async () => {
    const p = await createProject();
    const ssePromise = readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.some((f) => f.event === "requirement.analysis.completed"),
    );
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${base}/api/v1/projects/${p.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse" } }),
    });
    const { taskId } = (await res.json()) as { taskId: string };
    // 等待澄清卡出现
    await new Promise((r) => setTimeout(r, 600));
    await fetch(`${base}/api/v1/commands/${taskId}/clarification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: 1, answer: "0.96 inch" }),
    });
    const frames = await ssePromise;
    const done = frames.find((f) => f.event === "requirement.analysis.completed");
    expect(done).toBeDefined();
    const data = done!.data as { capabilities: Array<{ id: string; status: string }> };
    expect(data.capabilities.length).toBeGreaterThan(0);
  });

  it("事件载荷类型为 LogicalEvent（传输无关契约）", () => {
    // 类型级检查：SSE 适配器 publish 接受 LogicalEvent（编译期验证由 typecheck 承担）
    const evt: LogicalEvent = {
      type: "requirement.analysis.started",
      projectId: "p1",
      analysisId: "a1",
      taskId: "t1",
    };
    expect(evt.type).toBe("requirement.analysis.started");
  });

  it("phase SSE frame carries task correlation, ISO timestamp, operation and heartbeat without fake progress", async () => {
    const p = await createProject();
    const ssePromise = readEvents(
      `${base}/api/v1/projects/${p.id}/events`,
      (frames) => frames.some((f) => f.event === "requirement.analysis.phase"),
    );
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(`${base}/api/v1/projects/${p.id}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "analyze_requirement", payload: { description: "greenhouse" } }),
    });
    expect(res.status).toBe(202);
    const frames = await ssePromise;
    const phase = frames.find((f) => f.event === "requirement.analysis.phase")?.data as Record<string, unknown>;
    expect(phase).toMatchObject({ projectId: p.id, phase: "provider_waiting", operation: "stream_text", heartbeat: false });
    expect(typeof phase.taskId).toBe("string");
    expect(typeof phase.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(phase.timestamp as string))).toBe(false);
    expect("percentage" in phase).toBe(false);
    expect("reasoning_content" in phase).toBe(false);
  });
});
