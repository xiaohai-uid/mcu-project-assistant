// domain/models/proposal.ts — Proposal 领域（application-contract 2.4/2.5；ISSUE-004 §7）
// I-1：AI 不静默覆盖（一切 AI 修改经 Proposal Gate）；I-3：Reject 零效果；
// 决策状态机 pending→accepted|rejected，可逆（改主意）且历史保留（审计）。
// OutdatedProposal：accept 时 baseVersionId === artifact.currentVersionId 强制校验（禁止静默应用）。
import type { ProposalDto, ProposalStatus, ProposalType } from "@/src/shared-contracts/types";
import { randomUUID } from "node:crypto";

export class InvalidDecisionError extends Error {
  constructor(decision: string) {
    super(`Invalid decision: ${decision} (expected accept|reject)`);
    this.name = "InvalidDecisionError";
  }
}

export class OutdatedProposalError extends Error {
  constructor(readonly proposalId: string, readonly baseVersionId: string | null, readonly currentVersionId: string | null) {
    super(
      `Proposal ${proposalId} is based on version ${baseVersionId ?? "∅"} but current version is ${currentVersionId ?? "∅"} — regenerate required`,
    );
    this.name = "OutdatedProposalError";
  }
}

export type Proposal = ProposalDto;

export function createProposal(input: {
  projectId: string;
  artifactId: string;
  baseVersionId: string | null;
  type: ProposalType;
  payload: string;
  diff: Record<string, unknown> | null;
  impacts: string[];
  reason: string | null;
  createdBy: string;
  now?: () => Date;
}): Proposal {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    artifactId: input.artifactId,
    baseVersionId: input.baseVersionId,
    type: input.type,
    payload: input.payload,
    diff: input.diff,
    impacts: input.impacts,
    reason: input.reason,
    status: "pending",
    createdBy: input.createdBy,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    decidedAt: null,
    decisionHistory: [],
    number: 0, // 列表序号由 capability 填充
  };
}

/** 决策：pending→accepted|rejected；可逆（改主意）且历史保留；同决策重复 = no-op */
export function decideProposal(p: Proposal, decision: "accept" | "reject", now: () => Date = () => new Date()): Proposal {
  if (decision !== "accept" && decision !== "reject") throw new InvalidDecisionError(String(decision));
  const status: ProposalStatus = decision === "accept" ? "accepted" : "rejected";
  if (p.status === status) return p; // 幂等：同决策重复 no-op（历史不重复追加）
  return {
    ...p,
    status,
    decidedAt: now().toISOString(),
    decisionHistory: [...p.decisionHistory, { status, at: now().toISOString() }],
  };
}

/** OutdatedProposal 强制校验：accept 时 base 必须等于当前版本（否则禁止应用） */
export function assertProposalCurrent(p: Proposal, currentVersionId: string | null): void {
  if (p.baseVersionId !== currentVersionId) {
    throw new OutdatedProposalError(p.id, p.baseVersionId, currentVersionId);
  }
}
