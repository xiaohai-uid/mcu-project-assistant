// S10 Commercial Golden Journey — proposal confirmation → delivery report.
// The device adapter is intentionally companion-local: the fixture proves that
// companion evidence cannot be promoted to physical acceptance or paid release.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "@/src/adapters/http/app";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createMockAiProvider } from "@/src/adapters/ai/mock";
import { createMockCompiler } from "@/src/adapters/compiler/mock";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import { openDatabase, type SqliteDb } from "@/src/adapters/persistence/sqlite/connection";
import { migrate } from "@/src/adapters/persistence/sqlite/migrations";
import { createProjectStore } from "@/src/adapters/persistence/sqlite/project-store";
import type { DeliveryReportDto, ProjectDto, ProposalDto } from "@/src/shared-contracts/types";

let dir: string;
let db: SqliteDb;

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

const waitFor = async (fn: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout waiting for commercial golden journey");
};

describe("S10 Commercial Golden Journey", () => {
  it("runs the confirmed proposal path and reports every saved evidence boundary", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcu-s10-e2e-"));
    const workspaceDir = join(dir, "workspace");
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
    });

    const projectResponse = await request(app).post("/api/v1/projects").send({ name: "Commercial greenhouse" });
    expect(projectResponse.status).toBe(201);
    const project = projectResponse.body as ProjectDto;

    const analysis = await request(app).post(`/api/v1/projects/${project.id}/commands`).send({
      capability: "analyze_requirement",
      payload: { description: "greenhouse monitor with soil moisture, relay pump, and OLED display" },
    });
    expect(analysis.status).toBe(202);
    const taskId = (analysis.body as { taskId: string }).taskId;
    await new Promise((resolve) => setTimeout(resolve, 700));
    const clarification = await request(app).post(`/api/v1/commands/${taskId}/clarification`).send({ roundId: 1, answer: "0.96 inch" });
    expect([200, 202]).toContain(clarification.status);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const proposalsResponse = await request(app).get(`/api/v1/projects/${project.id}/proposals`);
    const proposals = proposalsResponse.body as ProposalDto[];
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      const decision = await request(app).post(`/api/v1/proposals/${proposal.id}/decision`).send({ decision: "accept" });
      expect(decision.status).toBe(200);
    }
    expect((await request(app).post(`/api/v1/projects/${project.id}/requirements/commit`)).status).toBe(200);

    const selected = await request(app).post(`/api/v1/projects/${project.id}/commands`).send({ capability: "select_mcu", payload: { mcuId: "ESP32-S3" } });
    expect(selected.status).toBe(200);
    const pinmap = await request(app).post(`/api/v1/projects/${project.id}/commands`).send({ capability: "generate_pin_map", payload: {} });
    expect(pinmap.status).toBe(200);
    const validation = await request(app).post(`/api/v1/versions/${(pinmap.body as { version: { id: string } }).version.id}/validations`);
    expect(validation.status).toBe(201);
    expect((validation.body as { result: string }).result).toBe("warn");

    const firmwareProposal = await request(app).post(`/api/v1/projects/${project.id}/commands`).send({ capability: "generate_firmware", payload: {} });
    expect(firmwareProposal.status).toBe(200);
    const firmwareDecision = await request(app).post(`/api/v1/proposals/${(firmwareProposal.body as { proposal: ProposalDto }).proposal.id}/decision`).send({ decision: "accept" });
    expect(firmwareDecision.status).toBe(200);
    const artifacts = (await request(app).get(`/api/v1/projects/${project.id}/artifacts`)).body as Array<{ id: string; kind: string }>;
    const pinmapArtifact = artifacts.find((artifact) => artifact.kind === "pinmap") as { id: string; currentVersionId?: string } | undefined;
    expect(pinmapArtifact?.currentVersionId).toBeTruthy();
    const finalValidation = await request(app).post(`/api/v1/versions/${pinmapArtifact!.currentVersionId}/validations`);
    expect(finalValidation.status).toBe(201);
    expect((finalValidation.body as { result: string }).result).toBe("warn");
    const firmware = artifacts.find((artifact) => artifact.kind === "firmware");
    expect(firmware).toBeTruthy();
    const versions = (await request(app).get(`/api/v1/artifacts/${firmware!.id}/versions`)).body as Array<{ id: string }>;
    const firmwareVersionId = versions.at(-1)!.id;

    const buildSubmission = await request(app).post(`/api/v1/projects/${project.id}/builds`).send({ versionId: firmwareVersionId });
    expect(buildSubmission.status).toBe(202);
    const buildId = (buildSubmission.body as { buildId: string }).buildId;
    await waitFor(async () => ((await request(app).get(`/api/v1/builds/${buildId}`)).body as { status: string }).status === "succeeded");
    const build = (await request(app).get(`/api/v1/builds/${buildId}`)).body as { outputs: Array<{ kind: string; sha256: string }> };
    expect(build.outputs.some((output) => output.kind === "bin" && output.sha256.length === 64)).toBe(true);

    const deviceResponse = await request(app).post("/api/v1/device/detect");
    const device = deviceResponse.body as { id: string };
    const token = (await request(app).post("/api/v1/device/flash-token").send({ deviceId: device.id })).body as { token: string };
    const flash = await request(app).post("/api/v1/device/flash").send({ deviceId: device.id, confirmationToken: token.token, projectId: project.id, buildId, artifactVersionId: firmwareVersionId });
    expect(flash.status).toBe(202);
    const acceptance = await request(app).post(`/api/v1/projects/${project.id}/physical-acceptance`).send({ buildId, artifactVersionId: firmwareVersionId, serialObservation: "MCU_READY" });
    expect(acceptance.status).toBe(201);
    expect((acceptance.body as { status: string }).status).toBe("failed");

    const item = await request(app).post(`/api/v1/projects/${project.id}/bom/items`).send({
      componentId: "sensor.soil_moisture",
      displayName: "Soil moisture module exact fixture",
      identityStatus: "exact",
      manufacturer: "Fixture Manufacturer",
      manufacturerPartNumber: "SM-001",
      supplierSku: "C90001",
      quantity: 1,
    });
    expect(item.status).toBe(201);
    const observation = await request(app).post(`/api/v1/projects/${project.id}/bom/items/${(item.body as { id: string }).id}/price-observations`).send({
      supplierSku: "C90001",
      quantityTier: 1,
      unitPrice: 12.5,
      lineTotal: 12.5,
      shipping: null,
      tax: null,
      fees: null,
      stockStatus: "in-stock",
      sourceUrl: "https://so.szlcsc.com/global.html?k=C90001",
    });
    expect(observation.status).toBe(201);

    const reportResponse = await request(app).get(`/api/v1/projects/${project.id}/delivery-report`);
    expect(reportResponse.status).toBe(200);
    const report = reportResponse.body as DeliveryReportDto;
    expect(report.hardware.identity?.referenceKitId).toBe("esp32-s3-devkitc-1-n8r8-v1.1");
    expect(report.wiring.validation?.result).toBe("warn");
    expect(report.bom.items.some((bomItem) => bomItem.componentId === "sensor.soil_moisture" && bomItem.identityStatus === "exact")).toBe(true);
    expect(report.bom.items.some((bomItem) => bomItem.componentId === "sensor.soil_moisture" && bomItem.identityStatus === "unresolved")).toBe(false);
    expect(report.build?.outputs.some((output) => output.kind === "bin" && output.sha256.length === 64)).toBe(true);
    expect(report.physicalAcceptance?.status).toBe("failed");
    expect(report.priceObservationTimestamps).toHaveLength(1);
    expect(report.simulation.status).toBe("not-run");
    expect(report.gates.find((gate) => gate.id === "paid-release-ready")?.status).toBe("blocked");
    expect(report.risks.some((risk) => risk.id === "physical-acceptance" && risk.severity === "required")).toBe(true);
  });
});
