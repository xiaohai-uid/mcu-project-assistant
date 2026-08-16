import { describe, expect, it } from "vitest";
import {
  ESP32_S3_ARDUINO_CORE_PACKAGE,
  ESP32_S3_ARDUINO_CORE_VERSION,
  ESP32_S3_REFERENCE_KIT_ID,
  resolveArduinoBuildProfile,
  toolchainPinningDiagnostics,
} from "@/src/domain/services/build-profile";

describe("pinned Arduino build profile", () => {
  it("resolves the first Reference Kit to the exact ESP32-S3 menu options", () => {
    const profile = resolveArduinoBuildProfile("esp32-s3", ESP32_S3_REFERENCE_KIT_ID);

    expect(profile).toMatchObject({
      target: "esp32-s3",
      referenceKitId: ESP32_S3_REFERENCE_KIT_ID,
      fqbn: "esp32:esp32:esp32s3",
      corePackage: ESP32_S3_ARDUINO_CORE_PACKAGE,
      coreVersion: ESP32_S3_ARDUINO_CORE_VERSION,
      options: {
        FlashMode: "qio",
        FlashSize: "8M",
        PSRAM: "opi",
        PartitionScheme: "default_8MB",
      },
    });
    expect(profile.resolvedFqbn).toBe(
      "esp32:esp32:esp32s3:FlashMode=qio,FlashSize=8M,PSRAM=opi,PartitionScheme=default_8MB",
    );
  });

  it("rejects a family board identity instead of silently compiling it", () => {
    expect(() => resolveArduinoBuildProfile("esp32-s3", "ESP32-S3")).toThrow(/Reference Kit/i);
  });

  it("keeps CLI and Arduino core version failures separate", () => {
    expect(toolchainPinningDiagnostics({ available: false, version: null, coreVersion: null, corePackage: null })).toEqual([
      expect.objectContaining({ code: "TOOLCHAIN_UNAVAILABLE" }),
    ]);
    expect(toolchainPinningDiagnostics({ available: true, version: "arduino-cli 1.5.0", coreVersion: "3.2.0", corePackage: ESP32_S3_ARDUINO_CORE_PACKAGE })).toEqual([
      expect.objectContaining({ code: "ARDUINO_CORE_VERSION_MISMATCH" }),
    ]);
    expect(toolchainPinningDiagnostics({ available: true, version: null, coreVersion: ESP32_S3_ARDUINO_CORE_VERSION, corePackage: ESP32_S3_ARDUINO_CORE_PACKAGE })).toEqual([
      expect.objectContaining({ code: "ARDUINO_CLI_VERSION_MISSING" }),
    ]);
  });
});
