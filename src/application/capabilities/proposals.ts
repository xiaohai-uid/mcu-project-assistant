// application/capabilities/proposals.ts — 提案能力（application-contract 2.4/2.5；ISSUE-004 §3/§6）
// create_proposal（内部）：分析完成后为每个形式化项产出提案（引用 base 版本，零写入）
// resolve_proposal：accept/reject 决策（OutdatedProposal 强制校验；可逆且历史保留；幂等）
// commitRequirements：proceed（进入硬件选型）→ 聚合 accepted 提案写入 Requirements artifact v1（事务 T2）
import {
  assertProposalCurrent,
  createProposal as domainCreateProposal,
  decideProposal,
  OutdatedProposalError,
  type Proposal,
} from "@/src/domain/models/proposal";
import {
  createArtifact as domainCreateArtifact,
  createArtifactVersion,
  type Artifact,
} from "@/src/domain/models/artifact";
import { assertNotArchived } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { AnalysisProposalDto, ProposalType } from "@/src/shared-contracts/types";
import { isFirmwareFilesPayload } from "@/src/application/capabilities/firmware";

export class ProposalNotFoundError extends Error {
  constructor() {
    super("Proposal not found");
    this.name = "ProposalNotFoundError";
  }
}

export class NoAcceptedProposalsError extends Error {
  constructor() {
    super("No accepted proposals to commit");
    this.name = "NoAcceptedProposalsError";
  }
}

export interface ProposalCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

const OWNER = "owner";

export async function createProposal(
  input: {
    projectId: string;
    artifactId: string;
    baseVersionId: string | null;
    type: ProposalType;
    payload: string;
    diff: Record<string, unknown> | null;
    impacts: string[];
    reason?: string | null;
    now?: () => Date;
  },
  deps: { persistence: PersistencePort },
): Promise<Proposal> {
  const proposal = domainCreateProposal({
    projectId: input.projectId,
    artifactId: input.artifactId,
    baseVersionId: input.baseVersionId,
    type: input.type,
    payload: input.payload,
    diff: input.diff,
    impacts: input.impacts,
    reason: input.reason ?? null,
    createdBy: OWNER,
    now: input.now,
  });
  await deps.persistence.withTransaction((uow) => uow.createProposal(proposal));
  return proposal;
}

export async function resolveProposal(
  input: { proposalId: string; decision: "accept" | "reject"; now?: () => Date },
  deps: ProposalCapabilityDeps,
): Promise<Proposal> {
  const now = deps.now ?? (() => new Date());
  const proposal = await deps.persistence.getProposal(input.proposalId);
  if (!proposal) throw new ProposalNotFoundError();
  if (input.decision === "accept") {
    const artifact = await deps.persistence.getArtifact(proposal.artifactId);
    if (proposal.type === "firmware" && isFirmwareFilesPayload(proposal.payload)) {
      // S6 固件生成提案：base 校验对 pinmap（引脚变更 → 旧提案 OutdatedProposal 拒绝应用）；
      // T2 = 写真实文件 + firmware/pinmap/wiring 联动版本（applyFirmwareAccept）
      const pinmap = await deps.persistence.getArtifactByKind(proposal.projectId, "pinmap");
      assertProposalCurrent(proposal, pinmap?.currentVersionId ?? null);
      const { applyFirmwareAccept } = await import("@/src/application/capabilities/firmware");
      await applyFirmwareAccept(proposal, deps);
    } else {
      // 普通提案（含 S5B revalidate 占位载荷）：base 必须等于自身 artifact 当前版本（禁止静默应用）
      assertProposalCurrent(proposal, artifact?.currentVersionId ?? null);
    }
  }
  const decided = decideProposal(proposal, input.decision, now);
  const currentVersionId = (await deps.persistence.getArtifact(proposal.artifactId))?.currentVersionId ?? null;
  await deps.persistence.withTransaction((uow) => {
    uow.resolveProposal(decided);
    // S5B：接受提案 = 所有者对 artifact 内容的新决策 → 该 artifact 的 Stale 标记解除
    // （stale-semantics §5：Accept → 新决策 → 继续下游 Revalidate；被标记的旧版本被新决策覆盖）
    if (input.decision === "accept") {
      uow.resolveStaleMarks(proposal.artifactId, currentVersionId ?? "");
    }
  });
  return decided;
}

export async function listProposals(
  input: { projectId: string },
  deps: { persistence: PersistencePort },
): Promise<Proposal[]> {
  const all = await deps.persistence.listProposals(input.projectId);
  return all.map((p, i) => ({ ...p, number: i + 1 }));
}

/** proceed（进入硬件选型）：聚合 accepted 提案 → Requirements artifact v1（事务 T2：写内容→插版本→更新 current→发事件） */
export async function commitRequirements(
  input: { projectId: string; capabilities?: Array<{ id: string; title: string; status: string }>; now?: () => Date },
  deps: ProposalCapabilityDeps,
): Promise<{ artifact: import("@/src/domain/models/artifact").Artifact; version: import("@/src/domain/models/artifact").ArtifactVersion }> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProposalNotFoundError();
  assertNotArchived(project);

  const proposals = await deps.persistence.listProposals(input.projectId);
  const accepted = proposals.filter((p) => p.status === "accepted" && p.type === "requirement");
  if (accepted.length === 0) throw new NoAcceptedProposalsError();

  const artifact = await deps.persistence.getArtifactByKind(input.projectId, "requirements");
  // capabilities 来源：调用方显式传入（UI 已完成事件载荷）或回退读最近 analyze 任务 output
  const capabilities = input.capabilities?.length
    ? input.capabilities
    : (await deps.persistence.latestTaskOutput("analyze_requirement").then((out) => {
        try {
          return out ? ((JSON.parse(out) as { capabilities?: unknown[] }).capabilities ?? []) : [];
        } catch {
          return [];
        }
      }));
  const content = JSON.stringify({
    capabilities,
    acceptedProposalIds: accepted.map((p) => p.id),
    acceptedTitles: accepted.map((p) => {
      try {
        return (JSON.parse(p.payload) as { title?: string }).title ?? p.id;
      } catch {
        return p.id;
      }
    }),
  });

  const versionNo = artifact ? (await deps.persistence.listVersions(artifact.id)).length + 1 : 1;
  const { contentRef, contentHash } = await deps.content.store(
    { projectId: input.projectId, kind: "requirements", versionNo },
    content,
  );
  const version = createArtifactVersion({
    artifactId: artifact?.id ?? "pending", // 事务内确定真实 artifactId（见下）
    versionNo,
    contentRef,
    contentHash,
    status: "accepted",
    sourceKind: "proposal",
    sourceProposalId: accepted[0]?.id ?? null,
    createdBy: OWNER,
    now,
  });

  const versionId = version.id;
  // artifact 为 null 时在事务内懒创建；事务后必非空（withTransaction 同步执行）
  let committedArtifact: Artifact | null = artifact;
  await deps.persistence.withTransaction((uow) => {
    if (!committedArtifact) {
      committedArtifact = domainCreateArtifact({ projectId: input.projectId, kind: "requirements", now });
      uow.createArtifact(committedArtifact);
    }
    uow.createVersion({ ...version, artifactId: committedArtifact.id });
    uow.setCurrentVersion(committedArtifact.id, versionId);
  });
  if (!committedArtifact) throw new Error("commitRequirements: artifact not materialized");
  // 事务后重读（返回 fresh currentVersionId 状态）
  const freshArtifact = await deps.persistence.getArtifactByKind(input.projectId, "requirements");
  committedArtifact = freshArtifact ?? committedArtifact;

  deps.events.publish({
    type: "artifact.version.created",
    projectId: input.projectId,
    artifactId: committedArtifact.id,
    versionId,
    kind: "requirements",
    versionNo: version.versionNo,
    createdAt: version.createdAt,
  });
  return { artifact: committedArtifact, version };
}

/** 从分析输出构建提案（analyzeRequirement 内部调用；base = 当前 requirements 版本） */
export async function createProposalsFromAnalysis(
  input: { projectId: string; proposals: AnalysisProposalDto[]; now?: () => Date },
  deps: { persistence: PersistencePort; now?: () => Date },
): Promise<Proposal[]> {
  // 聚合容器先行（proposals 外键引用 artifacts；懒创建幂等）
  let artifact = await deps.persistence.getArtifactByKind(input.projectId, "requirements");
  if (!artifact) {
    const created = domainCreateArtifact({ projectId: input.projectId, kind: "requirements", now: input.now });
    await deps.persistence.withTransaction((uow) => uow.createArtifact(created));
    artifact = created;
  }
  const baseVersionId = artifact.currentVersionId;
  const created: Proposal[] = [];
  for (const p of input.proposals) {
    const proposal = await createProposal(
      {
        projectId: input.projectId,
        artifactId: artifact.id,
        baseVersionId,
        type: "requirement",
        payload: JSON.stringify({
          title: p.title,
          initialIdea: p.initialIdea,
          formalizedRequirement: p.formalizedRequirement,
        }),
        diff: { from: p.initialIdea, to: p.formalizedRequirement },
        impacts: p.impacts,
        now: input.now,
      },
      deps,
    );
    created.push(proposal);
  }
  return created;
}

export { OutdatedProposalError };
