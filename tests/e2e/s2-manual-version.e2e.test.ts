// e2e/golden-journey — S2 Manual Artifact Version 全链（真实 HTTP listen + 重启持久化 + workspace 文件）
// 对应 ISSUE-002 §12 Browser acceptance 的服务端等价路径；浏览器验收另由人工走查。
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { ArtifactDto, ArtifactVersionDto, ProjectDto } from "@/src/shared-contracts/types";

let dir: string;
let dbPath: string;
let workspaceDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s2-e2e-"));
  dbPath = join(dir, "test.db");
  workspaceDir = join(dir, "ws");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function startServer(): Promise<{ server: Server; db: SqliteDb; base: string; stop: () => Promise<void> }> {
  const db = openDatabase(dbPath);
  migrate(db);
  const app = createApp({
    persistence: createProjectStore(db),
    workspaceDir,
    content: createWorkspaceFilesContent(workspaceDir),
    events: createNoopEvents(),
  });
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

describe("S2 Golden Journey — Manual Artifact Version end-to-end（真实 HTTP）", () => {
  it("创建项目 → 手动编辑两次 → 版本历史 v1/v2 → 打开 v1 为旧值 → 重启后版本与文件仍在", async () => {
    const s1 = await startServer();

    // 1. 创建项目
    const create = await fetch(`${s1.base}/api/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Greenhouse" }),
    });
    expect(create.status).toBe(201);
    const project = (await create.json()) as ProjectDto;

    // 2. 打开项目 → 懒创建 pinmap Artifact
    const artRes = await fetch(`${s1.base}/api/v1/projects/${project.id}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "pinmap" }),
    });
    expect(artRes.status).toBe(201);
    const artifact = (await artRes.json()) as ArtifactDto;

    // 3. 手动编辑 v1（Relay → IO12）
    const contentV1 = JSON.stringify({ pins: [{ component: "5V Pump Relay Driver", pinId: "IO12", type: "Digital" }] });
    const v1res = await fetch(`${s1.base}/api/v1/artifacts/${artifact.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: contentV1 }),
    });
    expect(v1res.status).toBe(201);
    const v1 = (await v1res.json()) as ArtifactVersionDto;
    expect(v1.versionNo).toBe(1);

    // 4. 手动编辑 v2（Relay → IO21）
    const contentV2 = JSON.stringify({ pins: [{ component: "5V Pump Relay Driver", pinId: "IO21", type: "Digital" }] });
    const v2res = await fetch(`${s1.base}/api/v1/artifacts/${artifact.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: contentV2 }),
    });
    expect(v2res.status).toBe(201);
    const v2 = (await v2res.json()) as ArtifactVersionDto;
    expect(v2.versionNo).toBe(2);

    // 5. 版本历史（刷新等价：重新查询）→ v1、v2 可见
    const hist = (await (await fetch(`${s1.base}/api/v1/artifacts/${artifact.id}/versions`)).json()) as ArtifactVersionDto[];
    expect(hist.map((v) => v.versionNo)).toEqual([1, 2]);

    // 6. 打开 v1 → 内容为旧值（不可变历史，I-2）
    const v1Detail = (await (await fetch(`${s1.base}/api/v1/versions/${v1.id}`)).json()) as {
      version: ArtifactVersionDto;
      content: string;
    };
    expect(v1Detail.content).toBe(contentV1);

    // 7. workspace 文件真实存在（内容本体 = 工作区文件，非 SQLite JSON；布局 <ws>/<projectId>/pinmap/NNNN.json）
    const v1File = join(workspaceDir, project.id, "pinmap", "0001.json");
    expect(existsSync(v1File)).toBe(true);
    expect(readFileSync(v1File, "utf8")).toBe(contentV1);

    // 8. 模拟应用重启：停服 → 新实例同库同 workspace → 版本与文件仍在
    await s1.stop();
    const s2 = await startServer();
    const afterRestart = (await (
      await fetch(`${s2.base}/api/v1/artifacts/${artifact.id}/versions`)
    ).json()) as ArtifactVersionDto[];
    expect(afterRestart.map((v) => v.versionNo)).toEqual([1, 2]);
    const afterDetail = (await (
      await fetch(`${s2.base}/api/v1/versions/${v1.id}`)
    ).json()) as { version: ArtifactVersionDto; content: string };
    expect(afterDetail.content).toBe(contentV1);

    await s2.stop();
  });
});
