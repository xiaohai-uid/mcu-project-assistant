import { randomUUID } from "node:crypto";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import { createComponentRegistry } from "@/src/domain/knowledge/components";
import { exportBom, type BomExportFormat } from "@/src/domain/services/bom";
import type { PersistencePort } from "@/src/ports/persistence";
import type { BomItemDto, BomItemWithObservationsDto, PriceObservationDto, ProjectBomDto } from "@/src/shared-contracts/types";

export class BomProjectNotFoundError extends Error {
  constructor() { super("Project not found"); this.name = "BomProjectNotFoundError"; }
}

export class BomInputError extends Error {
  constructor(message: string) { super(message); this.name = "BomInputError"; }
}

export interface BomCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  now?: () => Date;
}

async function currentContent(projectId: string, kind: "requirements" | "hardware", deps: BomCapabilityDeps): Promise<string | null> {
  const artifact = await deps.persistence.getArtifactByKind(projectId, kind);
  if (!artifact?.currentVersionId) return null;
  const version = await deps.persistence.getVersion(artifact.currentVersionId);
  return version ? deps.content.load(version.contentRef).catch(() => null) : null;
}

function suggestedComponents(requirements: string | null): string[] {
  const parsed = (() => {
    try { return requirements ? JSON.parse(requirements) as { capabilities?: Array<{ id?: unknown; title?: unknown }> } : {}; } catch { return {}; }
  })();
  const values = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
  const ids: string[] = [];
  for (const item of values) {
    const title = typeof item.title === "string" ? item.title.toLowerCase() : "";
    const id = /soil|moisture|湿度/.test(title)
      ? "sensor.soil_moisture"
      : /pump|relay|水泵|继电/.test(title)
        ? "actuator.relay"
        : /oled|display|屏/.test(title)
          ? "display.oled_096"
          : typeof item.id === "string" ? `requirement:${item.id}` : "requirement:unresolved";
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function itemFromComponent(projectId: string, componentId: string, createdAt: string): BomItemDto {
  const registry = createComponentRegistry();
  const component = registry.getOrNone(componentId);
  if (!component) {
    return { id: `system:${projectId}:${componentId}`, projectId, componentId, displayName: componentId, sourceKind: "system-suggestion", identityStatus: "unresolved", manufacturer: null, manufacturerPartNumber: null, supplierSku: null, quantity: 1, unresolvedReason: "System could not resolve this requirement to an exact component identity.", createdAt };
  }
  return {
    id: `system:${projectId}:${component.id}`,
    projectId,
    componentId: component.id,
    displayName: component.displayName,
    sourceKind: "system-suggestion",
    identityStatus: component.identity.status === "exact" ? "exact" : "unresolved",
    manufacturer: component.identity.manufacturer ?? null,
    manufacturerPartNumber: component.identity.partNumber ?? null,
    supplierSku: component.identity.supplierSku ?? null,
    quantity: 1,
    unresolvedReason: component.identity.status === "exact" ? null : component.identity.pendingReason ?? "Exact identity is not confirmed.",
    createdAt,
  };
}

function itemFromReferenceKit(projectId: string, referenceKit: { id: string; boardModel: string; boardRevision: string; manufacturer?: string }, createdAt: string): BomItemDto {
  return {
    id: `system:${projectId}:board:${referenceKit.id}`,
    projectId,
    componentId: `board:${referenceKit.id}`,
    displayName: `${referenceKit.boardModel} ${referenceKit.boardRevision}`,
    sourceKind: "system-suggestion",
    identityStatus: "exact",
    manufacturer: referenceKit.manufacturer ?? "Espressif",
    manufacturerPartNumber: referenceKit.boardModel,
    supplierSku: null,
    quantity: 1,
    unresolvedReason: null,
    createdAt,
  };
}

function visibleItems(items: BomItemDto[]): BomItemDto[] {
  const exactUserSelections = new Set(
    items
      .filter((item) => item.sourceKind === "user-input" && item.identityStatus === "exact")
      .map((item) => item.componentId),
  );
  return items.filter(
    (item) => !(item.sourceKind === "system-suggestion" && item.identityStatus === "unresolved" && exactUserSelections.has(item.componentId)),
  );
}

async function ensureSuggestions(projectId: string, generatedAt: string, deps: BomCapabilityDeps): Promise<void> {
  if (!deps.persistence.withTransaction || !deps.persistence.listBomItems || !deps.persistence.withTransaction) return;
  const requirements = await currentContent(projectId, "requirements", deps);
  const hardware = await currentContent(projectId, "hardware", deps);
  const suggestions = suggestedComponents(requirements);
  let boardSuggestion: BomItemDto | null = null;
  if (hardware) {
    try {
      const parsed = JSON.parse(hardware) as { referenceKit?: { id?: unknown; boardModel?: unknown; boardRevision?: unknown; source?: { owner?: unknown } } };
      if (typeof parsed.referenceKit?.id === "string" && typeof parsed.referenceKit.boardModel === "string" && typeof parsed.referenceKit.boardRevision === "string") {
        boardSuggestion = itemFromReferenceKit(projectId, { id: parsed.referenceKit.id, boardModel: parsed.referenceKit.boardModel, boardRevision: parsed.referenceKit.boardRevision, manufacturer: typeof parsed.referenceKit.source?.owner === "string" ? parsed.referenceKit.source.owner : undefined }, generatedAt);
      }
    } catch { /* unresolved hardware stays out of the procurement table */ }
  }
  const existing = await deps.persistence.listBomItems(projectId);
  const newItems = [...(boardSuggestion ? [boardSuggestion] : []), ...suggestions.map((id) => itemFromComponent(projectId, id, generatedAt))]
    .filter((item): item is BomItemDto => item !== null && !existing.some((current) => current.id === item.id));
  await deps.persistence.withTransaction((uow) => {
    for (const item of newItems) uow.createBomItem?.(item);
  });
}

export async function getProjectBom(input: { projectId: string }, deps: BomCapabilityDeps): Promise<ProjectBomDto> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new BomProjectNotFoundError();
  const now = deps.now ?? (() => new Date());
  await ensureSuggestions(input.projectId, now().toISOString(), deps);
  const items = visibleItems(deps.persistence.listBomItems ? await deps.persistence.listBomItems(input.projectId) : []);
  const withObservations: BomItemWithObservationsDto[] = await Promise.all(items.map(async (item) => ({
    ...item,
    priceObservations: deps.persistence.listPriceObservations ? await deps.persistence.listPriceObservations(item.id) : [],
  })));
  return { projectId: input.projectId, generatedAt: now().toISOString(), items: withObservations };
}

export async function createBomItem(input: Omit<BomItemDto, "id" | "createdAt" | "projectId" | "sourceKind"> & { projectId: string; sourceKind?: "user-input" }, deps: BomCapabilityDeps): Promise<BomItemDto> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new BomProjectNotFoundError();
  if (!input.componentId || !input.displayName || !Number.isInteger(input.quantity) || input.quantity < 1) throw new BomInputError("componentId, displayName, and a positive quantity are required");
  if (input.identityStatus === "exact" && (!input.manufacturer || !input.manufacturerPartNumber || !input.supplierSku)) throw new BomInputError("Exact BOM identity requires manufacturer, manufacturer part number, and supplier SKU");
  const item: BomItemDto = { ...input, id: randomUUID(), projectId: input.projectId, sourceKind: "user-input", createdAt: (deps.now ?? (() => new Date()))().toISOString() };
  await deps.persistence.withTransaction((uow) => {
    if (!uow.createBomItem) throw new BomInputError("BOM persistence is unavailable");
    uow.createBomItem(item);
  });
  return item;
}

export async function addPriceObservation(input: Omit<PriceObservationDto, "id" | "observedAt" | "bomItemId" | "supplier" | "currency"> & { projectId: string; bomItemId: string; supplierSku: string; observedAt?: string }, deps: BomCapabilityDeps): Promise<PriceObservationDto> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new BomProjectNotFoundError();
  if (!/^(1|10|100)$/.test(String(input.quantityTier))) throw new BomInputError("quantityTier must be 1, 10, or 100");
  if (!input.supplierSku || !/^https?:\/\//i.test(input.sourceUrl)) throw new BomInputError("supplierSku and an http(s) sourceUrl are required");
  const items = deps.persistence.listBomItems ? await deps.persistence.listBomItems(input.projectId) : [];
  const item = items.find((candidate) => candidate.id === input.bomItemId);
  if (!item) throw new BomInputError("BOM item does not belong to this project");
  if (item.identityStatus !== "exact" || !item.supplierSku || item.supplierSku !== input.supplierSku) throw new BomInputError("Price observations require an exact BOM identity and matching supplier SKU");
  const observation: PriceObservationDto = {
    id: randomUUID(), bomItemId: input.bomItemId, supplier: "LCSC", currency: "CNY", supplierSku: input.supplierSku,
    manufacturerPartNumber: input.manufacturerPartNumber ?? null, quantityTier: input.quantityTier, unitPrice: input.unitPrice ?? null,
    lineTotal: input.lineTotal ?? null, shipping: input.shipping ?? null, tax: input.tax ?? null, fees: input.fees ?? null,
    stockStatus: input.stockStatus, sourceUrl: input.sourceUrl, observedAt: input.observedAt ?? (deps.now ?? (() => new Date()))().toISOString(),
  };
  await deps.persistence.withTransaction((uow) => {
    if (!uow.createPriceObservation) throw new BomInputError("Price observation persistence is unavailable");
    uow.createPriceObservation(observation);
  });
  return observation;
}

export async function exportProjectBom(input: { projectId: string; format: BomExportFormat }, deps: BomCapabilityDeps): Promise<{ format: BomExportFormat; content: string }> {
  if (input.format !== "csv" && input.format !== "markdown") throw new BomInputError("format must be csv or markdown");
  const bom = await getProjectBom({ projectId: input.projectId }, deps);
  return { format: input.format, content: exportBom(bom.items, bom.items.flatMap((item) => item.priceObservations), input.format) };
}
