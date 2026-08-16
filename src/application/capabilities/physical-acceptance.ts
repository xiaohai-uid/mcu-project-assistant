import { randomUUID } from "node:crypto";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import { ESP32_S3_REFERENCE_KIT_ID } from "@/src/domain/services/build-profile";
import { evaluatePhysicalAcceptance } from "@/src/domain/services/physical-acceptance";
import type { PersistencePort } from "@/src/ports/persistence";
import type { DeviceInfoDto, FlashResultDto, PhysicalAcceptanceRecordDto } from "@/src/shared-contracts/types";

export class PhysicalAcceptanceProjectNotFoundError extends Error {
  constructor() { super("Project not found"); this.name = "PhysicalAcceptanceProjectNotFoundError"; }
}

export class PhysicalAcceptanceInputError extends Error {
  constructor(message: string) { super(message); this.name = "PhysicalAcceptanceInputError"; }
}

export interface PhysicalAcceptanceCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  now?: () => Date;
}

type FlashEvidence = FlashResultDto & { observedAt: string };

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseDevice(raw: string | null): DeviceInfoDto | null {
  const parsed = parseObject(raw);
  if (!parsed || typeof parsed.id !== "string" || typeof parsed.model !== "string" || typeof parsed.port !== "string" || !parsed.truth || typeof parsed.truth !== "object") return null;
  const truth = parsed.truth as Record<string, unknown>;
  if (typeof truth.executionReality !== "string" || typeof truth.verification !== "string" || typeof truth.physicalVerified !== "boolean" || typeof truth.adapter !== "string") return null;
  return parsed as unknown as DeviceInfoDto;
}

function parseFlash(raw: string | null): FlashEvidence | null {
  const parsed = parseObject(raw);
  if (!parsed || typeof parsed.observedAt !== "string" || typeof parsed.exitCode !== "number" || typeof parsed.buildId !== "string" || typeof parsed.artifactVersionId !== "string" || typeof parsed.firmwareSha256 !== "string" || !parsed.truth || typeof parsed.truth !== "object") return null;
  return parsed as unknown as FlashEvidence;
}

export async function recordPhysicalAcceptance(
  input: { projectId: string; buildId: string; artifactVersionId: string; serialObservation?: string },
  deps: PhysicalAcceptanceCapabilityDeps,
): Promise<PhysicalAcceptanceRecordDto> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new PhysicalAcceptanceProjectNotFoundError();
  const now = deps.now ?? (() => new Date());
  const serialObservation = typeof input.serialObservation === "string" ? input.serialObservation.trim() : "";
  if (Buffer.byteLength(serialObservation, "utf8") > 64 * 1024) throw new PhysicalAcceptanceInputError("Serial observation is too large");

  const hardware = await deps.persistence.getArtifactByKind(input.projectId, "hardware");
  const hardwareVersion = hardware?.currentVersionId ? await deps.persistence.getVersion(hardware.currentVersionId) : null;
  const hardwareContent = hardwareVersion ? await deps.content.load(hardwareVersion.contentRef).catch(() => "") : "";
  const hardwareObject = parseObject(hardwareContent);
  const referenceKit = hardwareObject?.referenceKit && typeof hardwareObject.referenceKit === "object" ? hardwareObject.referenceKit as Record<string, unknown> : null;
  const referenceKitId = typeof referenceKit?.id === "string" ? referenceKit.id : "";
  const boardModel = typeof referenceKit?.boardModel === "string" ? referenceKit.boardModel : "unknown-board";
  const boardRevision = typeof referenceKit?.boardRevision === "string" ? referenceKit.boardRevision : "unknown-revision";
  const device = parseDevice(await deps.persistence.getPreference("last_device"));
  const flash = parseFlash(await deps.persistence.getPreference(`last_flash:${input.projectId}`));
  const build = await deps.persistence.getBuildRecord(input.buildId);
  const output = build?.outputs.find((item) => item.kind === "bin" && /^[a-f0-9]{64}$/i.test(item.sha256)) ?? null;
  const evaluation = evaluatePhysicalAcceptance({
    expectedReferenceKitId: ESP32_S3_REFERENCE_KIT_ID,
    referenceKitId,
    boardModel,
    boardRevision,
    buildId: input.buildId,
    artifactVersionId: input.artifactVersionId,
    buildFirmwareSha256: build?.artifactVersionId === input.artifactVersionId ? output?.sha256 ?? null : null,
    device,
    flash,
    serialObservation,
  });
  const status = evaluation.status;
  const completedAt = status === "pending" ? null : now().toISOString();
  const record: PhysicalAcceptanceRecordDto = {
    id: randomUUID(),
    projectId: input.projectId,
    buildId: input.buildId,
    artifactVersionId: input.artifactVersionId,
    referenceKitId,
    boardModel,
    boardRevision,
    deviceId: device?.id ?? null,
    usbPort: device?.port ?? null,
    usbVid: device?.vid ?? null,
    usbPid: device?.pid ?? null,
    usbSerialNumber: device?.serialNumber ?? null,
    firmwareSha256: evaluation.firmwareSha256,
    uploadStatus: evaluation.uploadStatus,
    verificationStatus: evaluation.verificationStatus,
    serialStatus: evaluation.serialStatus,
    serialObservation: serialObservation || null,
    status,
    reason: evaluation.reason,
    createdAt: now().toISOString(),
    completedAt,
  };
  if (!deps.persistence.withTransaction || !deps.persistence) throw new PhysicalAcceptanceInputError("Physical acceptance persistence is unavailable");
  await deps.persistence.withTransaction((uow) => {
    if (!uow.createPhysicalAcceptance) throw new PhysicalAcceptanceInputError("Physical acceptance persistence is unavailable");
    uow.createPhysicalAcceptance(record);
  });
  return record;
}

export async function latestPhysicalAcceptance(
  input: { projectId: string },
  deps: Pick<PhysicalAcceptanceCapabilityDeps, "persistence">,
): Promise<PhysicalAcceptanceRecordDto | null> {
  return deps.persistence.latestPhysicalAcceptance?.(input.projectId) ?? null;
}
