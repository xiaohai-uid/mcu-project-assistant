// application/capabilities/diagnosis.ts — diagnose_build（application-contract 2.13；ISSUE-010 §3/§6）
// Build FAILED → 诊断（原因/建议/Fix Proposal，type='firmware' + build_fix payload 形状；
// DB CHECK 冻结无 build_fix 类型——payload 判别 isBuildFixPayload，见 delivery record deviation）
// 三模型分离：诊断不改资产（I-1）；fix accept（T2）→ 恰一新 Firmware 版本；重建 = 新 BuildRecord（D2）。
// 禁止自动修复（必须有用户 Accept——Proposal Gate 无例外）。
import { createArtifactVersion, type ArtifactVersion } from "@/src/domain/models/artifact";
import { createProposal as domainCreateProposal, type Proposal } from "@/src/domain/models/proposal";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";

export class BuildNotFoundError extends Error {
  constructor() {
    super("Build record not found");
    this.name = "BuildNotFoundError";
  }
}

export class BuildNotFailedError extends Error {
  constructor() {
    super("Only failed builds can be diagnosed");
    this.name = "BuildNotFailedError";
  }
}

export interface DiagnosisCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  ai: AIProviderPort;
  now?: () => Date;
}

export interface BuildFixDiagnosis {
  title: string;
  cause: string;
  fix: string;
  proposal: { file: string; diff: string; proposalId?: string } | null;
}

/** build_fix 提案载荷判别（payload = { file, diff }；区别于固件生成 files 映射与 revalidate 占位载荷） */
export function isBuildFixPayload(payload: string): boolean {
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    return typeof p.file === "string" && typeof p.diff === "string";
  } catch {
    return false;
  }
}

const OWNER = "owner";

/**
 * diagnose_build：Build FAILED → AI mock 诊断 → build_fix 提案（pending；不写版本）。
 * 幂等：同 build 已有 pending build_fix 提案 → 返回既有提案（不重复创建）。
 */
export async function diagnoseBuild(
  input: { buildId: string; now?: () => Date },
  deps: DiagnosisCapabilityDeps,
): Promise<{ diagnosis: BuildFixDiagnosis; proposal: Proposal }> {
  const now = deps.now ?? (() => new Date());
  const record = await deps.persistence.getBuildRecord(input.buildId);
  if (!record) throw new BuildNotFoundError();
  if (record.status !== "failed") throw new BuildNotFailedError();

  // 项目/固件 artifact 经版本链解析（BuildRecord 只存 artifactVersionId）
  const version = await deps.persistence.getVersion(record.artifactVersionId);
  const artifact = version ? await deps.persistence.getArtifact(version.artifactId) : null;
  const projectId = artifact?.projectId ?? "";
  if (!projectId) throw new BuildNotFoundError();

  // 幂等：同 build 已有 pending build_fix 提案 → 返回既有
  const existing = await pendingBuildFixFor(deps.persistence, projectId, input.buildId);
  if (existing) {
    return { diagnosis: diagnosisFromProposal(existing), proposal: existing };
  }

  // AI 诊断（mock 脚本；provider 不可用 → 503 保留手动修复路径）
  if ((await deps.ai.status()) === "unavailable") throw new ProviderUnavailableError("AI provider unavailable");
  const { data } = await deps.ai.generateStructured<{
    cause: string;
    fix: string;
    file: string;
    diff: string;
  }>({
    prompt: "Diagnose the failed build and propose a fix",
    schema: "build-diagnosis",
    context: { buildId: input.buildId, exitCode: record.exitCode },
    signal: new AbortController().signal,
  });

  // build_fix 提案（base = 当前 firmware 版本；OutdatedProposal：固件被改后修复提案过期）
  const fwArtifact = await deps.persistence.getArtifactByKind(projectId, "firmware");
  const proposal = domainCreateProposal({
    projectId,
    artifactId: fwArtifact?.id ?? "",
    baseVersionId: fwArtifact?.currentVersionId ?? null,
    type: "firmware",
    payload: JSON.stringify({ file: data.file, diff: data.diff }),
    diff: { file: data.file, diff: data.diff, from: "platformio.ini", to: "platformio.ini + lib_deps" },
    impacts: ["firmware"],
    reason: `build_fix:${input.buildId}`,
    createdBy: OWNER,
    now,
  });
  await deps.persistence.withTransaction((uow) => uow.createProposal(proposal));
  deps.events.publish({ type: "proposal.created", projectId, proposalId: proposal.id, kind: "firmware" });
  deps.events.publish({
    type: "diagnosis.completed",
    projectId,
    buildId: input.buildId,
    cause: data.cause,
  });
  return { diagnosis: diagnosisFromProposal(proposal), proposal };
}

async function pendingBuildFixFor(
  persistence: PersistencePort,
  projectId: string,
  buildId: string,
): Promise<Proposal | null> {
  if (!projectId) return null;
  const proposals = await persistence.listProposals(projectId);
  return (
    proposals.find(
      (p) => p.status === "pending" && p.reason === `build_fix:${buildId}` && isBuildFixPayload(p.payload),
    ) ?? null
  );
}

function diagnosisFromProposal(p: Proposal): BuildFixDiagnosis {
  const payload = JSON.parse(p.payload) as { file: string; diff: string };
  return {
    title: "Missing library dependency",
    cause: "src/main.cpp includes <Adafruit_SSD1306.h> but the OLED library is not declared in the project dependencies.",
    fix: "Add the Adafruit SSD1306 library to platformio.ini and rebuild.",
    proposal: { file: payload.file, diff: payload.diff, proposalId: p.id },
  };
}

/** 行级 diff 应用（确定性；幂等——已包含则跳过）；lib_deps 追加到 [env] 段尾 */
export function applyLineDiff(current: string, diff: string): string {
  const additions = diff
    .split("\n")
    .map((l) => l.replace(/^\+/, ""))
    .filter((l) => l.trim().length > 0);
  if (additions.every((l) => current.includes(l.trim()))) return current;
  return `${current.trimEnd()}\n${additions.join("\n")}\n`;
}

/**
 * build_fix 提案接受（T2）：写真实文件（platformio.ini +lib_deps；main.cpp 不变）→ Firmware 新版本。
 * 恰一新版本（三模型分离：诊断不改资产、修复提案被接受才产生版本、重建是新 BuildRecord）。
 */
export async function applyFirmwareFix(proposal: Proposal, deps: Pick<DiagnosisCapabilityDeps, "persistence" | "content" | "events" | "now">): Promise<ArtifactVersion> {
  const now = deps.now ?? (() => new Date());
  const payload = JSON.parse(proposal.payload) as { file: string; diff: string };
  const fwArtifact = await deps.persistence.getArtifact(proposal.artifactId);
  if (!fwArtifact) throw new BuildNotFoundError();
  const current = fwArtifact.currentVersionId
    ? await deps.persistence.getVersion(fwArtifact.currentVersionId)
    : null;
  if (!current) throw new BuildNotFoundError();

  // 当前文件：main.cpp（版本 contentRef）+ 同级 platformio.ini
  const mainRef = current.contentRef;
  const pioRef = mainRef.replace("src/main.cpp", "platformio.ini");
  const mainCpp = await deps.content.load(mainRef).catch(() => "");
  const pioCurrent = await deps.content.load(pioRef).catch(() => "");
  const pioNext = payload.file === "platformio.ini" ? applyLineDiff(pioCurrent, payload.diff) : pioCurrent;

  const versionNo = (await deps.persistence.listVersions(fwArtifact.id)).reduce((m, v) => Math.max(m, v.versionNo), 0) + 1;
  const mainStore = await deps.content.store(
    { projectId: proposal.projectId, kind: "firmware", versionNo, subpath: "src/main.cpp" },
    mainCpp,
  );
  await deps.content.store(
    { projectId: proposal.projectId, kind: "firmware", versionNo, subpath: "platformio.ini" },
    pioNext,
  );
  const version = createArtifactVersion({
    artifactId: fwArtifact.id,
    versionNo,
    contentRef: mainStore.contentRef,
    contentHash: mainStore.contentHash,
    status: "accepted",
    sourceKind: "proposal",
    sourceProposalId: proposal.id,
    createdBy: OWNER,
    now,
  });
  await deps.persistence.withTransaction((uow) => {
    uow.createVersion(version);
    uow.setCurrentVersion(fwArtifact.id, version.id);
    uow.resolveStaleMarks(fwArtifact.id, version.id);
  });
  deps.events.publish({
    type: "artifact.version.created",
    projectId: proposal.projectId,
    artifactId: fwArtifact.id,
    versionId: version.id,
    kind: "firmware",
    versionNo: version.versionNo,
    createdAt: version.createdAt,
  });
  return version;
}
