// application/capabilities/revalidate.ts — revalidate_artifact（application-contract 2.14；ISSUE-007 §3/§6）
// 逐项重算：无语义变化 → Validated（resolved）；有语义变化 → create_proposal 待决策（D1 不自动接受）。
// L3 门禁：flash / 标 Validation 成功 / 宣称 Validated 拒绝（I-8）。
// 依赖求值在版本提交事务内触发（saveStaleMarks 同事务）。
import { randomUUID } from "node:crypto";
import { classifyChange, transitiveDownstreamOf, evaluateStale, type StaleLevel } from "@/src/domain/services/dependency-evaluation";
import { createProposal as domainCreateProposal } from "@/src/domain/models/proposal";
import { assertNotArchived } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { ArtifactKind, StaleMarkDto } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";

export class BlockingStaleError extends Error {
  constructor(artifactKind: string, action: string) {
    super(`Blocking stale (L3) on ${artifactKind} — ${action} requires revalidation`);
    this.name = "BlockingStaleError";
  }
}

export class NoStaleError extends Error {
  constructor() {
    super("No stale marks to revalidate");
    this.name = "NoStaleError";
  }
}

export interface RevalidateCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

const OWNER = "owner";

/**
 * 版本提交后的依赖求值（只读）：sourceVersionId 变化 → 下游（传递闭包）打 mark 的计算。
 * 由调用方在**版本提交同事务**内 saveStaleMarks（T1/T2 同事务；I-4 不删除下游）。
 */
export async function computeDownstreamMarks(
  input: { projectId: string; kind: string; fromContent: string; toContent: string; sourceVersionId: string; triggeredBy: string; now?: () => Date },
  deps: Pick<RevalidateCapabilityDeps, "persistence" | "content">,
): Promise<StaleMarkDto[]> {
  const classification = classifyChange(input.kind, input.fromContent, input.toContent);
  const marks: StaleMarkDto[] = [];
  for (const downstream of transitiveDownstreamOf(input.kind)) {
    const artifact = await deps.persistence.getArtifactByKind(input.projectId, downstream as ArtifactKind);
    const hasContent = artifact?.currentVersionId !== null && artifact?.currentVersionId !== undefined;
    const evaluation = evaluateStale({
      classification,
      edge: { from: input.kind, to: downstream },
      downstreamKind: downstream,
      downstreamHasContent: hasContent,
    });
    if (evaluation) {
      marks.push({
        id: randomUUID(),
        projectId: input.projectId,
        artifactId: artifact!.id,
        affectedVersionId: artifact!.currentVersionId,
        level: evaluation.level as StaleLevel,
        reason: evaluation.reason,
        sourceVersionId: input.sourceVersionId,
        triggeredBy: input.triggeredBy,
        createdAt: (input.now ?? (() => new Date()))().toISOString(),
        resolvedAt: null,
      });
    }
  }
  return marks;
}

export async function activeStaleMarks(
  input: { projectId: string },
  deps: Pick<RevalidateCapabilityDeps, "persistence">,
): Promise<StaleMarkDto[]> {
  return deps.persistence.activeStaleMarks(input.projectId);
}

/** L3 门禁（I-8；门禁矩阵 stale-semantics §4）：action = flash | mark_validated | declare_validated
 *  artifactId 缺省 → 项目级任意 L3 即拒（flash/run_build 等全项目动作）；指定 → 仅该 artifact 的 L3 拒绝 */
export async function assertNotBlocking(
  input: { projectId: string; action: string; artifactId?: string },
  deps: Pick<RevalidateCapabilityDeps, "persistence">,
): Promise<void> {
  const marks = await deps.persistence.activeStaleMarks(input.projectId);
  const blocking = input.artifactId
    ? marks.find((m) => m.artifactId === input.artifactId && m.level === "L3")
    : marks.find((m) => m.level === "L3");
  if (blocking) {
    const artifact = await deps.persistence.getArtifact(blocking.artifactId);
    throw new BlockingStaleError(artifact?.kind ?? blocking.artifactId, input.action);
  }
}

export interface RevalidateResult {
  outcome: "validated" | "proposal_created" | "error";
  kind: string;
  proposalId?: string;
  error?: string;
}

/**
 * revalidate_artifact：对指定 kind 重算内容并与当前版本对比。
 * - 内容等值（无语义变化）→ resolve mark（Validated；保留版本身份，不 bump）
 * - 内容不同（语义变化）→ create_proposal（pending；等待用户 Accept/Reject——D1 不自动接受）
 */
export async function revalidateArtifact(
  input: { projectId: string; kind: string },
  deps: RevalidateCapabilityDeps,
): Promise<RevalidateResult> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new NoStaleError();
  assertNotArchived(project);

  const artifact = await deps.persistence.getArtifactByKind(input.projectId, input.kind as ArtifactKind);
  if (!artifact?.currentVersionId) throw new NoStaleError();
  const marks = await deps.persistence.activeStaleMarks(input.projectId);
  const mark = marks.find((m) => m.artifactId === artifact.id);
  if (!mark) throw new NoStaleError();
  const current = await deps.persistence.getVersion(artifact.currentVersionId);
  if (!current) throw new NoStaleError();
  const currentContent = await deps.content.load(current.contentRef).catch(() => "");

  // 重算候选（决策同源：pinmap 用 constraint-engine；firmware 用占位生成——S6 换真实生成器）
  const candidate = await recomputeCandidate(input.projectId, input.kind, deps);

  if (candidate === null) {
    // 无法重算的 kind（build 等）：上游已解决即视为有效（链式规则由上游驱动）
    await deps.persistence.withTransaction((uow) => uow.resolveStaleMarks(artifact.id, current.id));
    return { outcome: "validated", kind: input.kind };
  }

  if (candidate === currentContent) {
    // 无语义变化 → Validated（保留原版本身份）
    await deps.persistence.withTransaction((uow) => uow.resolveStaleMarks(artifact.id, current.id));
    return { outcome: "validated", kind: input.kind };
  }

  // 有语义变化 → create_proposal（不自动接受——D1）
  const proposal = domainCreateProposal({
    projectId: input.projectId,
    artifactId: artifact.id,
    baseVersionId: current.id,
    type: input.kind === "firmware" ? "firmware" : "requirement",
    payload: candidate,
    diff: { from: currentContent, to: candidate },
    impacts: [input.kind],
    reason: `Revalidate: semantic change detected in ${input.kind}`,
    createdBy: OWNER,
    now,
  });
  await deps.persistence.withTransaction((uow) => uow.createProposal(proposal));
  deps.events.publish({
    type: "proposal.created",
    projectId: input.projectId,
    proposalId: proposal.id,
    kind: input.kind as ArtifactKind,
  });
  return { outcome: "proposal_created", kind: input.kind, proposalId: proposal.id };
}

/**
 * revalidate scope：kind 指定单项；all/缺省 → 按依赖序逐项重算（application-contract 2.14 stale 范围 or all）。
 * 逐项进度事件：artifact.revalidating / artifact.revalidated / proposal.created（logical-events §5）。
 * 单项失败 → 该项 outcome=error（recompute_failed 可重试），不阻断其余项。
 */
export async function revalidateScope(
  input: { projectId: string; kind?: string },
  deps: RevalidateCapabilityDeps,
): Promise<RevalidateResult[]> {
  const marks = await deps.persistence.activeStaleMarks(input.projectId);
  if (marks.length === 0) throw new NoStaleError();

  if (input.kind) {
    const kind = input.kind as ArtifactKind;
    const artifact = await deps.persistence.getArtifactByKind(input.projectId, kind);
    deps.events.publish({
      type: "artifact.revalidating",
      projectId: input.projectId,
      artifactId: artifact?.id ?? kind,
      kind,
    });
    const r = await revalidateArtifact({ projectId: input.projectId, kind }, deps);
    deps.events.publish({
      type: "artifact.revalidated",
      projectId: input.projectId,
      artifactId: artifact?.id ?? kind,
      kind,
      outcome: r.outcome,
    });
    return [r];
  }

  // 依赖序（上游先于下游；链式规则 stale-semantics §5——下游 Revalidate 依赖上游完成）
  const order: ArtifactKind[] = ["requirements", "hardware", "pinmap", "wiring", "firmware"];
  const kinds = new Set<string>();
  for (const m of marks) {
    const a = await deps.persistence.getArtifact(m.artifactId);
    if (a) kinds.add(a.kind);
  }

  const results: RevalidateResult[] = [];
  for (const kind of order) {
    if (!kinds.has(kind)) continue;
    const artifact = await deps.persistence.getArtifactByKind(input.projectId, kind);
    deps.events.publish({
      type: "artifact.revalidating",
      projectId: input.projectId,
      artifactId: artifact?.id ?? kind,
      kind,
    });
    try {
      const r = await revalidateArtifact({ projectId: input.projectId, kind }, deps);
      results.push(r);
      deps.events.publish({
        type: "artifact.revalidated",
        projectId: input.projectId,
        artifactId: artifact?.id ?? kind,
        kind,
        outcome: r.outcome,
      });
    } catch (err) {
      results.push({ outcome: "error", kind, error: toSafeError(err).message });
      deps.events.publish({
        type: "artifact.revalidated",
        projectId: input.projectId,
        artifactId: artifact?.id ?? kind,
        kind,
        outcome: "error",
      });
    }
  }
  return results;
}

/** 重算候选：pinmap = constraint-engine 纯重算（决策同源、无版本副作用）；firmware = 占位生成（S6 替换）；其余 null */
async function recomputeCandidate(
  projectId: string,
  kind: string,
  deps: RevalidateCapabilityDeps,
): Promise<string | null> {
  if (kind === "pinmap") {
    const { computePinMapContent } = await import("@/src/application/capabilities/wiring");
    const computed = await computePinMapContent(projectId, deps);
    return computed?.content ?? null;
  }
  if (kind === "firmware") {
    // 占位：从 pinmap 当前内容确定性推导（S6 换真实 firmware-generator）
    const pm = await deps.persistence.getArtifactByKind(projectId, "pinmap");
    if (pm?.currentVersionId) {
      const v = await deps.persistence.getVersion(pm.currentVersionId);
      if (v) {
        const content = await deps.content.load(v.contentRef).catch(() => "");
        return JSON.stringify({ code: `// placeholder firmware from ${content.length} bytes pinmap` });
      }
    }
    return null;
  }
  return null;
}
