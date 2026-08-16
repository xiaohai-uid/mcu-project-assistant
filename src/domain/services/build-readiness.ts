import type { BuildOutputEvidenceDto, BuildStatusDto } from "@/src/shared-contracts/types";
import { ESP32_S3_ARDUINO_CORE_VERSION } from "@/src/domain/services/build-profile";

export type LocalReadyResult = {
  status: "local-ready" | "blocked";
  reasons: string[];
};

export function deriveLocalReady(input: {
  buildStatus: BuildStatusDto;
  exitCode: number | null;
  outputs: BuildOutputEvidenceDto[];
  toolchainEvidence: "real" | "fixture" | "unknown";
  cliVersion: string | null;
  coreVersion: string | null;
  wiringValidation: "pass" | "warn" | "fail" | null;
}): LocalReadyResult {
  const reasons: string[] = [];
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
