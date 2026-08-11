// application/capabilities/wiring.ts — 引脚分配与电气校验（application-contract 2.8/2.9/2.10；ISSUE-006 §3/§6）
// generate_pin_map：constraint-engine（V2 移植）+ pins 知识求值 → 引脚表 + issues[]（IO12 strapping warning）
// validate_wiring：ValidationRecord（kind=electrical_rules；pass/warn/fail；I-7 未运行≠通过）
// 本票不实现 Stale 传播（S5B）。
import { randomUUID } from "node:crypto";
import { ConstraintEngine, type Diagnostic } from "@/src/domain/services/constraint-engine";
import { createPlatformRegistry } from "@/src/domain/knowledge/platforms";
import { createComponentRegistry, type ComponentDefinition } from "@/src/domain/knowledge/components";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";
import { createArtifactVersion, type Artifact, type ArtifactVersion } from "@/src/domain/models/artifact";
import { assertNotArchived } from "@/src/domain/models/project";
import { computeDownstreamMarks } from "@/src/application/capabilities/revalidate";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { ValidationRecordDto } from "@/src/shared-contracts/types";

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
}

export interface PinIssue {
  pinId: string;
  severity: "warning" | "error";
  title: string;
  detail: string;
}

export interface GeneratePinMapResult {
  artifact: Artifact;
  version: ArtifactVersion;
  pinMap: PinMapEntry[];
  issues: PinIssue[];
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

function issuesFromDiagnostics(diags: Diagnostic[]): PinIssue[] {
  return diags
    .filter((d) => d.code === "STRAPPING_PIN_USAGE")
    .map((d) => ({
      pinId: String(d.details.pin ?? ""),
      severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
      title: "Strapping pin conflict",
      detail: d.message,
    }));
}

/** 从硬件当前版本解析外设组件（requirements 能力 → components 目录） */
async function resolveComponents(
  projectId: string,
  deps: Pick<WiringCapabilityDeps, "persistence" | "content">,
): Promise<Array<[string, ComponentDefinition]>> {
  const components = createComponentRegistry();
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
            result.push([`${comp.id.replace(".", "_")}_1`, comp]);
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
): Promise<{ pinMap: PinMapEntry[]; issues: PinIssue[]; content: string } | null> {
  // MCU（hardware current version）
  const hwArtifact = await deps.persistence.getArtifactByKind(projectId, "hardware");
  if (!hwArtifact?.currentVersionId) return null;
  const hwVersion = await deps.persistence.getVersion(hwArtifact.currentVersionId);
  if (!hwVersion) return null;
  const hwContent = await deps.content.load(hwVersion.contentRef).catch(() => "");
  let mcuId = "";
  try {
    mcuId = (JSON.parse(hwContent) as { selectedMcuId?: string }).selectedMcuId ?? "";
  } catch {
    mcuId = "";
  }
  const platform = createPlatformRegistry().getOrNone(mcuId);
  if (!platform) return null;

  const components = await resolveComponents(projectId, deps);
  const engine = new ConstraintEngine(platform, components);
  const result = engine.validate();
  const allocation = result.pinAllocation;

  const pinMap: PinMapEntry[] = [];
  for (const a of allocation?.assignments ?? []) {
    const comp = components.find(([id]) => id === a.instanceId)?.[1];
    pinMap.push({
      component: comp ? displayNameOf(comp) : a.instanceId,
      pinId: a.physicalPin,
      type: typeOf(a.interface),
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
        });
      }
    }
  }
  const issues = issuesFromDiagnostics(result.diagnostics);
  return { pinMap, issues, content: JSON.stringify({ pinMap, issues }) };
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
  const { pinMap, issues, content } = computed;

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
    status: issues.some((i) => i.severity === "error") ? "draft" : "accepted",
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

  return { artifact: committedArtifact, version, pinMap, issues };
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
  try {
    pinMap = (JSON.parse(content) as { pinMap?: PinMapEntry[] }).pinMap ?? [];
  } catch {
    pinMap = [];
  }

  // 电气规则：strapping 引脚占用 + 重复引脚
  const rules = ["strapping_pin_usage", "duplicate_pin"];
  const diagnostics: ValidationRecordDto["diagnostics"] = [];

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
        details: { pin: entry.pinId },
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
