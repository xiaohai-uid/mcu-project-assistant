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

let dir: string;
let db: SqliteDb;

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

describe("BOM and LCSC observation surface", () => {
  it("stores quantity tiers separately and exports source-backed CSV/Markdown without ordering", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcu-bom-http-"));
    const workspaceDir = join(dir, "ws");
    db = openDatabase(join(dir, "test.db"));
    migrate(db);
    const persistence = createProjectStore(db);
    const events = createNoopEvents();
    const app = createApp({
      persistence,
      workspaceDir,
      content: createWorkspaceFilesContent(workspaceDir),
      events,
      tasks: createInProcessTasks({ persistence, events }),
      compiler: createMockCompiler(),
      device: createCompanionLocalDevice(),
      ai: createMockAiProvider({ slow: false }),
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    } satisfies AppDeps);
    const project = await request(app).post("/api/v1/projects").send({ name: "BOM" });
    const projectId = (project.body as { id: string }).id;
    const item = await request(app).post(`/api/v1/projects/${projectId}/bom/items`).send({
      componentId: "sensor.bmp280", displayName: "BMP280", identityStatus: "exact", manufacturer: "Bosch Sensortec", manufacturerPartNumber: "BMP280", supplierSku: "C25879", quantity: 1,
    });
    expect(item.status).toBe(201);
    for (const quantityTier of [1, 10, 100]) {
      const observation = await request(app).post(`/api/v1/projects/${projectId}/bom/items/${item.body.id}/price-observations`).send({
        supplierSku: "C25879", quantityTier, unitPrice: quantityTier === 1 ? 3.2 : null, lineTotal: null, shipping: quantityTier === 1 ? 5 : null, tax: null, fees: null, stockStatus: "unknown", sourceUrl: "https://so.szlcsc.com/global.html?k=C25879",
      });
      expect(observation.status).toBe(201);
    }
    const bom = await request(app).get(`/api/v1/projects/${projectId}/bom`);
    expect(bom.status).toBe(200);
    expect(bom.body.items[0].priceObservations.map((row: { quantityTier: number }) => row.quantityTier)).toEqual([1, 10, 100]);
    const csv = await request(app).get(`/api/v1/projects/${projectId}/bom/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.body.content).toContain("supplier_sku");
    const markdown = await request(app).get(`/api/v1/projects/${projectId}/bom/export?format=markdown`);
    expect(markdown.status).toBe(200);
    expect(markdown.body.content).toContain("采购观察");
  });
});
