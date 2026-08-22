// application/capabilities/mcu.ts — MCU 推荐与选择（application-contract 2.6/2.7；ISSUE-005 §3/§6）
// recommend_mcu：knowledge 纯求值（platforms + components + compatibility/classification），不经 AI——
// 冻结 UI 候选数据 = 知识事实源；对照已接受需求（requirements artifact v1 内容）产出约束警告。
// select_mcu：Hardware artifact v1（首选）/ v2（更换）+ artifact.version.created；
// 更换下游失效仅提示（Stale 标记在 S5B，本票不实现）。
import { createPlatformRegistry, type PlatformDefinition, type ReferenceKitDefinition } from "@/src/domain/knowledge/platforms";
import { createComponentRegistry } from "@/src/domain/knowledge/components";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";
import { createArtifactVersion, type Artifact, type ArtifactVersion } from "@/src/domain/models/artifact";
import { assertNotArchived } from "@/src/domain/models/project";
import { computeDownstreamMarks } from "@/src/application/capabilities/revalidate";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class InvalidMcuError extends Error {
  constructor(mcuId: string) {
    super(`Invalid MCU: ${mcuId}`);
    this.name = "InvalidMcuError";
  }
}

export interface McuCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

export interface McuCandidate {
  id: string;
  displayName: string;
  tier: "recommended" | "alternative" | "industrial";
  core: string;
  wireless: string;
  flashSram: string;
  ioMatrix: string;
  reason: string;
  constraints: string[];
  /** V1 审计：候选规格声明的官方来源（无来源平台不得进入候选矩阵） */
  sourceUrl?: string;
  sourceTitle?: string;
  referenceKit?: ReferenceKitDefinition;
}

export interface PeripheralView {
  id: string;
  displayName: string;
  interfaceType: string;
  capability: string;
}

export interface RecommendResult {
  candidates: McuCandidate[];
  peripherals: PeripheralView[];
}

export interface SelectResult {
  artifact: Artifact;
  version: ArtifactVersion;
  changed: boolean;
}

const OWNER = "owner";

function toCandidate(p: PlatformDefinition): McuCandidate {
  return {
    id: p.id,
    displayName: p.displayName,
    tier: p.candidateTier ?? "alternative",
    core: `${p.family.toUpperCase()} (${p.logicVoltage}V)`,
    wireless: p.wireless ?? "—",
    flashSram: p.flashSram ?? `${p.memory.flashKb}KB Flash / ${p.memory.sramKb}KB SRAM`,
    ioMatrix: p.ioMatrix ?? `${p.pins.digital.length} GPIOs`,
    reason: p.reason ?? "",
    constraints: [...(p.constraints ?? [])],
    ...(p.source ? { sourceUrl: p.source.url, sourceTitle: p.source.title } : {}),
    ...(p.referenceKit ? { referenceKit: p.referenceKit } : {}),
  };
}

/** 需求能力标题 → 组件能力（外设推导映射；Golden Journey 固定需求集） */
const CAPABILITY_TO_COMPONENT: Array<{ match: RegExp; capability: string }> = [
  { match: /soil|moisture/i, capability: "soil_moisture_sensing" },
  { match: /pump|relay|water/i, capability: "high_power_switching" },
  { match: /display|oled|lcd/i, capability: "graphical_display" },
];

export async function recommendMcu(
  input: { projectId: string },
  deps: Pick<McuCapabilityDeps, "persistence" | "content">,
): Promise<RecommendResult> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();

  const registry = createPlatformRegistry();
  const components = createComponentRegistry();

  // 需求能力（requirements artifact v1 内容；无则空）
  const reqArtifact = await deps.persistence.getArtifactByKind(input.projectId, "requirements");
  let capabilities: Array<{ id: string; title: string; status: string }> = [];
  if (reqArtifact?.currentVersionId) {
    const version = await deps.persistence.getVersion(reqArtifact.currentVersionId);
    if (version) {
      const content = await deps.content.load(version.contentRef).catch(() => "");
      try {
        const parsed = JSON.parse(content) as { capabilities?: Array<{ id: string; title: string; status: string }> };
        capabilities = parsed.capabilities ?? [];
      } catch {
        capabilities = [];
      }
    }
  }
  const needsWireless = capabilities.some((c) => /wifi|wireless|bluetooth|connect/i.test(c.title));

  // 候选（推荐/备选/工业级 + 对照需求的约束警告）
  const candidates = registry.allIds
    .filter((id) => registry.get(id).candidateTier !== undefined) // 仅候选矩阵平台
    .map((id) => {
      const p = registry.get(id);
      const constraints = [...(p.constraints ?? [])];
      if (needsWireless && !/wifi|ble/i.test(p.wireless ?? "")) {
        constraints.push("No integrated Wi-Fi — conflicts with wireless requirement");
      }
      return toCandidate({ ...p, constraints: [...new Set(constraints)] });
    });

  // 外设映射（需求能力 → 组件目录）
  const peripherals: PeripheralView[] = [];
  for (const cap of capabilities) {
    for (const rule of CAPABILITY_TO_COMPONENT) {
      if (rule.match.test(cap.title)) {
        const comps = components.findByCapability(rule.capability);
        for (const comp of comps) {
          if (!peripherals.some((p) => p.id === comp.id)) {
            peripherals.push({
              id: comp.id,
              displayName: comp.displayName,
              interfaceType: comp.interfaces[0]?.type ?? "digital",
              capability: rule.capability,
            });
          }
        }
        break;
      }
    }
  }

  return { candidates, peripherals };
}

export async function selectMcu(
  input: { projectId: string; mcuId: string },
  deps: McuCapabilityDeps,
): Promise<SelectResult> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();
  assertNotArchived(project);

  const registry = createPlatformRegistry();
  const platform = registry.getOrNone(input.mcuId);
  if (!platform) throw new InvalidMcuError(input.mcuId);

  const artifact = await deps.persistence.getArtifactByKind(input.projectId, "hardware");
  const existing = artifact?.currentVersionId
    ? await deps.persistence.getVersion(artifact.currentVersionId)
    : null;
  const prevContent = existing ? await deps.content.load(existing.contentRef).catch(() => "") : "";
  let prevMcu = "";
  try {
    prevMcu = prevContent ? ((JSON.parse(prevContent) as { selectedMcuId?: string }).selectedMcuId ?? "") : "";
  } catch {
    prevMcu = "";
  }
  const changed = artifact !== null && prevMcu !== input.mcuId;

  // 幂等：同 MCU 重复选择 → 返回当前版本，不产生新版本（spec §10.2 select_mcu 自然幂等）
  if (!changed && artifact?.currentVersionId) {
    const current = await deps.persistence.getVersion(artifact.currentVersionId);
    if (current) {
      return { artifact, version: current, changed: false };
    }
  }

  // 外设（Hardware 内容包含 selectedMcuId + peripherals）
  const { peripherals } = await recommendMcu({ projectId: input.projectId }, deps);
  const content = JSON.stringify({
    selectedMcuId: input.mcuId,
    displayName: platform.displayName,
    ...(platform.referenceKit ? { referenceKit: platform.referenceKit } : {}),
    peripherals: peripherals.map((p) => p.id),
  });

  const versionNo = artifact ? (await deps.persistence.listVersions(artifact.id)).length + 1 : 1;
  const { contentRef, contentHash } = await deps.content.store(
    { projectId: input.projectId, kind: "hardware", versionNo },
    content,
  );
  const version = createArtifactVersion({
    artifactId: artifact?.id ?? "pending",
    versionNo,
    contentRef,
    contentHash,
    status: "accepted",
    sourceKind: "proposal",
    sourceProposalId: null,
    createdBy: OWNER,
    now,
  });

  let committedArtifact: Artifact | null = artifact;
  // S5B：依赖求值（只读计算，随版本提交同事务写 marks——T1/T2 同事务；I-4 不删除下游）
  const downstreamMarks = changed
    ? await computeDownstreamMarks(
        {
          projectId: input.projectId,
          kind: "hardware",
          fromContent: prevContent,
          toContent: content,
          sourceVersionId: version.id,
          triggeredBy: "select_mcu",
          now,
        },
        deps,
      )
    : [];
  await deps.persistence.withTransaction((uow) => {
    if (!committedArtifact) {
      committedArtifact = domainCreateArtifact({ projectId: input.projectId, kind: "hardware", now });
      uow.createArtifact(committedArtifact);
    }
    uow.createVersion({ ...version, artifactId: committedArtifact.id });
    uow.setCurrentVersion(committedArtifact.id, version.id);
    if (downstreamMarks.length) uow.saveStaleMarks(downstreamMarks);
  });
  if (!committedArtifact) throw new Error("selectMcu: artifact not materialized");
  const fresh = await deps.persistence.getArtifactByKind(input.projectId, "hardware");
  committedArtifact = fresh ?? committedArtifact;

  deps.events.publish({
    type: "artifact.version.created",
    projectId: input.projectId,
    artifactId: committedArtifact.id,
    versionId: version.id,
    kind: "hardware",
    versionNo: version.versionNo,
    createdAt: version.createdAt,
  });

  return { artifact: committedArtifact, version, changed };
}
