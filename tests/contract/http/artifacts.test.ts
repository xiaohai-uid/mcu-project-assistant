// contract/http/artifacts — S2 HTTP surface（implementation-spec §10.1；ISSUE-002 §11）
// POST /projects/:pid/artifacts、POST/GET /artifacts/:aid/versions、GET /versions/:vid
// 错误信封；404/400/409；Idempotency-Key 重放。
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { ArtifactDto, ArtifactVersionDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s2-http-"));
  db = openDatabase(join(dir, "test.db"));
  migrate(db);
  const persistence = createProjectStore(db);
  const events = createNoopEvents();
  const deps: AppDeps = {
    persistence,
    workspaceDir: join(dir, "ws"),
    content: createWorkspaceFilesContent(join(dir, "ws")),
    events,
    tasks: createInProcessTasks({ persistence, events }),
    compiler: createMockCompiler(),
    device: createCompanionLocalDevice(),

    ai: createMockAiProvider(),
    now: () => new Date("2026-08-11T12:00:00.000Z"),
  };
  app = createApp(deps);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
});

async function createProject(): Promise<{ id: string }> {
  const res = await request(app).post("/api/v1/projects").send({ name: "Greenhouse" });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function ensureArtifact(projectId: string, kind: string): Promise<ArtifactDto> {
  const res = await request(app).post(`/api/v1/projects/${projectId}/artifacts`).send({ kind });
  expect(res.status).toBe(201);
  return res.body as ArtifactDto;
}

describe("S2 HTTP surface", () => {
  it("POST /projects/:pid/artifacts：创建 Artifact（201）；同 kind 重复 → 同一实例", async () => {
    const p = await createProject();
    const a1 = await ensureArtifact(p.id, "pinmap");
    const res2 = await request(app).post(`/api/v1/projects/${p.id}/artifacts`).send({ kind: "pinmap" });
    expect(res2.status).toBe(201);
    const a2 = res2.body as ArtifactDto;
    expect(a2.id).toBe(a1.id);
  });

  it("POST /projects/:pid/artifacts：非法 kind → 400 invalid_kind", async () => {
    const p = await createProject();
    const res = await request(app).post(`/api/v1/projects/${p.id}/artifacts`).send({ kind: "build" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_kind");
  });

  it("POST /artifacts/:aid/versions：手动编辑提交 → 201 {version}，version_no 单调", async () => {
    const p = await createProject();
    const a = await ensureArtifact(p.id, "pinmap");
    const v1res = await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({
      content: JSON.stringify({ pins: [{ component: "Relay", pinId: "IO12" }] }),
    });
    expect(v1res.status).toBe(201);
    const v1 = v1res.body as ArtifactVersionDto;
    expect(v1.versionNo).toBe(1);
    expect(v1.status).toBe("accepted");
    expect(v1.sourceKind).toBe("manual");

    const v2res = await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({
      content: JSON.stringify({ pins: [{ component: "Relay", pinId: "IO21" }] }),
    });
    expect(v2res.status).toBe(201);
    const v2 = v2res.body as ArtifactVersionDto;
    expect(v2.versionNo).toBe(2);
  });

  it("GET /artifacts/:aid/versions：版本历史（v1、v2 均在，升序）", async () => {
    const p = await createProject();
    const a = await ensureArtifact(p.id, "pinmap");
    await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({ content: "{}" });
    await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({ content: "{}" });
    const res = await request(app).get(`/api/v1/artifacts/${a.id}/versions`);
    expect(res.status).toBe(200);
    const versions = res.body as ArtifactVersionDto[];
    expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
  });

  it("GET /versions/:vid：版本详情（metadata + content 摘要）", async () => {
    const p = await createProject();
    const a = await ensureArtifact(p.id, "pinmap");
    const content = JSON.stringify({ pins: [{ component: "Relay", pinId: "IO12" }] });
    const vres = await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({ content });
    const v = vres.body as ArtifactVersionDto;
    const res = await request(app).get(`/api/v1/versions/${v.id}`);
    expect(res.status).toBe(200);
    const detail = res.body as { version: ArtifactVersionDto; content: string };
    expect(detail.version.versionNo).toBe(1);
    expect(detail.content).toBe(content);
  });

  it("GET /versions/:vid：不存在 → 404 错误信封", async () => {
    const res = await request(app).get("/api/v1/versions/no-such-version");
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("not_found");
  });

  it("GET /versions/:vid：内容缺失或被篡改 → integrity error，不返回 200/null", async () => {
    const project = await request(app).post("/api/v1/projects").send({ name: "Integrity" });
    const artifact = await request(app).post(`/api/v1/projects/${project.body.id}/artifacts`).send({ kind: "pinmap" });
    const created = await request(app).post(`/api/v1/artifacts/${artifact.body.id}/versions`).send({ content: "{\"pin\":4}" });
    const versionId = created.body.id as string;
    const ref = created.body.contentRef as string;
    const target = join(dir, "ws", ref);

    writeFileSync(target, "tampered", "utf8");
    const mismatch = await request(app).get(`/api/v1/versions/${versionId}`);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("artifact_content_hash_mismatch");
    expect(mismatch.body.content).toBeUndefined();

    unlinkSync(target);
    const missing = await request(app).get(`/api/v1/versions/${versionId}`);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe("artifact_content_missing");
    expect(missing.body.content).toBeUndefined();
  });

  it("POST /artifacts/:aid/versions：Artifact 不存在 → 404", async () => {
    const res = await request(app).post("/api/v1/artifacts/no-such/versions").send({ content: "{}" });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("not_found");
  });

  it("POST /artifacts/:aid/versions：空内容 → 400 invalid_content", async () => {
    const p = await createProject();
    const a = await ensureArtifact(p.id, "pinmap");
    const res = await request(app).post(`/api/v1/artifacts/${a.id}/versions`).send({ content: "" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("invalid_content");
  });

  it("POST /artifacts/:aid/versions：Idempotency-Key 重放 → 同一版本，不产生新行", async () => {
    const p = await createProject();
    const a = await ensureArtifact(p.id, "pinmap");
    const r1 = await request(app)
      .post(`/api/v1/artifacts/${a.id}/versions`)
      .set("Idempotency-Key", "key-1")
      .send({ content: "{}" });
    const r2 = await request(app)
      .post(`/api/v1/artifacts/${a.id}/versions`)
      .set("Idempotency-Key", "key-1")
      .send({ content: "{}" });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const v1 = r1.body as ArtifactVersionDto;
    const v2 = r2.body as ArtifactVersionDto;
    expect(v2.id).toBe(v1.id);
    const res = await request(app).get(`/api/v1/artifacts/${a.id}/versions`);
    const versions = res.body as ArtifactVersionDto[];
    expect(versions).toHaveLength(1);
  });
});
