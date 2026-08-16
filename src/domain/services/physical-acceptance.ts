import type { DeviceInfoDto, DeviceTruthDto, PhysicalAcceptanceRecordDto } from "@/src/shared-contracts/types";

export interface PhysicalAcceptanceEvaluationInput {
  expectedReferenceKitId: string;
  referenceKitId: string;
  boardModel: string;
  boardRevision: string;
  buildId: string;
  artifactVersionId: string;
  buildFirmwareSha256: string | null;
  device: DeviceInfoDto | null;
  flash: {
    exitCode: number;
    sessionId?: string;
    observedAt?: string;
    buildId?: string;
    artifactVersionId?: string;
    firmwareSha256?: string;
    truth: DeviceTruthDto;
    errorCode?: string;
  } | null;
  serialObservation: string;
}

export interface PhysicalAcceptanceEvaluation {
  firmwareSha256: string | null;
  uploadStatus: PhysicalAcceptanceRecordDto["uploadStatus"];
  verificationStatus: PhysicalAcceptanceRecordDto["verificationStatus"];
  serialStatus: PhysicalAcceptanceRecordDto["serialStatus"];
  status: PhysicalAcceptanceRecordDto["status"];
  reason: string | null;
}

export function evaluatePhysicalAcceptance(input: PhysicalAcceptanceEvaluationInput): PhysicalAcceptanceEvaluation {
  const reasons: string[] = [];
  if (input.referenceKitId !== input.expectedReferenceKitId) reasons.push(`Exact Reference Kit ${input.expectedReferenceKitId} is required.`);
  if (!input.buildFirmwareSha256) reasons.push("No verified firmware binary hash is available for this build.");

  const physicalTruth = Boolean(input.flash
    && input.flash.exitCode === 0
    && input.flash.buildId === input.buildId
    && input.flash.artifactVersionId === input.artifactVersionId
    && input.flash.truth.executionReality === "physical"
    && input.flash.truth.verification === "verified"
    && input.flash.truth.physicalVerified);
  const hashMatches = Boolean(input.flash?.firmwareSha256 && input.buildFirmwareSha256 && input.flash.firmwareSha256 === input.buildFirmwareSha256);
  const uploadStatus: PhysicalAcceptanceRecordDto["uploadStatus"] = !input.flash ? "pending" : physicalTruth && hashMatches ? "verified" : "failed";
  const verificationStatus: PhysicalAcceptanceRecordDto["verificationStatus"] = uploadStatus === "verified" ? "verified" : uploadStatus === "pending" ? "pending" : "failed";
  if (!input.flash) reasons.push("No completed physical upload evidence is available.");
  else if (uploadStatus !== "verified") reasons.push(input.flash.errorCode ? `Physical upload failed: ${input.flash.errorCode}.` : "Physical upload, truth, or firmware hash verification failed.");

  const serialStatus: PhysicalAcceptanceRecordDto["serialStatus"] = !input.serialObservation
    ? "pending"
    : /MCU_READY|BOOT|READY|STATUS|HELLO/i.test(input.serialObservation)
      ? "observed"
      : "failed";
  if (!input.serialObservation) reasons.push("Serial startup observation is missing.");
  else if (serialStatus === "failed") reasons.push("Serial observation does not contain an expected startup/status marker.");

  const identityReady = input.referenceKitId === input.expectedReferenceKitId
    && Boolean(input.device?.id && input.device.port && input.device.truth.executionReality === "physical" && input.device.truth.physicalVerified);
  if (!identityReady) reasons.push("The latest detected USB device is not a verified physical device for this project.");
  const status: PhysicalAcceptanceRecordDto["status"] = reasons.length === 0 && uploadStatus === "verified" && verificationStatus === "verified" && serialStatus === "observed"
    ? "accepted"
    : uploadStatus === "pending" || serialStatus === "pending"
      ? "pending"
      : "failed";
  return {
    firmwareSha256: input.flash?.firmwareSha256 ?? input.buildFirmwareSha256,
    uploadStatus,
    verificationStatus,
    serialStatus,
    status,
    reason: reasons.length ? reasons.join(" ") : null,
  };
}
