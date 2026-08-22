import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { PersistencePort } from "@/src/ports/persistence";
import { getProjectBom } from "@/src/application/capabilities/bom";
import { deriveDeliveryReport } from "@/src/domain/services/delivery-report";
import type { AcceptancePolicyReportDto, DeliveryBoardIdentityDto, DeliveryReportDto, DeviceInfoDto } from "@/src/shared-contracts/types";
import { deriveAcceptancePolicy } from "@/src/domain/services/acceptance-policy";

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

function boardIdentity(content: string | null): DeliveryBoardIdentityDto | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as { referenceKit?: Record<string, unknown> };
    const kit = parsed.referenceKit;
    const source = kit?.source;
    if (!kit || typeof kit.id !== "string" || typeof kit.boardModel !== "string" || typeof kit.boardRevision !== "string" || typeof kit.moduleModel !== "string") return null;
    return {
      referenceKitId: kit.id,
      boardModel: kit.boardModel,
      boardRevision: kit.boardRevision,
      moduleModel: kit.moduleModel,
      manufacturer: typeof source === "object" && source !== null && typeof (source as { owner?: unknown }).owner === "string" ? (source as { owner: string }).owner : null,
      source: typeof source === "object" && source !== null && typeof (source as { owner?: unknown }).owner === "string" && typeof (source as { url?: unknown }).url === "string" && typeof (source as { title?: unknown }).title === "string" && typeof (source as { accessedAt?: unknown }).accessedAt === "string" && typeof (source as { confidence?: unknown }).confidence === "string"
        ? {
            owner: (source as { owner: string }).owner,
            url: (source as { url: string }).url,
            title: (source as { title: string }).title,
            ...((source as { revision?: unknown }).revision ? { revision: String((source as { revision: unknown }).revision) } : {}),
            accessedAt: (source as { accessedAt: string }).accessedAt,
            confidence: (source as { confidence: string }).confidence,
          }
        : null,
    };
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

export async function getAcceptancePolicyReport(
  input: { projectId: string },
  deps: ReadinessCapabilityDeps,
): Promise<AcceptancePolicyReportDto> {
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

  return deriveAcceptancePolicy({
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

export async function getDeliveryReport(
  input: { projectId: string },
  deps: ReadinessCapabilityDeps,
): Promise<DeliveryReportDto> {
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
  const bom = await getProjectBom({ projectId: input.projectId }, deps);

  return deriveDeliveryReport({
    projectId: input.projectId,
    projectName: project.name,
    generatedAt,
    hardware: { versionId: hardware.versionId, observedAt: hardware.createdAt, identity: boardIdentity(hardware.content) },
    wiring: { versionId: pinmap.versionId, validation },
    build: latestBuild,
    simulation: lastDevice?.executionReality === "simulation" ? lastDevice : null,
    physical: lastDevice?.executionReality === "physical" || lastDevice?.executionReality === "companion" ? lastDevice : null,
    physicalAcceptance,
    bom,
  });
}
