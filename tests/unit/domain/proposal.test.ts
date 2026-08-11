// unit/domain/proposal — Proposal 不变量（application-contract 2.4/2.5；ISSUE-004 §11）
// Reject 零效果；决策可逆且历史保留；OutdatedProposal 校验（base 变更后 accept 必须失败）。
import { describe, expect, it } from "vitest";
import {
  createProposal,
  decideProposal,
  assertProposalCurrent,
  OutdatedProposalError,
  InvalidDecisionError,
  type Proposal,
} from "@/src/domain/models/proposal";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

const base: Omit<Proposal, "id" | "createdAt" | "number"> & { id?: string; createdAt?: string; number?: number } = {
  projectId: "p1",
  artifactId: "a1",
  baseVersionId: null,
  type: "requirement",
  payload: JSON.stringify({ title: "Wireless Connectivity" }),
  diff: { from: "wifi", to: "802.11 b/g/n + BLE 5.0" },
  impacts: ["Hardware", "Power Budget"],
  reason: null,
  status: "pending",
  createdBy: "owner",
  decidedAt: null,
  decisionHistory: [],
};

describe("Proposal 领域（ISSUE-004 §7）", () => {
  it("createProposal：初始 pending，决策历史为空，引用 base 版本", () => {
    const p = createProposal({ ...base, projectId: "p1", now });
    expect(p.status).toBe("pending");
    expect(p.decisionHistory).toEqual([]);
    expect(p.baseVersionId).toBeNull();
    expect(p.createdAt).toBe(NOW);
  });

  it("decide：pending→accepted / pending→rejected 合法；记录决策历史（可逆且保留）", () => {
    const p = createProposal({ ...base, now });
    const accepted = decideProposal(p, "accept", now);
    expect(accepted.status).toBe("accepted");
    expect(accepted.decidedAt).toBe(NOW);
    expect(accepted.decisionHistory).toHaveLength(1);

    // 可逆：改主意 accepted→rejected，历史保留两条
    const rejected = decideProposal(accepted, "reject", now);
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionHistory).toHaveLength(2);
    expect(rejected.decisionHistory[0]?.status).toBe("accepted");
    expect(rejected.decisionHistory[1]?.status).toBe("rejected");
  });

  it("decide：非法决策值拒绝（400 invalid_decision 语义）", () => {
    const p = createProposal({ ...base, now });
    expect(() => decideProposal(p, "maybe" as "accept", now)).toThrow(InvalidDecisionError);
  });

  it("decide：同决策重复 = no-op（幂等；历史不重复追加）", () => {
    const p = createProposal({ ...base, now });
    const a1 = decideProposal(p, "accept", now);
    const a2 = decideProposal(a1, "accept", now);
    expect(a2.status).toBe("accepted");
    expect(a2.decisionHistory).toHaveLength(1);
  });

  it("OutdatedProposal：accept 时 baseVersionId ≠ 当前版本 → 必须失败（禁止静默应用）", () => {
    const p = createProposal({ ...base, baseVersionId: "v1", now });
    // 当前版本是 v2（期间内容被改）→ base(v1) ≠ current(v2) → 拒绝
    expect(() => assertProposalCurrent(p, "v2")).toThrow(OutdatedProposalError);
  });

  it("OutdatedProposal：base 与当前一致 → 通过", () => {
    const p = createProposal({ ...base, baseVersionId: "v1", now });
    expect(() => assertProposalCurrent(p, "v1")).not.toThrow();
  });
});
