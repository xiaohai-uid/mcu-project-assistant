import { describe, expect, it } from "vitest";
import { deriveDeliveryReport } from "@/src/domain/services/delivery-report";
import type { BomItemWithObservationsDto, ProjectBomDto } from "@/src/shared-contracts/types";

const bom = (items: BomItemWithObservationsDto[]): ProjectBomDto => ({
  projectId: "project-1",
  generatedAt: "2026-08-17T00:00:00.000Z",
  items,
});

const exactComponent: BomItemWithObservationsDto = {
  id: "bom-1",
  projectId: "project-1",
  componentId: "display.oled_096",
  displayName: "0.96 inch OLED",
  sourceKind: "system-suggestion",
  identityStatus: "exact",
  manufacturer: "Waveshare",
  manufacturerPartNumber: "OLED-096",
  supplierSku: "C12345",
  quantity: 1,
  unresolvedReason: null,
  createdAt: "2026-08-16T00:00:00.000Z",
  priceObservations: [{
    id: "price-1",
    bomItemId: "bom-1",
    supplier: "LCSC",
    supplierSku: "C12345",
    manufacturerPartNumber: "OLED-096",
    quantityTier: 1,
    currency: "CNY",
    unitPrice: 8.5,
    lineTotal: 8.5,
    shipping: null,
    tax: null,
    fees: null,
    stockStatus: "in-stock",
    sourceUrl: "https://so.szlcsc.com/global.html?k=C12345",
    observedAt: "2026-08-16T01:00:00.000Z",
  }],
};

const baseInput = {
  projectId: "project-1",
  projectName: "Greenhouse",
  generatedAt: "2026-08-17T00:00:00.000Z",
  hardware: {
    versionId: "hardware-v1",
    identity: {
      referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
      boardModel: "ESP32-S3-DevKitC-1-N8R8",
      boardRevision: "v1.1",
      moduleModel: "ESP32-S3-WROOM-1-N8R8",
      manufacturer: "Espressif",
      source: null,
    },
    observedAt: "2026-08-16T00:00:00.000Z",
  },
  wiring: {
    versionId: "pinmap-v1",
    validation: {
      id: "validation-1",
      artifactVersionId: "pinmap-v1",
      kind: "wiring",
      rules: ["no-boot-conflict"],
      result: "pass" as const,
      diagnostics: [],
      startedAt: "2026-08-16T00:00:00.000Z",
      completedAt: "2026-08-16T00:01:00.000Z",
    },
  },
  build: {
    id: "build-1",
    artifactVersionId: "firmware-v1",
    taskId: null,
    target: "esp32:esp32:esp32s3",
    toolchain: "arduino-cli",
    toolchainVersion: "1.3.1",
    toolchainCoreVersion: "3.3.11",
    toolchainEvidence: "real" as const,
    options: {},
    status: "succeeded" as const,
    startedAt: "2026-08-16T00:02:00.000Z",
    completedAt: "2026-08-16T00:03:00.000Z",
    stdoutRef: ".build/build-1.log",
    stderrRef: null,
    exitCode: 0,
    diagnostics: [],
    sourceDir: "workspace/.build/build-1/src",
    outputDir: "workspace/.build/build-1/out",
    command: ["arduino-cli", "compile"],
    outputs: [{ path: "workspace/.build/build-1/out/firmware.bin", kind: "bin" as const, sizeBytes: 12, sha256: "a".repeat(64) }],
    readinessStatus: "local-ready" as const,
    readinessReasons: [],
  },
  physical: {
    executionReality: "physical" as const,
    verification: "verified" as const,
    physicalVerified: true,
    adapter: "esp32-arduino-physical",
  },
  physicalAcceptance: {
    id: "acceptance-1",
    projectId: "project-1",
    buildId: "build-1",
    artifactVersionId: "firmware-v1",
    referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
    boardModel: "ESP32-S3-DevKitC-1-N8R8",
    boardRevision: "v1.1",
    deviceId: "usb-1",
    usbPort: "COM7",
    usbVid: "303a",
    usbPid: "1001",
    usbSerialNumber: "serial-1",
    firmwareSha256: "a".repeat(64),
    uploadStatus: "verified" as const,
    verificationStatus: "verified" as const,
    serialStatus: "observed" as const,
    serialObservation: "MCU_READY",
    status: "accepted" as const,
    reason: null,
    createdAt: "2026-08-16T00:04:00.000Z",
    completedAt: "2026-08-16T00:05:00.000Z",
  },
  simulation: null,
  bom: bom([exactComponent]),
};

describe("deriveDeliveryReport", () => {
  it("includes the approved identity, evidence, BOM timestamps, and optional simulation as not-run", () => {
    const report = deriveDeliveryReport(baseInput);

    expect(report.conclusion.status).toBe("ready");
    expect(report.hardware.identity?.referenceKitId).toBe("esp32-s3-devkitc-1-n8r8-v1.1");
    expect(report.build?.outputs[0]?.sha256).toBe("a".repeat(64));
    expect(report.physicalAcceptance?.id).toBe("acceptance-1");
    expect(report.bom.items[0]?.priceObservations[0]?.observedAt).toBe("2026-08-16T01:00:00.000Z");
    expect(report.simulation.status).toBe("not-run");
    expect(report.risks).toEqual([]);
  });

  it("keeps local readiness independent from optional simulation and reports missing physical evidence as required risk", () => {
    const report = deriveDeliveryReport({
      ...baseInput,
      physical: null,
      physicalAcceptance: null,
      bom: bom([{ ...exactComponent, identityStatus: "unresolved", manufacturer: null, manufacturerPartNumber: null, supplierSku: null, unresolvedReason: "Part number pending." }]),
    });

    expect(report.gates.find((gate) => gate.id === "local-ready")?.status).toBe("ready");
    expect(report.gates.find((gate) => gate.id === "simulation-ready")?.status).toBe("unavailable");
    expect(report.gates.find((gate) => gate.id === "paid-release-ready")?.status).toBe("blocked");
    expect(report.simulation.status).toBe("not-run");
    expect(report.risks.map((risk) => risk.id)).toEqual(["physical-acceptance", "bom-unresolved:bom-1"]);
    expect(report.risks[0]?.severity).toBe("required");
  });
});
