import type { BuildRecord } from "@/src/domain/models/build-record";
import {
  ESP32_S3_REFERENCE_KIT_BOARD_MODEL,
  ESP32_S3_REFERENCE_KIT_BOARD_REVISION,
  ESP32_S3_REFERENCE_KIT_ID,
} from "@/src/domain/services/build-profile";
import { deriveLocalReady } from "@/src/domain/services/build-readiness";
import type { DeviceTruthDto, ValidationRecordDto, CommercialReadinessReportDto, PhysicalAcceptanceRecordDto, ReadinessEvidenceDto, ReadinessGateDto } from "@/src/shared-contracts/types";

export interface CommercialReadinessInput {
  projectId: string;
  generatedAt: string;
  hardware: { referenceKitId: string | null; versionId: string | null; observedAt: string | null };
  wiring: { versionId: string | null; validation: ValidationRecordDto | null };
  build: BuildRecord | null;
  simulation: DeviceTruthDto | null;
  physical: DeviceTruthDto | null;
  physicalAcceptance?: PhysicalAcceptanceRecordDto | null;
}

function evidence(kind: string, ref: string, observedAt: string, detail: string): ReadinessEvidenceDto {
  return { kind, ref, observedAt, detail };
}

function gate(
  id: ReadinessGateDto["id"],
  status: ReadinessGateDto["status"],
  reason: string | null,
  nextAction: string | null,
  evidenceRefs: ReadinessEvidenceDto[],
): ReadinessGateDto {
  const titles: Record<ReadinessGateDto["id"], string> = {
    "local-ready": "Local build ready",
    "simulation-ready": "Simulation ready",
    "physical-accepted": "Physical acceptance",
    "paid-release-ready": "Paid release ready",
  };
  return { id, status, title: titles[id], reason, nextAction, evidence: evidenceRefs };
}

function acceptedPhysicalEvidenceMismatch(acceptance: PhysicalAcceptanceRecordDto, build: BuildRecord | null): string | null {
  const binary = build?.outputs.find((output) => output.kind === "bin" && output.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(output.sha256));
  if (!build || acceptance.buildId !== build.id || acceptance.artifactVersionId !== build.artifactVersionId) {
    return "Saved physical acceptance evidence does not match the current build.";
  }
  if (acceptance.referenceKitId !== ESP32_S3_REFERENCE_KIT_ID || acceptance.boardModel !== ESP32_S3_REFERENCE_KIT_BOARD_MODEL || acceptance.boardRevision !== ESP32_S3_REFERENCE_KIT_BOARD_REVISION) {
    return "Saved physical acceptance evidence does not match the fixed Reference Kit identity.";
  }
  if (!binary || acceptance.firmwareSha256 !== binary.sha256) {
    return "Saved physical acceptance firmware hash does not match the current build artifact.";
  }
  if (!acceptance.deviceId || !acceptance.usbPort || acceptance.uploadStatus !== "verified" || acceptance.verificationStatus !== "verified" || acceptance.serialStatus !== "observed" || !acceptance.serialObservation || !/MCU_READY|BOOT|READY|STATUS|HELLO/i.test(acceptance.serialObservation)) {
    return "Saved physical acceptance evidence is incomplete for the current build.";
  }
  return null;
}

function physicalGate(truth: DeviceTruthDto | null, acceptance: PhysicalAcceptanceRecordDto | null, generatedAt: string, build: BuildRecord | null): ReadinessGateDto {
  if (!acceptance) {
    const truthEvidence = truth ? [evidence("device-truth", truth.adapter, generatedAt, `Observed execution reality: ${truth.executionReality}; verification: ${truth.verification}.`)] : [];
    const status = truth?.executionReality === "physical" ? "pending" : truth ? "unavailable" : "pending";
    return gate("physical-accepted", status, "No complete physical acceptance record has been saved.", "Connect the exact board, upload the saved build, verify it, and record serial evidence.", truthEvidence);
  }
  const acceptanceEvidence = [evidence("physical-acceptance", acceptance.id, acceptance.completedAt ?? acceptance.createdAt, `Board ${acceptance.boardModel} ${acceptance.boardRevision}; upload=${acceptance.uploadStatus}; verify=${acceptance.verificationStatus}; serial=${acceptance.serialStatus}.`)];
  if (truth) acceptanceEvidence.push(evidence("device-truth", truth.adapter, generatedAt, `Observed execution reality: ${truth.executionReality}; verification: ${truth.verification}.`));
  if (acceptance.status === "accepted") {
    const mismatch = acceptedPhysicalEvidenceMismatch(acceptance, build);
    if (mismatch) return gate("physical-accepted", "blocked", mismatch, "Run physical acceptance again for the current pinned build and exact Reference Kit.", acceptanceEvidence);
    return gate("physical-accepted", "ready", null, null, acceptanceEvidence);
  }
  if (acceptance.status === "pending") return gate("physical-accepted", "pending", acceptance.reason ?? "Physical acceptance is incomplete.", "Complete the missing physical upload, verification, or serial observation.", acceptanceEvidence);
  return gate("physical-accepted", "blocked", acceptance.reason ?? "Physical acceptance failed.", "Resolve the physical acceptance failure and create a new record.", acceptanceEvidence);
}

function simulationGate(truth: DeviceTruthDto | null, generatedAt: string): ReadinessGateDto {
  if (!truth) {
    return gate("simulation-ready", "unavailable", "No simulator evidence is available for this project.", "Provide a simulator result if simulation evidence is required.", []);
  }
  const truthEvidence = [evidence("simulation-truth", truth.adapter, generatedAt, `Observed execution reality: ${truth.executionReality}; verification: ${truth.verification}.`)];
  if (truth.executionReality !== "simulation") {
    return gate("simulation-ready", "unavailable", "The latest device evidence is not from a simulator.", "Run the optional simulation path to produce simulation evidence.", truthEvidence);
  }
  if (truth.verification === "verified") {
    return gate("simulation-ready", "ready", null, null, truthEvidence);
  }
  return gate("simulation-ready", "blocked", "Simulation evidence exists but is not verified.", "Resolve the simulation failure and repeat the simulation.", truthEvidence);
}

function localGate(input: CommercialReadinessInput): ReadinessGateDto {
  const evidenceRefs: ReadinessEvidenceDto[] = [];
  const hardwareReady = input.hardware.referenceKitId === ESP32_S3_REFERENCE_KIT_ID;
  if (input.hardware.versionId) {
    evidenceRefs.push(evidence("hardware-version", input.hardware.versionId, input.hardware.observedAt ?? input.generatedAt, hardwareReady ? `Exact Reference Kit ${ESP32_S3_REFERENCE_KIT_ID}.` : "Reference Kit identity is missing or mismatched."));
  }
  const validation = input.wiring.validation;
  if (validation) {
    evidenceRefs.push(evidence("wiring-validation", validation.id, validation.completedAt ?? validation.startedAt, `Pin Map ${validation.artifactVersionId} validation result: ${validation.result}.`));
  }
  if (input.build) {
    evidenceRefs.push(evidence("build-record", input.build.id, input.build.completedAt ?? input.build.startedAt, `Build ${input.build.status}; output evidence: ${input.build.outputs.length}.`));
  }
  if (!input.build) {
    return gate("local-ready", "pending", "No build record has been saved for the current firmware version.", "Run the pinned local build after accepting the current firmware.", evidenceRefs);
  }
  if (!hardwareReady) {
    return gate("local-ready", "blocked", "The current project does not carry the exact Reference Kit identity.", `Select ${ESP32_S3_REFERENCE_KIT_ID} and regenerate downstream artifacts.`, evidenceRefs);
  }
  if (validation?.result !== "pass") {
    return gate("local-ready", "blocked", validation ? `Pin Map validation is ${validation.result}.` : "The current Pin Map has not passed validation.", "Validate the current Pin Map before relying on the build result.", evidenceRefs);
  }
  const buildReadiness = deriveLocalReady({
    target: input.build.target,
    options: input.build.options,
    buildStatus: input.build.status,
    exitCode: input.build.exitCode,
    outputs: input.build.outputs,
    toolchainEvidence: input.build.toolchainEvidence,
    cliVersion: input.build.toolchainVersion,
    coreVersion: input.build.toolchainCoreVersion,
    wiringValidation: validation?.result ?? null,
  });
  if (buildReadiness.status === "local-ready") {
    return gate("local-ready", "ready", null, null, evidenceRefs);
  }
  return gate("local-ready", "blocked", buildReadiness.reasons.length ? buildReadiness.reasons.join(", ") : "The saved build is not local-ready.", "Resolve the saved build blockers and run the build again.", evidenceRefs);
}

export function deriveCommercialReadiness(input: CommercialReadinessInput): CommercialReadinessReportDto {
  const local = localGate(input);
  const simulation = simulationGate(input.simulation, input.generatedAt);
  const physical = physicalGate(input.physical, input.physicalAcceptance ?? null, input.generatedAt, input.build);
  const paidReady = local.status === "ready" && physical.status === "ready";
  const paid = gate(
    "paid-release-ready",
    paidReady ? "ready" : "blocked",
    paidReady ? null : "Paid release requires both local-ready and physical-accepted evidence.",
    paidReady ? null : local.status !== "ready" ? local.nextAction : physical.nextAction,
    [...local.evidence, ...physical.evidence],
  );
  const gates = [local, simulation, physical, paid];
  const conclusionStatus: CommercialReadinessReportDto["conclusion"]["status"] = paidReady
    ? "ready"
    : local.status === "blocked" || physical.status === "blocked"
      ? "blocked"
      : "pending";
  const nextAction = paidReady ? null : local.status !== "ready" ? local.nextAction : physical.nextAction;
  const text = paidReady
    ? "This project has reproducible local-build and physical-acceptance evidence and can move to paid release."
    : conclusionStatus === "blocked"
      ? "This project is blocked from paid release until the recorded evidence failures are resolved."
      : "This project is not ready for paid release; the next required evidence step is still pending.";
  return { projectId: input.projectId, generatedAt: input.generatedAt, conclusion: { status: conclusionStatus, text, nextAction }, gates };
}
