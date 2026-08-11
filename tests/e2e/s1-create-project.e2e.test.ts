// e2e/golden-journey — S1 Create Project 全链（真实 HTTP listen + 重启持久化）
// 对应 ISSUE-001 §12 Browser acceptance 的服务端等价路径；浏览器验收另由人工走查。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "@/src/adapters/http/app";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ProjectDto } from "@/src/shared-contracts/types";

let dir: string;
let dbPath: string;
let workspaceDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s1-e2e-"));
  dbPath = join(dir, "test.db");
  workspaceDir = join(dir, "ws");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function startServer(): Promise<{ server: Server; db: SqliteDb; base: string; stop: () => Promise<void> }> {
  const db = openDatabase(dbPath);
  migrate(db);
  const app = createApp({ persistence: createProjectStore(db), workspaceDir });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    db,
    base,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}

describe("S1 Golden Journey — Create Project end-to-end（真实 HTTP）", () => {
  it("创建 → 列表 → 打开 → 归档 → 重启后记录保留", async () => {
    const s1 = await startServer();

    // 1. 创建
    const create = await fetch(`${s1.base}/api/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smart Greenhouse" }),
    });
    expect(create.status).toBe(201);
    const project = (await create.json()) as ProjectDto;
    expect(project.name).toBe("Smart Greenhouse");
    expect(project.archivedAt).toBeNull();

    // 2. 列表含该项目
    const list = (await (await fetch(`${s1.base}/api/v1/projects`)).json()) as ProjectDto[];
    expect(list.map((p) => p.id)).toContain(project.id);

    // 3. 打开
    const opened = (await (await fetch(`${s1.base}/api/v1/projects/${project.id}`)).json()) as ProjectDto;
    expect(opened.id).toBe(project.id);

    // 4. 归档（token → archive）
    const tokenRes = (await (await fetch(`${s1.base}/api/v1/projects/${project.id}/archive-token`, { method: "POST" })).json()) as {
      token: string;
    };
    const archived = (await (
      await fetch(`${s1.base}/api/v1/projects/${project.id}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationToken: tokenRes.token }),
      })
    ).json()) as ProjectDto;
    expect(archived.archivedAt).not.toBeNull();

    // 5. 活跃列表移除
    const listAfter = (await (await fetch(`${s1.base}/api/v1/projects`)).json()) as ProjectDto[];
    expect(listAfter.map((p) => p.id)).not.toContain(project.id);

    // 6. 模拟应用重启：停服 → 新实例同库
    await s1.stop();
    const s2 = await startServer();
    const afterRestart = (await (
      await fetch(`${s2.base}/api/v1/projects/${project.id}`)
    ).json()) as ProjectDto;
    expect(afterRestart.id).toBe(project.id);
    expect(afterRestart.name).toBe("Smart Greenhouse");
    expect(afterRestart.archivedAt).not.toBeNull(); // 记录保留（I-10）

    await s2.stop();
  });
});
