export const ESP32_S3_REFERENCE_KIT_ID = "esp32-s3-devkitc-1-n8r8-v1.1";
export const ESP32_S3_REFERENCE_KIT_BOARD_MODEL = "ESP32-S3-DevKitC-1-N8R8";
export const ESP32_S3_REFERENCE_KIT_BOARD_REVISION = "v1.1";
export const ESP32_S3_ARDUINO_CORE_PACKAGE = "esp32:esp32";
export const ESP32_S3_ARDUINO_CORE_VERSION = "3.3.11";
export const ESP32_S3_ARDUINO_FQBN = "esp32:esp32:esp32s3";

export const ESP32_S3_ARDUINO_OPTIONS = {
  FlashMode: "qio",
  FlashSize: "8M",
  PSRAM: "opi",
  PartitionScheme: "default_8MB",
} as const;

export interface ArduinoBuildProfile {
  target: "esp32-s3";
  referenceKitId: typeof ESP32_S3_REFERENCE_KIT_ID;
  fqbn: typeof ESP32_S3_ARDUINO_FQBN;
  resolvedFqbn: string;
  corePackage: typeof ESP32_S3_ARDUINO_CORE_PACKAGE;
  coreVersion: typeof ESP32_S3_ARDUINO_CORE_VERSION;
  options: typeof ESP32_S3_ARDUINO_OPTIONS;
}

export interface ToolchainPinningProbe {
  available: boolean;
  version: string | null;
  coreVersion?: string | null;
  corePackage?: string | null;
}

export interface ToolchainPinningDiagnostic {
  code: "TOOLCHAIN_UNAVAILABLE" | "ARDUINO_CLI_VERSION_MISSING" | "ARDUINO_CORE_PACKAGE_MISMATCH" | "ARDUINO_CORE_VERSION_MISMATCH";
  message: string;
}

export function resolveArduinoBuildProfile(target: string, referenceKitId: string): ArduinoBuildProfile {
  if (target !== "esp32-s3") throw new Error(`Unsupported Arduino build target: ${target}`);
  if (referenceKitId !== ESP32_S3_REFERENCE_KIT_ID) {
    throw new Error(`Exact ESP32-S3 Reference Kit required before build: ${ESP32_S3_REFERENCE_KIT_ID}`);
  }
  const options = ESP32_S3_ARDUINO_OPTIONS;
  const resolvedOptions = Object.entries(options).map(([key, value]) => `${key}=${value}`).join(",");
  return {
    target: "esp32-s3",
    referenceKitId: ESP32_S3_REFERENCE_KIT_ID,
    fqbn: ESP32_S3_ARDUINO_FQBN,
    resolvedFqbn: `${ESP32_S3_ARDUINO_FQBN}:${resolvedOptions}`,
    corePackage: ESP32_S3_ARDUINO_CORE_PACKAGE,
    coreVersion: ESP32_S3_ARDUINO_CORE_VERSION,
    options,
  };
}

export function toolchainPinningDiagnostics(probe: ToolchainPinningProbe): ToolchainPinningDiagnostic[] {
  if (!probe.available) return [{ code: "TOOLCHAIN_UNAVAILABLE", message: "Arduino CLI toolchain is unavailable" }];
  if (!probe.version) return [{ code: "ARDUINO_CLI_VERSION_MISSING", message: "Arduino CLI version was not recorded" }];
  const diagnostics: ToolchainPinningDiagnostic[] = [];
  if (probe.corePackage !== undefined && probe.corePackage !== ESP32_S3_ARDUINO_CORE_PACKAGE) {
    diagnostics.push({
      code: "ARDUINO_CORE_PACKAGE_MISMATCH",
      message: `Expected Arduino core ${ESP32_S3_ARDUINO_CORE_PACKAGE}, found ${probe.corePackage ?? "unknown"}`,
    });
  }
  if (probe.coreVersion !== undefined && probe.coreVersion !== ESP32_S3_ARDUINO_CORE_VERSION) {
    diagnostics.push({
      code: "ARDUINO_CORE_VERSION_MISMATCH",
      message: `Expected Arduino-ESP32 core ${ESP32_S3_ARDUINO_CORE_VERSION}, found ${probe.coreVersion ?? "unknown"}`,
    });
  }
  return diagnostics;
}
