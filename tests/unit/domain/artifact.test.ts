// unit/domain/artifact — Artifact / ArtifactVersion 不变量（domain-contract I-2/I-11；ISSUE-002 §7/§11）
// I-2：ArtifactVersion 不可变（内容只增不改）；version_no 单调；内容字段创建后禁改。
import { describe, expect, it } from "vitest";
import {
  createArtifact,
  createArtifactVersion,
  InvalidVersionStatusError,
  InvalidVersionNoError,
  transitionVersionStatus,
} from "@/src/domain/models/artifact";

const NOW = "2026-08-11T12:00:00.000Z";

describe("Artifact 聚合", () => {
  it("创建：id/projectId/kind 赋值；currentVersionId 初始 null", () => {
    const a = createArtifact({ projectId: "p1", kind: "pinmap", now: () => new Date(NOW) });
    expect(a.id).toBeTruthy();
    expect(a.projectId).toBe("p1");
    expect(a.kind).toBe("pinmap");
    expect(a.currentVersionId).toBeNull();
    expect(a.createdAt).toBe(NOW);
  });

  it("创建：kind 必须为 5 种 Artifact 之一（build/validation/debug 不是 Artifact）", () => {
    // @ts-expect-error 领域类型层面即拒绝非 Artifact kind（spec §6：5 Artifact 种类）
    expect(() => createArtifact({ projectId: "p1", kind: "build", now: () => new Date(NOW) })).toThrow();
  });
});

describe("ArtifactVersion 不可变（I-2）", () => {
  it("创建：versionNo/contentRef/contentHash/status/sourceKind/sourceProposalId 赋值完整", () => {
    const v = createArtifactVersion({
      artifactId: "a1",
      versionNo: 1,
      contentRef: "pinmap/0001.json",
      contentHash: "abc123",
      status: "accepted",
      sourceKind: "manual",
      sourceProposalId: null,
      now: () => new Date(NOW),
      createdBy: "owner",
    });
    expect(v.versionNo).toBe(1);
    expect(v.contentRef).toBe("pinmap/0001.json");
    expect(v.contentHash).toBe("abc123");
    expect(v.status).toBe("accepted");
    expect(v.sourceKind).toBe("manual");
    expect(v.sourceProposalId).toBeNull();
    expect(v.createdBy).toBe("owner");
    expect(v.createdAt).toBe(NOW);
  });

  it("不可变：contentRef 创建后修改被拒（冻结）", () => {
    const v = createArtifactVersion({
      artifactId: "a1",
      versionNo: 1,
      contentRef: "pinmap/0001.json",
      contentHash: "abc",
      status: "accepted",
      sourceKind: "manual",
      sourceProposalId: null,
      now: () => new Date(NOW),
      createdBy: "owner",
    });
    expect(() => {
      (v as { contentRef: string }).contentRef = "pinmap/9999.json";
    }).toThrow();
    expect(v.contentRef).toBe("pinmap/0001.json");
  });

  it("不可变：contentHash 创建后修改被拒（冻结）", () => {
    const v = createArtifactVersion({
      artifactId: "a1",
      versionNo: 1,
      contentRef: "pinmap/0001.json",
      contentHash: "abc",
      status: "accepted",
      sourceKind: "manual",
      sourceProposalId: null,
      now: () => new Date(NOW),
      createdBy: "owner",
    });
    expect(() => {
      (v as { contentHash: string }).contentHash = "tampered";
    }).toThrow();
    expect(v.contentHash).toBe("abc");
  });

  it("version_no：必须为正整数（0 拒绝；单调由 UNIQUE(artifact_id, version_no) + 应用层 max+1 保证）", () => {
    expect(() =>
      createArtifactVersion({
        artifactId: "a1",
        versionNo: 0,
        contentRef: "pinmap/0001.json",
        contentHash: "abc",
        status: "accepted",
        sourceKind: "manual",
        sourceProposalId: null,
        now: () => new Date(NOW),
        createdBy: "owner",
      }),
    ).toThrow(InvalidVersionNoError);
  });

  it("status：合法值 draft|accepted；其余拒绝", () => {
    expect(() =>
      createArtifactVersion({
        artifactId: "a1",
        versionNo: 1,
        contentRef: "r",
        contentHash: "h",
        // @ts-expect-error 非法状态
        status: "rejected",
        sourceKind: "manual",
        sourceProposalId: null,
        now: () => new Date(NOW),
        createdBy: "owner",
      }),
    ).toThrow(InvalidVersionStatusError);
  });

  it("transition：draft→accepted 合法；accepted→draft 非法", () => {
    const v = createArtifactVersion({
      artifactId: "a1",
      versionNo: 1,
      contentRef: "r",
      contentHash: "h",
      status: "draft",
      sourceKind: "ai",
      sourceProposalId: "pr1",
      now: () => new Date(NOW),
      createdBy: "owner",
    });
    expect(transitionVersionStatus(v, "accepted").status).toBe("accepted");
    expect(() => transitionVersionStatus(v, "draft")).toThrow(InvalidVersionStatusError);
  });
});
