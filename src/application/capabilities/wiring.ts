// application/capabilities/wiring.ts — 引脚分配与电气校验（application-contract 2.8/2.9/2.10；ISSUE-006 §3/§6）
// generate_pin_map：constraint-engine（V2 移植）+ pins 知识求值 → 引脚表 + issues[]（IO12 strapping warning）
// validate_wiring：ValidationRecord（kind=electrical_rules；pass/warn/fail；I-7 未运行≠通过）
// 本票不实现 Stale 传播（S5B）。
import { randomUUID } from "node:crypto";
import { ConstraintEngine, componentIdentityDiagnostic, type Diagnostic } from "@/src/domain/services/constraint-engine";
import { createPlatformRegistry } from "@/src/domain/knowledge/platforms";
import { createComponentRegistry, type ComponentDefinition } from "@/src/domain/knowledge/components";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";
import { createArtifactVersion, type Artifact, type ArtifactVersion } from "@/src/domain/models/artifact";
import { assertNotArchived } from "@/src/domain/models/project";
import { computeDownstreamMarks } from "@/src/application/capabilities/revalidate";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { BomItemDto, ValidationRecordDto } from "@/src/shared-contracts/types";

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class NoHardwareSelectedError extends Error {
  constructor() {
    super("No MCU selected yet");
    this.name = "NoHardwareSelectedError";
  }
}

export interface WiringCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

export interface PinMapEntry {
  component: string;
  pinId: string;
  type: string;
  componentId?: string;
}

export interface PinIssue {
  code: string;
  pinId: string;
  severity: "warning" | "error";
  title: string;
  detail: string;
  blocksClaim?: boolean;
  componentId?: string;
  pendingReason?: string;
  source?: {
    owner: string;
    url: string;
    title: string;
    revision?: string;
    accessedAt: string;
    confidence: string;
  };
}

export interface GeneratePinMapResult {
  artifact: Artifact;
  version: ArtifactVersion;
  pinMap: PinMapEntry[];
  issues: PinIssue[];
  claimStatus: "ready" | "pending";
}

const OWNER = "owner";

/** 需求能力 → 组件（外设推导；与 S4 recommend_mcu 同源映射） */
const CAPABILITY_TO_COMPONENT: Array<{ match: RegExp; capability: string }> = [
  { match: /soil|moisture/i, capability: "soil_moisture_sensing" },
  { match: /pump|relay|water/i, capability: "high_power_switching" },
  { match: /display|oled|lcd/i, capability: "graphical_display" },
];

function displayNameOf(comp: ComponentDefinition): string {
  // 冻结 UI 用英文组件名（PinEditor 编辑路径稳定）；catalog display_name 为中文别名
  const english: Record<string, string> = {
    "sensor.soil_moisture": "Capacitive Soil Sensor",
    "actuator.relay": "5V Pump Relay Driver",
    "display.oled_096": "OLED Display",
  };
  return english[comp.id] ?? comp.displayName;
}

function typeOf(iface: string): PinMapEntry["type"] {
  if (iface === "analog") return "Analog";
  if (iface === "i2c") return "I2C";
  return "Digital";
}

function issueTitle(code: string): string {
  if (code === "COMPONENT_IDENTITY_PENDING") return "Component identity pending";
  if (code === "HARDWARE_IDENTITY_PENDING") return "Reference Kit identity pending";
  if (code.startsWith("VOLTAGE_")) return "Voltage constraint";
  if (code.includes("PIN_")) return "Pin constraint";
  if (code === "UART_CONFLICT") return "Bus conflict";
  if (code === "STRAPPING_PIN_USAGE") return "Strapping pin conflict";
  return "Wiring constraint";
}

/**
 * A user BOM item can identify the exact purchase identity for a canonical
 * component family. It does not invent the missing electrical facts in the
 * knowledge catalog: the original family status remains blocking until those
 * facts are source-verified.
 */
function applySelectedBomIdentity(comp: ComponentDefinition, selection: BomItemDto): ComponentDefinition {
  const selectedIdentity = [selection.manufacturer, selection.manufacturerPartNumber, selection.supplierSku]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const catalogReason = comp.identity.pendingReason ?? "the component catalog has not source-verified its electrical facts";
  return {
    ...comp,
    identity: {
      ...comp.identity,
      ...(selection.manufacturer ? { manufacturer: selection.manufacturer } : {}),
      ...(selection.manufacturerPartNumber ? { partNumber: selection.manufacturerPartNumber } : {}),
      ...(selection.supplierSku ? { supplierSku: selection.supplierSku } : {}),
      pendingReason: `Exact BOM identity selected${selectedIdentity ? ` (${selectedIdentity})` : ""}; ${catalogReason}`,
    },
  };
}

function issuesFromDiagnostics(diags: Diagnostic[]): PinIssue[] {
  return diags
    .map((d) => ({
      code: d.code,
      pinId: String(d.details.pin ?? (Array.isArray(d.details.pins) ? d.details.pins.join("/") : "—")),
      severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
      title: issueTitle(d.code),
      detail: d.message,
      blocksClaim: d.blocking === true,
      ...(typeof d.details.component_id === "string" ? { componentId: d.details.component_id } : {}),
      ...(typeof d.details.pending_reason === "string" ? { pendingReason: d.details.pending_reason } : {}),
      ...(d.source ? { source: d.source } : {}),
    }));
}

function hardwareIdentityDiagnostic(
  platform: ReturnType<ReturnType<typeof createPlatformRegistry>["get"]>,
  hardwareIdentity: unknown,
): Diagnostic | null {
  const expected = platform.referenceKit;
  if (!expected) {
    return {
      code: "HARDWARE_IDENTITY_PENDING",
      severity: "warning",
      blocking: true,
      message: `${platform.displayName} has no exact Reference Kit identity attached; wiring claim is pending.`,
      details: { platform_id: platform.id, reason: "No exact Reference Kit is registered for this platform." },
    };
  }
  const actual = hardwareIdentity as { id?: unknown; boardModel?: unknown; boardRevision?: unknown } | undefined;
  if (actual?.id === expected.id && actual.boardModel === expected.boardModel && actual.boardRevision === expected.boardRevision) {
    return null;
  }
  return {
    code: "HARDWARE_IDENTITY_PENDING",
    severity: "warning",
    blocking: true,
    message: `Wiring requires exact Reference Kit ${expected.boardModel} ${expected.boardRevision}; the hardware snapshot is missing or mismatched.`,
    details: {
      platform_id: platform.id,
      expected_reference_kit_id: expected.id,
      actual_reference_kit_id: actual?.id,
      reason: "The wiring input must carry the exact board snapshot selected in Hardware.",
    },
    source: expected.source,
  };
}

/** 从硬件当前版本解析外设组件（requirements 能力 → components 目录） */
async function resolveComponents(
  projectId: string,
  deps: Pick<WiringCapabilityDeps, "persistence" | "content">,
): Promise<Array<[string, ComponentDefinition]>> {
  const components = createComponentRegistry();
  const bomItems = deps.persistence.listBomItems ? await deps.persistence.listBomItems(projectId) : [];
  const reqArtifact = await deps.persistence.getArtifactByKind(projectId, "requirements");
  let capabilities: Array<{ id: string; title: string }> = [];
  if (reqArtifact?.currentVersionId) {
    const version = await deps.persistence.getVersion(reqArtifact.currentVersionId);
    if (version) {
      const content = await deps.content.load(version.contentRef).catch(() => "");
      try {
        capabilities = (JSON.parse(content) as { capabilities?: Array<{ id: string; title: string }> }).capabilities ?? [];
      } catch {
        capabilities = [];
      }
    }
  }
  const result: Array<[string, ComponentDefinition]> = [];
  for (const cap of capabilities) {
    for (const rule of CAPABILITY_TO_COMPONENT) {
      if (rule.match.test(cap.title)) {
        for (const comp of components.findByCapability(rule.capability)) {
          if (!result.some(([, c]) => c.id === comp.id)) {
            const selection = bomItems.find(
              (item) => item.sourceKind === "user-input" && item.identityStatus === "exact" && item.componentId === comp.id,
            );
            result.push([`${comp.id.replace(".", "_")}_1`, selection ? applySelectedBomIdentity(comp, selection) : comp]);
          }
        }
        break;
      }
    }
  }
  return result;
}

/**
 * 纯计算（不落库）：硬件当前版本 + 需求能力 → 引脚表 + issues + 内容。
 * generate_pin_map 与 revalidate 共用（决策同源——revalidate 重算不得产生版本副作用）。
 */
export async function computePinMapContent(
  projectId: string,
  deps: Pick<WiringCapabilityDeps, "persistence" | "content">,
): Promise<{ pinMap: PinMapEntry[]; issues: PinIssue[]; claimStatus: "ready" | "pending"; content: string } | null> {
  // MCU（hardware current version）
  const hwArtifact = await deps.persistence.getArtifactByKind(projectId, "hardware");
  if (!hwArtifact?.currentVersionId) return null;
  const hwVersion = await deps.persistence.getVersion(hwArtifact.currentVersionId);
  if (!hwVersion) return null;
  const hwContent = await deps.content.load(hwVersion.contentRef).catch(() => "");
  let mcuId = "";
  let hardwareIdentity: unknown;
  try {
    const parsed = JSON.parse(hwContent) as { selectedMcuId?: string; referenceKit?: unknown };
    mcuId = parsed.selectedMcuId ?? "";
    hardwareIdentity = parsed.referenceKit;
  } catch {
    mcuId = "";
  }
  const platform = createPlatformRegistry().getOrNone(mcuId);
  if (!platform) return null;

  const components = await resolveComponents(projectId, deps);
  const engine = new ConstraintEngine(platform, components);
  const result = engine.validate();
  const allDiagnostics = [...result.diagnostics];
  const boardDiagnostic = hardwareIdentityDiagnostic(platform, hardwareIdentity);
  if (boardDiagnostic) allDiagnostics.push(boardDiagnostic);
  const allocation = result.pinAllocation;

  const pinMap: PinMapEntry[] = [];
  for (const a of allocation?.assignments ?? []) {
    const comp = components.find(([id]) => id === a.instanceId)?.[1];
    pinMap.push({
      component: comp ? displayNameOf(comp) : a.instanceId,
      pinId: a.physicalPin,
      type: typeOf(a.interface),
      ...(comp ? { componentId: comp.id } : {}),
    });
  }
  // I2C/SPI 共享总线参与者展开为引脚行（冻结 UI：OLED (SDA)→IO8、OLED (SCL)→IO9）
  for (const bus of allocation?.sharedBuses ?? []) {
    for (const participant of bus.participants) {
      const comp = components.find(([id]) => id === participant)?.[1];
      const base = comp ? displayNameOf(comp) : participant;
      for (const [role, pin] of Object.entries(bus.pins)) {
        pinMap.push({
          component: `${base} (${role.toUpperCase()})`,
          pinId: pin,
          type: typeOf(bus.type),
          ...(comp ? { componentId: comp.id } : {}),
        });
      }
    }
  }
  const issues = issuesFromDiagnostics(allDiagnostics);
  const claimStatus = allDiagnostics.some((diagnostic) => diagnostic.blocking) ? "pending" : "ready";
  return {
    pinMap,
    issues,
    claimStatus,
    content: JSON.stringify({ platformId: platform.id, hardwareIdentity: hardwareIdentity ?? null, claimStatus, pinMap, issues }),
  };
}

export async function generatePinMap(
  input: { projectId: string },
  deps: WiringCapabilityDeps,
): Promise<GeneratePinMapResult> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();
  assertNotArchived(project);

  const computed = await computePinMapContent(input.projectId, deps);
  if (!computed) throw new NoHardwareSelectedError();
  const { pinMap, issues, claimStatus, content } = computed;

  // Pin Map artifact v1（有冲突=warning；内容=分配+诊断）
  const artifact = await deps.persistence.getArtifactByKind(input.projectId, "pinmap");
  const versionNo = artifact ? (await deps.persistence.listVersions(artifact.id)).length + 1 : 1;
  const { contentRef, contentHash } = await deps.content.store(
    { projectId: input.projectId, kind: "pinmap", versionNo },
    content,
  );
  const version = createArtifactVersion({
    artifactId: artifact?.id ?? "pending",
    versionNo,
    contentRef,
    contentHash,
    status: issues.some((i) => i.severity === "error") || claimStatus === "pending" ? "draft" : "accepted",
    sourceKind: "proposal",
    sourceProposalId: null,
    createdBy: OWNER,
    now,
  });

  let committedArtifact: Artifact | null = artifact;
  // S5B：依赖求值（只读计算，随版本提交同事务写 marks——T1/T2 同事务；I-4 不删除下游）
  // fromContent = 当前 pinmap 内容（重生成分类正确：分配变化 → hard-constraint-break → L3）
  const prevContent =
    artifact?.currentVersionId && versionNo > 1
      ? await deps.persistence.getVersion(artifact.currentVersionId).then((v) =>
          v ? deps.content.load(v.contentRef).catch(() => "") : "",
        )
      : "";
  const downstreamMarks =
    versionNo > 1
      ? await computeDownstreamMarks(
          {
            projectId: input.projectId,
            kind: "pinmap",
            fromContent: prevContent,
            toContent: content,
            sourceVersionId: version.id,
            triggeredBy: "generate_pin_map",
            now,
          },
          deps,
        )
      : [];
  await deps.persistence.withTransaction((uow) => {
    if (!committedArtifact) {
      committedArtifact = domainCreateArtifact({ projectId: input.projectId, kind: "pinmap", now });
      uow.createArtifact(committedArtifact);
    }
    uow.createVersion({ ...version, artifactId: committedArtifact.id });
    uow.setCurrentVersion(committedArtifact.id, version.id);
    if (downstreamMarks.length) uow.saveStaleMarks(downstreamMarks);
  });
  if (!committedArtifact) throw new Error("generatePinMap: artifact not materialized");
  const fresh = await deps.persistence.getArtifactByKind(input.projectId, "pinmap");
  committedArtifact = fresh ?? committedArtifact;

  deps.events.publish({
    type: "artifact.version.created",
    projectId: input.projectId,
    artifactId: committedArtifact.id,
    versionId: version.id,
    kind: "pinmap",
    versionNo: version.versionNo,
    createdAt: version.createdAt,
  });

  return { artifact: committedArtifact, version, pinMap, issues, claimStatus };
}

/** validate_wiring：对指定版本跑电气规则 → ValidationRecord（未运行≠通过，I-7） */
export async function validateWiring(
  input: { versionId: string },
  deps: WiringCapabilityDeps,
): Promise<ValidationRecordDto> {
  const now = deps.now ?? (() => new Date());
  const version = await deps.persistence.getVersion(input.versionId);
  if (!version) throw new ProjectNotFoundError();

  // I-8 / 门禁矩阵：L3 stale 下禁止标记 Validation 成功（mark_validated）
  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  if (artifact) {
    await assertNotBlocking(
      { projectId: artifact.projectId, action: "mark_validated", artifactId: artifact.id },
      deps,
    );
  }

  const content = await deps.content.load(version.contentRef).catch(() => "");
  let pinMap: PinMapEntry[] = [];
  let hardwareIdentity: unknown;
  let platformId = "";
  try {
    const parsed = JSON.parse(content) as { pinMap?: PinMapEntry[]; hardwareIdentity?: unknown; platformId?: string };
    pinMap = parsed.pinMap ?? [];
    hardwareIdentity = parsed.hardwareIdentity;
    platformId = parsed.platformId ?? "";
  } catch {
    pinMap = [];
  }

  // 电气规则：身份、Reference Kit、strapping 引脚占用 + 重复引脚
  const rules = ["component_identity", "reference_kit_identity", "strapping_pin_usage", "duplicate_pin"];
  const diagnostics: ValidationRecordDto["diagnostics"] = [];

  const platform = platformId ? createPlatformRegistry().getOrNone(platformId) : null;
  if (platform) {
    const boardDiagnostic = hardwareIdentityDiagnostic(platform, hardwareIdentity);
    if (boardDiagnostic) diagnostics.push(boardDiagnostic);
  } else {
    diagnostics.push({
      code: "HARDWARE_IDENTITY_PENDING",
      severity: "warning",
      message: "Pin map does not carry an exact platform and Reference Kit snapshot.",
      details: { reason: "The wiring input must reference the selected hardware artifact." },
    });
  }

  if (artifact) {
    const components = await resolveComponents(artifact.projectId, deps);
    const seenComponents = new Set<string>();
    for (const [instanceId, comp] of components) {
      const componentPins = pinMap
        .filter((entry) => entry.componentId === comp.id || entry.component === displayNameOf(comp) || entry.component.startsWith(`${displayNameOf(comp)} (`))
        .map((entry) => entry.pinId);
      if (componentPins.length === 0 || seenComponents.has(comp.id)) continue;
      seenComponents.add(comp.id);
      const diagnostic = componentIdentityDiagnostic(instanceId, comp, [...new Set(componentPins)]);
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }

  const seen = new Set<string>();
  for (const entry of pinMap) {
    if (seen.has(entry.pinId)) {
      diagnostics.push({
        code: "DUPLICATE_PIN",
        severity: "warning",
        message: `Pin ${entry.pinId} assigned to multiple components`,
      });
    }
    seen.add(entry.pinId);
  }
  // strapping 检查：ESP32-S3 系已知 strapping 引脚
  const STRAPPING: Record<string, string> = {
    IO12: "IO12 is an ESP32-S3 strapping pin: pulling it high at reset forces 1.8V flash LDO configuration and can cause boot loops.",
    IO0: "IO0 is an ESP32-S3 strapping pin controlling boot mode.",
    IO45: "IO45 is an ESP32-S3 strapping pin controlling chip boot.",
    IO46: "IO46 is an ESP32-S3 strapping pin controlling download boot.",
  };
  for (const entry of pinMap) {
    const reason = STRAPPING[entry.pinId];
    if (reason) {
      diagnostics.push({
        code: "STRAPPING_PIN_USAGE",
        severity: "warning",
        message: reason,
        details: { pin: entry.pinId, reason },
        ...(platform?.referenceKit?.source ? { source: platform.referenceKit.source } : {}),
      });
    }
  }

  const result: ValidationRecordDto["result"] = diagnostics.some((d) => d.severity === "error")
    ? "fail"
    : diagnostics.length > 0
      ? "warn"
      : "pass";

  const record: ValidationRecordDto = {
    id: randomUUID(),
    artifactVersionId: version.id,
    kind: "electrical_rules",
    rules,
    result,
    diagnostics,
    startedAt: now().toISOString(),
    completedAt: now().toISOString(),
  };
  await deps.persistence.withTransaction((uow) => uow.createValidationRecord(record));
  return record;
}

export async function latestValidation(
  input: { versionId: string },
  deps: Pick<WiringCapabilityDeps, "persistence">,
): Promise<ValidationRecordDto | null> {
  return deps.persistence.latestValidation(input.versionId);
}
