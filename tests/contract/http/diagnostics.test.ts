// tests/contract/http/diagnostics.test.ts — 诊断切片契约（客户端上报 + 运营者读取 + 事件持久化）
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppDeps } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createPersistingEvents } from "@/src/adapters/events/persisting";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import { createEventLogStore, type EventLogPort } from "@/src/adapters/persistence/sqlite/event-log-store";
import type { EventPort } from "@/src/ports/events";

const OPERATOR = { username: "op", password: "operator-password-16ch" };

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;
let eventLog: EventLogPort;

function makeApp(trustedProxies?: readonly string[]): ReturnType<typeof createApp> {
  const persistence = createProjectStore(db);
  const events = createPersistingEvents(createNoopEvents(), eventLog);
  const deps: AppDeps = {
    persistence,
    workspaceDir: join(dir, "workspace"),
    content: createWorkspaceFilesContent(join(dir, "workspace")),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),
    ai: createMockAiProvider(),
    publicMode: true,
    basicAuth: OPERATOR,
    eventLog,
    trustedProxies,
  };
  return createApp(deps);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-diagnostics-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  eventLog = createEventLogStore(db);
  app = makeApp();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const authHeader = (credentials: { username: string; password: string }): string =>
  `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;

async function loginSessionCookie(): Promise<string> {
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ username: OPERATOR.username, password: OPERATOR.password });
  expect(login.status).toBe(200);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
}

describe("POST /api/v1/diagnostics/client-errors", () => {
  it("accepts a valid client error report with operator basic auth", async () => {
    const response = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "TypeError: x is not a function", stack: "at f()", url: "http://x/", sessionId: "web-1" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: "accepted" });
    // ISSUE-003：client.error 的 correlationId 是上报请求自身的 x-request-id，
    // 与服务端请求日志可 join；sessionId 降级为 data 字段保留聚合键。
    const requestId = response.headers["x-request-id"];
    expect(requestId).toBeTruthy();
    const stored = eventLog.list({ source: "client" });
    expect(stored).toHaveLength(1);
    const first = stored[0]!;
    expect(first.type).toBe("client.error");
    expect(first.level).toBe("error");
    expect(first.correlationId).toBe(requestId);
    expect((first.data as { message: string }).message).toContain("TypeError");
    expect((first.data as { sessionId?: string }).sessionId).toBe("web-1");
  });

  it("stamps each client.error row with its own request id so server logs join on it", async () => {
    const first = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "boom-a", sessionId: "shared-session" });
    const second = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "boom-b", sessionId: "shared-session" });
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
    const stored = eventLog.list({ source: "client" });
    expect(stored.map((e) => e.correlationId)).toEqual([
      second.headers["x-request-id"],
      first.headers["x-request-id"],
    ]);
    // 同一浏览器会话的多次错误仍可通过 data.sessionId 聚合
    expect(stored.every((e) => (e.data as { sessionId?: string }).sessionId === "shared-session")).toBe(true);
  });

  it("accepts a report from a session-cookie user (public beta user path)", async () => {
    const cookie = await loginSessionCookie();
    const response = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Cookie", cookie)
      .send({ message: "boom" });
    expect(response.status).toBe(202);
  });

  it("rejects missing message with invalid_content", async () => {
    const response = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ stack: "no message" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_content");
  });

  it("truncates oversized fields instead of rejecting", async () => {
    const response = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "m".repeat(5000), stack: "s".repeat(30000) });
    expect(response.status).toBe(202);
    const stored = eventLog.list({ source: "client" });
    const first = stored[0]!;
    expect((first.data as { message: string }).message).toHaveLength(2000);
    expect((first.data as { stack?: string }).stack).toHaveLength(16000);
  });

  it("rate limits excessive reports per address", async () => {
    for (let i = 0; i < 60; i += 1) {
      const r = await request(app)
        .post("/api/v1/diagnostics/client-errors")
        .set("Authorization", authHeader(OPERATOR))
        .send({ message: `e${i}` });
      expect(r.status).toBe(202);
    }
    const overflow = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "overflow" });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("rate_limited");
  });

  it("does not let a client rotate a forged X-Forwarded-For header past the quota", async () => {
    for (let i = 0; i < 60; i += 1) {
      const r = await request(app)
        .post("/api/v1/diagnostics/client-errors")
        .set("Authorization", authHeader(OPERATOR))
        .set("X-Forwarded-For", `198.51.100.${i}, 198.51.100.200`)
        .send({ message: `spoof-${i}` });
      expect(r.status).toBe(202);
    }
    const overflow = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .set("X-Forwarded-For", "203.0.113.250")
      .send({ message: "overflow-after-rotation" });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("rate_limited");
  });

  it("keys by the rightmost untrusted hop when a trusted reverse proxy is declared", async () => {
    const proxied = makeApp(["127.0.0.1", "::1"]);
    // socket 地址是可信反代；链右起第一个非可信跳才是客户端键，左侧伪造噪声被忽略
    for (let i = 0; i < 60; i += 1) {
      const r = await request(proxied)
        .post("/api/v1/diagnostics/client-errors")
        .set("Authorization", authHeader(OPERATOR))
        .set("X-Forwarded-For", `198.51.100.${i}, 10.0.0.9`)
        .send({ message: `via-proxy-${i}` });
      expect(r.status).toBe(202);
    }
    const overflow = await request(proxied)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .set("X-Forwarded-For", "10.0.0.9")
      .send({ message: "proxy-overflow" });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("rate_limited");
  });

  it("ignores X-Forwarded-For when the socket peer is not a declared trusted proxy", async () => {
    // 直连源站攻击面：配置了可信反代，但对端不是反代——伪造链必须整体失效
    const hardened = makeApp(["10.0.0.99"]);
    for (let i = 0; i < 60; i += 1) {
      const r = await request(hardened)
        .post("/api/v1/diagnostics/client-errors")
        .set("Authorization", authHeader(OPERATOR))
        .set("X-Forwarded-For", `198.51.100.${i}`)
        .send({ message: `direct-${i}` });
      expect(r.status).toBe(202);
    }
    const overflow = await request(hardened)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .set("X-Forwarded-For", "203.0.113.250")
      .send({ message: "direct-overflow" });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("rate_limited");
  });

  it("requires authentication like every other API route", async () => {
    const response = await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .send({ message: "anon" });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/diagnostics/events + summary (operator only)", () => {
  beforeEach(async () => {
    await request(app)
      .post("/api/v1/diagnostics/client-errors")
      .set("Authorization", authHeader(OPERATOR))
      .send({ message: "client boom", sessionId: "s1" });
    eventLog.append({ level: "warn", source: "server", type: "http.request", data: { status: 404, path: "/x" } });
    eventLog.append({ level: "info", source: "server", type: "build.succeeded", projectId: "p1", data: {} });
  });

  it("returns events for operator basic auth with filters", async () => {
    const response = await request(app)
      .get("/api/v1/diagnostics/events?level=error&source=client")
      .set("Authorization", authHeader(OPERATOR));
    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].type).toBe("client.error");
  });

  it("refuses session-cookie-only users with forbidden (operator perimeter)", async () => {
    const cookie = await loginSessionCookie();
    const response = await request(app)
      .get("/api/v1/diagnostics/events")
      .set("Cookie", cookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
  });

  it("summarizes counts by level and type within windows", async () => {
    const response = await request(app)
      .get("/api/v1/diagnostics/summary")
      .set("Authorization", authHeader(OPERATOR));
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThanOrEqual(3);
    const day = response.body.windows.find((w: { window: string }) => w.window === "24h");
    expect(day.byLevel.error).toBeGreaterThanOrEqual(1);
    expect(day.byLevel.info).toBeGreaterThanOrEqual(1);
    const types = day.byType.map((t: { type: string }) => t.type);
    expect(types).toContain("client.error");
    expect(types).toContain("build.succeeded");
  });
});

describe("persisting EventPort stores logical events for the flywheel", () => {
  it("persists proposal.decided published through the app capability chain", async () => {
    // 直接验证组合适配器行为：任何 LogicalEvent 都落 event_log 且仍到达 inner
    const seen: string[] = [];
    const inner: EventPort = { publish: (event) => void seen.push(event.type) };
    const log = createEventLogStore(db);
    const port = createPersistingEvents(inner, log);
    port.publish({
      type: "proposal.decided",
      projectId: "p1",
      proposalId: "pr1",
      decision: "accept",
      proposalType: "firmware",
    });
    port.publish({
      type: "requirement.analysis.failed",
      projectId: "p1",
      analysisId: "a1",
      taskId: "t1",
      code: "provider_timeout",
      message: "timed out",
      timestamp: new Date().toISOString(),
    });
    expect(seen).toEqual(["proposal.decided", "requirement.analysis.failed"]);
    const stored = log.list({}); // list 按最新在前返回
    expect(stored.map((e) => e.type)).toEqual(["requirement.analysis.failed", "proposal.decided"]);
    const firstStored = stored[0]!;
    const secondStored = stored[1]!;
    expect(firstStored.level).toBe("error");
    expect(firstStored.projectId).toBe("p1");
    expect(secondStored.level).toBe("info");
  });
});
