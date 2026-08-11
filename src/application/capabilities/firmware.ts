// application/capabilities/firmware.ts — 固件提案（application-contract 2.11；ISSUE-008 §3/§6）
// generate_firmware_proposal：firmware-generator 求值 → **只产出 Proposal，不写版本**（I-1 Proposal Gate 无例外）
// Accept（T2）：写真实文件（firmware/NNNN/src/main.cpp + platformio.ini，workspace Git-friendly）
//   + Firmware 版本 + Pin Map/Wiring 联动版本（继电器引脚重映射；一次接受事务 = 一个决策）
// Reject（T3）：零变化（S3B 机制，无固件特判）
import {
  generateFirmware,
  type FirmwareFiles,
  type PinMapEntry,
} from "@/src/domain/services/firmware-generator";
import {
  createArtifact as domainCreateArtifact,
  createArtifactVersion,
  type Artifact,
} from "@/src/domain/models/artifact";
import { assertNotArchived } from "@/src/domain/models/project";
import { createProposal as domainCreateProposal, type Proposal } from "@/src/domain/models/proposal";
import { ensureArtifact } from "@/src/application/capabilities/artifacts";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { ArtifactKind, ArtifactVersionDto } from "@/src/shared-contracts/types";

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class NoPinMapError extends Error {
  constructor() {
    super("Pin Map required before firmware generation");
    this.name = "NoPinMapError";
  }
}

export interface FirmwareCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

const OWNER = "owner";

/** 固件生成提案载荷判别（payload = files 映射）；S5B revalidate 占位载荷（{code}）走普通路径 */
export function isFirmwareFilesPayload(payload: string): boolean {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    return typeof p["src/main.cpp"] === "string" && typeof p["platformio.ini"] === "string";
  } catch {
    return false;
  }
}

function pinNumber(pinId: string): string {
  return pinId.replace(/^IO/, "");
}

async function currentPinMap(
  projectId: string,
  deps: Pick<FirmwareCapabilityDeps, "persistence" | "content">,
): Promise<{ pinMap: PinMapEntry[]; artifact: Artifact; versionId: string } | null> {
  const artifact = await deps.persistence.getArtifactByKind(projectId, "pinmap");
  if (!artifact?.currentVersionId) return null;
  const version = await deps.persistence.getVersion(artifact.currentVersionId);
  if (!version) return null;
  const content = await deps.content.load(version.contentRef).catch(() => "");
  let pinMap: PinMapEntry[] = [];
  try {
    pinMap = (JSON.parse(content) as { pinMap?: PinMapEntry[] }).pinMap ?? [];
  } catch {
    pinMap = [];
  }
  return { pinMap, artifact, versionId: version.id };
}

/**
 * generate_firmware_proposal（contract 2.11）：
 * - 前置：firmware 非 Blocking Stale（E1 下游非 Blocking Stale）；已有 Pin Map
 * - 求值：firmware-generator（模板 + 引脚注入）→ files + 重映射建议
 * - 产出：Proposal（type='firmware'，payload=files，diff=引脚行对比，impacts）；**不写版本**
 * - base = pinmap 当前版本（引脚变更 → 旧提案 OutdatedProposal）
 */
export async function generateFirmwareProposal(
  input: { projectId: string },
  deps: FirmwareCapabilityDeps,
): Promise<{ proposal: Proposal; generation: ReturnType<typeof generateFirmware> }> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();
  assertNotArchived(project);

  // E1 前置：下游非 Blocking Stale（I-8；门禁矩阵：固件依赖 L3 → 提示 Revalidate）
  const fwArtifact = await deps.persistence.getArtifactByKind(input.projectId, "firmware");
  if (fwArtifact?.currentVersionId) {
    const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
    await assertNotBlocking({ projectId: input.projectId, action: "generate_firmware", artifactId: fwArtifact.id }, deps);
  }

  const pinmap = await currentPinMap(input.projectId, deps);
  if (!pinmap) throw new NoPinMapError();

  // 平台（hardware 当前内容）
  const hwArtifact = await deps.persistence.getArtifactByKind(input.projectId, "hardware");
  let platform = { id: "ESP32-S3", displayName: "ESP32-S3 WROOM-1" };
  if (hwArtifact?.currentVersionId) {
    const hwVersion = await deps.persistence.getVersion(hwArtifact.currentVersionId);
    if (hwVersion) {
      const hwContent = await deps.content.load(hwVersion.contentRef).catch(() => "");
      try {
        const parsed = JSON.parse(hwContent) as { selectedMcuId?: string; displayName?: string };
        platform = { id: parsed.selectedMcuId ?? platform.id, displayName: parsed.displayName ?? platform.displayName };
      } catch {
        // 保持默认
      }
    }
  }

  const generation = generateFirmware({ pinMap: pinmap.pinMap, platform });
  const files = generation.files;

  // diff = 引脚行对比（strapping → 重映射；语义变化必须 diff 可见——contract 2.11）
  const diff =
    generation.bootRisk && generation.proposedRelayPin
      ? {
          file: "src/main.cpp",
          oldPin: generation.relayPin ?? "",
          newPin: generation.proposedRelayPin,
          oldLine: `#define PUMP_RELAY_PIN   ${pinNumber(generation.relayPin ?? "")}`,
          newLine: `#define PUMP_RELAY_PIN   ${pinNumber(generation.proposedRelayPin)}`,
          bootRisk: true,
        }
      : null;

  const targetArtifact = await ensureArtifact({ projectId: input.projectId, kind: "firmware" }, deps);
  if (!targetArtifact) throw new ProjectNotFoundError();
  const proposal = domainCreateProposal({
    projectId: input.projectId,
    artifactId: targetArtifact.id,
    baseVersionId: pinmap.versionId, // 引脚版本为基准（OutdatedProposal：引脚改 → 旧提案失效）
    type: "firmware",
    payload: JSON.stringify(files),
    diff,
    impacts: diff ? ["firmware", "pinmap", "wiring"] : ["firmware"],
    reason: generation.bootRisk
      ? `Strapping pin remap proposal (${generation.relayPin} → ${generation.proposedRelayPin})`
      : "Firmware generation proposal",
    createdBy: OWNER,
    now,
  });
  await deps.persistence.withTransaction((uow) => uow.createProposal(proposal));
  deps.events.publish({
    type: "proposal.created",
    projectId: input.projectId,
    proposalId: proposal.id,
    kind: "firmware",
  });
  return { proposal, generation };
}

/**
 * 固件生成提案接受（T2；resolveProposal accept 调用）：一次决策事务——
 * 写真实文件 → Firmware 版本 + Pin Map/Wiring 联动版本（继电器引脚重映射）→ 解除相关 marks。
 * 固件源码只在 workspace 真实文件（禁 SQLite JSON——DoD 断言）。
 */
export async function applyFirmwareAccept(proposal: Proposal, deps: FirmwareCapabilityDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const files = JSON.parse(proposal.payload) as FirmwareFiles;
  const newPin = (proposal.diff as { newPin?: string } | null)?.newPin ?? null;

  const fwArtifact = await deps.persistence.getArtifact(proposal.artifactId);
  if (!fwArtifact) throw new ProjectNotFoundError();
  const fwVersionNo = (await deps.persistence.listVersions(fwArtifact.id)).reduce((m, v) => Math.max(m, v.versionNo), 0) + 1;

  // 真实文件（版本目录原子写；内容本体在 workspace）
  const main = await deps.content.store(
    { projectId: proposal.projectId, kind: "firmware", versionNo: fwVersionNo, subpath: "src/main.cpp" },
    files["src/main.cpp"],
  );
  await deps.content.store(
    { projectId: proposal.projectId, kind: "firmware", versionNo: fwVersionNo, subpath: "platformio.ini" },
    files["platformio.ini"],
  );

  // 联动：Pin Map 新版本（继电器 → 新引脚；内容形状与 generate_pin_map 一致）
  const pinmap = await currentPinMap(proposal.projectId, deps);
  const updatedPinMap = newPin
    ? (pinmap?.pinMap ?? []).map((p) =>
        /pump|relay/i.test(p.component) ? { ...p, pinId: newPin } : p,
      )
    : (pinmap?.pinMap ?? []);
  const pmArtifact = pinmap?.artifact;
  const pmVersionNo = pmArtifact ? (await deps.persistence.listVersions(pmArtifact.id)).reduce((m, v) => Math.max(m, v.versionNo), 0) + 1 : 1;
  const pmStore = await deps.content.store(
    { projectId: proposal.projectId, kind: "pinmap", versionNo: pmVersionNo },
    JSON.stringify({ pinMap: updatedPinMap, issues: [] }),
  );

  // 联动：Wiring 新版本（接线内容 = 联动后的引脚映射；artifact 缺省则创建——S5A 链路 wiring 未落库）
  let wiringArtifact = await deps.persistence.getArtifactByKind(proposal.projectId, "wiring");
  const wiringVersionNo = wiringArtifact
    ? (await deps.persistence.listVersions(wiringArtifact.id)).reduce((m, v) => Math.max(m, v.versionNo), 0) + 1
    : 1;
  const wiringStore = await deps.content.store(
    { projectId: proposal.projectId, kind: "wiring", versionNo: wiringVersionNo },
    JSON.stringify({ pinMappings: updatedPinMap }),
  );

  const makeVersion = (input: {
    artifactId: string;
    versionNo: number;
    store: { contentRef: string; contentHash: string };
  }): ArtifactVersionDto =>
    createArtifactVersion({
      artifactId: input.artifactId,
      versionNo: input.versionNo,
      contentRef: input.store.contentRef,
      contentHash: input.store.contentHash,
      status: "accepted",
      sourceKind: "proposal",
      sourceProposalId: proposal.id,
      createdBy: OWNER,
      now,
    });

  const fwVersion = makeVersion({ artifactId: fwArtifact.id, versionNo: fwVersionNo, store: main });
  const pmVersion = pmArtifact
    ? makeVersion({ artifactId: pmArtifact.id, versionNo: pmVersionNo, store: pmStore })
    : null;
  if (!wiringArtifact) {
    wiringArtifact = domainCreateArtifact({ projectId: proposal.projectId, kind: "wiring", now });
  }
  const wiringVersion = makeVersion({ artifactId: wiringArtifact.id, versionNo: wiringVersionNo, store: wiringStore });

  await deps.persistence.withTransaction((uow) => {
    uow.createVersion(fwVersion);
    uow.setCurrentVersion(fwArtifact.id, fwVersion.id);
    if (pmArtifact && pmVersion) {
      uow.createVersion(pmVersion);
      uow.setCurrentVersion(pmArtifact.id, pmVersion.id);
    }
    if (wiringArtifact.currentVersionId === null) {
      uow.createArtifact(wiringArtifact);
    }
    uow.createVersion(wiringVersion);
    uow.setCurrentVersion(wiringArtifact.id, wiringVersion.id);
    // 接受 = 所有者决策（该提案由当前 pinmap 状态生成）→ 相关 marks 解除
    uow.resolveStaleMarks(fwArtifact.id, fwVersion.id);
    if (pmArtifact) uow.resolveStaleMarks(pmArtifact.id, pmVersion?.id ?? "");
    if (wiringArtifact.currentVersionId === null) uow.resolveStaleMarks(wiringArtifact.id, wiringVersion.id);
  });

  // 事件（T2 事务后；UI 版本徽标/联动刷新）
  for (const [kind, artifact, version] of [
    ["firmware", fwArtifact, fwVersion],
    ["pinmap", pmArtifact, pmVersion],
    ["wiring", wiringArtifact, wiringVersion],
  ] as Array<[ArtifactKind, Artifact | null, ArtifactVersionDto | null]>) {
    if (!artifact || !version) continue;
    deps.events.publish({
      type: "artifact.version.created",
      projectId: proposal.projectId,
      artifactId: artifact.id,
      versionId: version.id,
      kind,
      versionNo: version.versionNo,
      createdAt: version.createdAt,
    });
  }
}
