import { describe, expect, it } from "vitest";
import type { BuildRecord } from "@/src/domain/models/build-record";
import { deriveCommercialReadiness } from "@/src/domain/services/commercial-readiness";

const NOW = "2026-08-16T00:00:00.000Z";

function build(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: "build-1",
    artifactVersionId: "firmware-v1",
    taskId: "task-1",
    target: "esp32-s3",
    toolchain: "esp32-arduino",
    toolchainVersion: "arduino-cli 1.5.0",
    toolchainCoreVersion: "3.3.11",
    toolchainEvidence: "real",
    options: { resolvedFqbn: "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB" },
    status: "succeeded",
    startedAt: NOW,
    completedAt: NOW,
    stdoutRef: ".build/build-1.log",
    stderrRef: null,
    exitCode: 0,
    diagnostics: [],
    sourceDir: "firmware/0001/src",
    outputDir: ".build/build-1/output",
    command: ["arduino-cli", "compile"],
    outputs: [{ path: ".build/build-1/output/firmware.bin", kind: "bin", sizeBytes: 12, sha256: "a".repeat(64) }],
    readinessStatus: "local-ready",
    readinessReasons: [],
    ...overrides,
  };
}

describe("deriveCommercialReadiness", () => {
  it("requires local build and physical truth before paid release", () => {
    const report = deriveCommercialReadiness({
      projectId: "project-1",
      generatedAt: NOW,
      hardware: { referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1", versionId: "hardware-v1", observedAt: NOW },
      wiring: { versionId: "pinmap-v1", validation: { id: "validation-1", artifactVersionId: "pinmap-v1", kind: "pinmap", rules: [], result: "pass", diagnostics: [], startedAt: NOW, completedAt: NOW } },
      build: build(),
      simulation: null,
      physical: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "companion-local" },
    });

    expect(report.gates.find((gate) => gate.id === "local-ready")?.status).toBe("ready");
    expect(report.gates.find((gate) => gate.id === "simulation-ready")?.status).toBe("unavailable");
    expect(report.gates.find((gate) => gate.id === "physical-accepted")?.status).toBe("unavailable");
    expect(report.gates.find((gate) => gate.id === "paid-release-ready")?.status).toBe("blocked");
    expect(report.conclusion.status).toBe("pending");
    expect(report.conclusion.text).not.toMatch(/%/);
  });

  it("does not pass a failed or fixture-only build", () => {
    const report = deriveCommercialReadiness({
      projectId: "project-1",
      generatedAt: NOW,
      hardware: { referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1", versionId: "hardware-v1", observedAt: NOW },
      wiring: { versionId: "pinmap-v1", validation: null },
      build: build({ status: "failed", readinessStatus: "blocked", readinessReasons: ["build_not_succeeded"], toolchainEvidence: "fixture" }),
      simulation: null,
      physical: null,
    });

    expect(report.gates.find((gate) => gate.id === "local-ready")?.status).toBe("blocked");
    expect(report.gates.find((gate) => gate.id === "paid-release-ready")?.status).toBe("blocked");
    expect(report.conclusion.status).toBe("blocked");
  });

  it("only passes paid release when physical truth is explicitly verified", () => {
    const report = deriveCommercialReadiness({
      projectId: "project-1",
      generatedAt: NOW,
      hardware: { referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1", versionId: "hardware-v1", observedAt: NOW },
      wiring: { versionId: "pinmap-v1", validation: { id: "validation-1", artifactVersionId: "pinmap-v1", kind: "pinmap", rules: [], result: "pass", diagnostics: [], startedAt: NOW, completedAt: NOW } },
      build: build(),
      simulation: { executionReality: "simulation", verification: "verified", physicalVerified: false, adapter: "simulator" },
      physical: { executionReality: "physical", verification: "verified", physicalVerified: true, adapter: "esp32-arduino-physical" },
      physicalAcceptance: {
        id: "acceptance-1", projectId: "project-1", buildId: "build-1", artifactVersionId: "firmware-v1",
        referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1", boardModel: "ESP32-S3-DevKitC-1-N8R8", boardRevision: "v1.1",
        deviceId: "physical-device", usbPort: "COM9", usbVid: "303a", usbPid: "1001", usbSerialNumber: "fixture",
        firmwareSha256: "a".repeat(64), uploadStatus: "verified", verificationStatus: "verified", serialStatus: "observed",
        serialObservation: "MCU_READY", status: "accepted", reason: null, createdAt: NOW, completedAt: NOW,
      },
    });

    expect(report.gates.every((gate) => gate.status === "ready")).toBe(true);
    expect(report.conclusion.status).toBe("ready");
  });
});
