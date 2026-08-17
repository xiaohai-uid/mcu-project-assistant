import { describe, expect, it } from "vitest";
import { evaluatePhysicalAcceptance } from "@/src/domain/services/physical-acceptance";

const base = {
  expectedReferenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
  referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
  boardModel: "ESP32-S3-DevKitC-1-N8R8",
  boardRevision: "v1.1",
  buildId: "build-1",
  artifactVersionId: "firmware-v1",
  buildFirmwareSha256: "a".repeat(64),
  device: {
    id: "physical-1", model: "ESP32-S3-DevKitC-1-N8R8", port: "COM9", baudRate: 115200,
    truth: { executionReality: "physical" as const, verification: "verified" as const, physicalVerified: true, adapter: "esp32-arduino-physical" },
    fqbn: "esp32:esp32:esp32s3", vid: "303a", pid: "1001", serialNumber: "fixture",
  },
  now: "2026-08-17T00:00:00.000Z",
};

describe("evaluatePhysicalAcceptance", () => {
  it("accepts only matching physical upload, verification, hash, and serial observation", () => {
    const result = evaluatePhysicalAcceptance({
      ...base,
      flash: {
        exitCode: 0, sessionId: "session-1", buildId: "build-1", artifactVersionId: "firmware-v1", firmwareSha256: "a".repeat(64),
        truth: base.device.truth, fqbn: "esp32:esp32:esp32s3", observedAt: base.now,
      },
      serialObservation: "BOOT: MCU_READY status=ok",
    });
    expect(result.status).toBe("accepted");
    expect(result.uploadStatus).toBe("verified");
    expect(result.verificationStatus).toBe("verified");
    expect(result.serialStatus).toBe("observed");
    expect(result.reason).toBeNull();
  });

  it("keeps port discovery without upload and serial evidence pending", () => {
    const result = evaluatePhysicalAcceptance({ ...base, flash: null, serialObservation: "" });
    expect(result.status).toBe("pending");
    expect(result.uploadStatus).toBe("pending");
    expect(result.serialStatus).toBe("pending");
    expect(result.reason).toMatch(/upload|serial/i);
  });

  it("fails changed hash, companion truth, or unexpected serial output", () => {
    const result = evaluatePhysicalAcceptance({
      ...base,
      device: { ...base.device, truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "companion-local" } },
      flash: {
        exitCode: 0, sessionId: "session-1", buildId: "build-1", artifactVersionId: "firmware-v1", firmwareSha256: "b".repeat(64),
        truth: { executionReality: "companion", verification: "verified", physicalVerified: false, adapter: "companion-local" }, observedAt: base.now,
      },
      serialObservation: "unexpected text",
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/physical|hash|serial/i);
  });

  it("fails closed when physical evidence does not carry the fixed Arduino board FQBN", () => {
    const result = evaluatePhysicalAcceptance({
      ...base,
      device: { ...base.device, fqbn: "esp32:esp32:esp32" },
      flash: {
        exitCode: 0, sessionId: "session-1", buildId: "build-1", artifactVersionId: "firmware-v1", firmwareSha256: "a".repeat(64),
        truth: base.device.truth, fqbn: "esp32:esp32:esp32", observedAt: base.now,
      },
      serialObservation: "BOOT: MCU_READY status=ok",
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/FQBN|board/i);
  });

  it("fails closed when the detected board model is not the exact Reference Kit", () => {
    const result = evaluatePhysicalAcceptance({
      ...base,
      device: { ...base.device, model: "ESP32-S3" },
      flash: {
        exitCode: 0, sessionId: "session-1", buildId: "build-1", artifactVersionId: "firmware-v1", firmwareSha256: "a".repeat(64),
        truth: base.device.truth, fqbn: "esp32:esp32:esp32s3", observedAt: base.now,
      },
      serialObservation: "BOOT: MCU_READY status=ok",
    });
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/model|Reference Kit/i);
  });
});
