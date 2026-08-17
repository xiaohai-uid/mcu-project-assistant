import type { BuildOutputEvidenceDto, BuildStatusDto } from "@/src/shared-contracts/types";
import {
  ESP32_S3_ARDUINO_CORE_PACKAGE,
  ESP32_S3_ARDUINO_CORE_VERSION,
  ESP32_S3_ARDUINO_FQBN,
  ESP32_S3_ARDUINO_OPTIONS,
  ESP32_S3_REFERENCE_KIT_ID,
} from "@/src/domain/services/build-profile";

export type LocalReadyResult = {
  status: "local-ready" | "blocked";
  reasons: string[];
};

function hasPinnedBuildProfile(target: string, options: Record<string, unknown>): boolean {
  const fqbnOptions = options.fqbnOptions;
  const expectedOptions = ESP32_S3_ARDUINO_OPTIONS as Record<string, string>;
  const hasExactMenuOptions = Boolean(
    fqbnOptions
      && typeof fqbnOptions === "object"
      && !Array.isArray(fqbnOptions)
      && Object.keys(fqbnOptions).length === Object.keys(expectedOptions).length
      && Object.entries(expectedOptions).every(([key, value]) => (fqbnOptions as Record<string, unknown>)[key] === value),
  );
  const resolvedFqbn = `${ESP32_S3_ARDUINO_FQBN}:${Object.entries(expectedOptions).map(([key, value]) => `${key}=${value}`).join(",")}`;
  return target === "esp32-s3"
    && options.referenceKitId === ESP32_S3_REFERENCE_KIT_ID
    && options.fqbn === ESP32_S3_ARDUINO_FQBN
    && options.resolvedFqbn === resolvedFqbn
    && options.corePackage === ESP32_S3_ARDUINO_CORE_PACKAGE
    && options.coreVersion === ESP32_S3_ARDUINO_CORE_VERSION
    && hasExactMenuOptions;
}

export function deriveLocalReady(input: {
  target: string;
  options: Record<string, unknown>;
  buildStatus: BuildStatusDto;
  exitCode: number | null;
  outputs: BuildOutputEvidenceDto[];
  toolchainEvidence: "real" | "fixture" | "unknown";
  cliVersion: string | null;
  coreVersion: string | null;
  wiringValidation: "pass" | "warn" | "fail" | null;
}): LocalReadyResult {
  const reasons: string[] = [];
  if (!hasPinnedBuildProfile(input.target, input.options)) reasons.push("pinned_build_profile_mismatch");
  if (input.buildStatus !== "succeeded" || input.exitCode !== 0) reasons.push("build_not_succeeded");
  if (!input.outputs.some((output) => output.kind === "bin" && output.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(output.sha256))) {
    reasons.push("artifact_hash_missing");
  }
  if (input.toolchainEvidence !== "real") reasons.push("toolchain_not_real");
  if (!input.cliVersion) reasons.push("arduino_cli_version_missing");
  if (input.coreVersion !== ESP32_S3_ARDUINO_CORE_VERSION) reasons.push("arduino_core_version_mismatch");
  if (input.wiringValidation !== "pass") reasons.push("wiring_validation_not_passed");
  return { status: reasons.length === 0 ? "local-ready" : "blocked", reasons };
}
