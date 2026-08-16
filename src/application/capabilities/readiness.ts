import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { PersistencePort } from "@/src/ports/persistence";
import type { CommercialReadinessReportDto, DeviceInfoDto } from "@/src/shared-contracts/types";
import { deriveCommercialReadiness } from "@/src/domain/services/commercial-readiness";

export class ReadinessProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ReadinessProjectNotFoundError";
  }
}

export interface ReadinessCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  now?: () => Date;
}

async function currentArtifactContent(
  projectId: string,
  kind: "hardware" | "pinmap" | "firmware",
  deps: ReadinessCapabilityDeps,
): Promise<{ versionId: string | null; createdAt: string | null; content: string | null }> {
  const artifact = await deps.persistence.getArtifactByKind(projectId, kind);
  if (!artifact?.currentVersionId) return { versionId: null, createdAt: null, content: null };
  const version = await deps.persistence.getVersion(artifact.currentVersionId);
  if (!version) return { versionId: null, createdAt: null, content: null };
  return { versionId: version.id, createdAt: version.createdAt, content: await deps.content.load(version.contentRef).catch(() => null) };
}

function referenceKitId(content: string | null): string | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { referenceKit?: { id?: unknown } };
    return typeof parsed.referenceKit?.id === "string" ? parsed.referenceKit.id : null;
  } catch {
    return null;
  }
}

function deviceTruth(raw: string | null): DeviceInfoDto["truth"] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceInfoDto>;
    return parsed.truth && typeof parsed.truth === "object" && typeof parsed.truth.executionReality === "string"
      && typeof parsed.truth.verification === "string" && typeof parsed.truth.physicalVerified === "boolean" && typeof parsed.truth.adapter === "string"
      ? parsed.truth
      : null;
  } catch {
    return null;
  }
}

export async function getCommercialReadinessReport(
  input: { projectId: string },
  deps: ReadinessCapabilityDeps,
): Promise<CommercialReadinessReportDto> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ReadinessProjectNotFoundError();
  const now = deps.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const hardware = await currentArtifactContent(input.projectId, "hardware", deps);
  const pinmap = await currentArtifactContent(input.projectId, "pinmap", deps);
  const firmware = await currentArtifactContent(input.projectId, "firmware", deps);
  const validation = pinmap.versionId ? await deps.persistence.latestValidation(pinmap.versionId) : null;
  const builds = firmware.versionId ? await deps.persistence.listBuilds(firmware.versionId) : [];
  const latestBuild = [...builds].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).at(-1) ?? null;
  const lastDevice = deviceTruth(await deps.persistence.getPreference("last_device"));
  const physicalAcceptance = await deps.persistence.latestPhysicalAcceptance?.(input.projectId) ?? null;

  return deriveCommercialReadiness({
    projectId: input.projectId,
    generatedAt,
    hardware: { referenceKitId: referenceKitId(hardware.content), versionId: hardware.versionId, observedAt: hardware.createdAt },
    wiring: { versionId: pinmap.versionId, validation },
    build: latestBuild,
    simulation: lastDevice?.executionReality === "simulation" ? lastDevice : null,
    physical: lastDevice?.executionReality === "physical" || lastDevice?.executionReality === "companion" ? lastDevice : null,
    physicalAcceptance,
  });
}
