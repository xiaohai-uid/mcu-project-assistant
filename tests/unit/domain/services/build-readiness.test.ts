import { describe, expect, it } from "vitest";
import { deriveLocalReady } from "@/src/domain/services/build-readiness";

const output = { path: "firmware.bin", kind: "bin" as const, sizeBytes: 12, sha256: "a".repeat(64) };
const pinnedOptions = {
  referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
  fqbn: "esp32:esp32:esp32s3",
  resolvedFqbn: "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB",
  corePackage: "esp32:esp32",
  coreVersion: "3.3.11",
  fqbnOptions: { FlashMode: "qio", FlashSize: "8M", PSRAM: "opi", PartitionScheme: "default_8MB" },
};

describe("local-ready derivation", () => {
  it("requires a real pinned build and a passing wiring validation", () => {
    expect(deriveLocalReady({
      target: "esp32-s3",
      options: pinnedOptions,
      buildStatus: "succeeded",
      exitCode: 0,
      outputs: [output],
      toolchainEvidence: "real",
      cliVersion: "arduino-cli 1.5.0",
      coreVersion: "3.3.11",
      wiringValidation: "pass",
    })).toEqual({ status: "local-ready", reasons: [] });
  });

  it("keeps successful fixture builds or missing validation blocked", () => {
    expect(deriveLocalReady({
      target: "esp32-s3",
      options: pinnedOptions,
      buildStatus: "succeeded",
      exitCode: 0,
      outputs: [output],
      toolchainEvidence: "fixture",
      cliVersion: "fixture",
      coreVersion: "3.3.11",
      wiringValidation: null,
    })).toEqual({
      status: "blocked",
      reasons: ["toolchain_not_real", "wiring_validation_not_passed"],
    });
  });

  it("reports missing evidence independently instead of collapsing to one boolean", () => {
    expect(deriveLocalReady({
      target: "esp32-s3",
      options: pinnedOptions,
      buildStatus: "failed",
      exitCode: 1,
      outputs: [],
      toolchainEvidence: "real",
      cliVersion: null,
      coreVersion: "3.2.0",
      wiringValidation: "warn",
    }).reasons).toEqual(expect.arrayContaining([
      "build_not_succeeded",
      "arduino_cli_version_missing",
      "arduino_core_version_mismatch",
      "artifact_hash_missing",
      "wiring_validation_not_passed",
    ]));
  });

  it("blocks real evidence when the persisted target or resolved board options are not pinned", () => {
    const result = deriveLocalReady({
      buildStatus: "succeeded",
      exitCode: 0,
      outputs: [output],
      toolchainEvidence: "real",
      cliVersion: "arduino-cli 1.5.0",
      coreVersion: "3.3.11",
      wiringValidation: "pass",
      target: "esp32-s3",
      options: {
        referenceKitId: "esp32-s3-devkitc-1-n8r8-v1.1",
        fqbn: "esp32:esp32:esp32s3",
        resolvedFqbn: "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=qspi,PartitionScheme=default_8MB",
        fqbnOptions: { FlashMode: "qio", FlashSize: "8M", PSRAM: "qspi", PartitionScheme: "default_8MB" },
      },
    } as Parameters<typeof deriveLocalReady>[0] & { target: string; options: Record<string, unknown> });
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("pinned_build_profile_mismatch");
  });
});
