// domain/models/artifact.ts — Artifact 聚合 + ArtifactVersion 不可变版本（domain-contract；I-2/I-11）
// I-2：版本不可变（内容只增不改）——创建后 contentRef/contentHash 禁改（冻结）。
// I-11：手动编辑免 Proposal（应用层强制，本文件提供 source_kind='manual' 语义）。
import type { ArtifactDto, ArtifactKind, ArtifactVersionDto } from "@/src/shared-contracts/types";
import { randomUUID } from "node:crypto";

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "requirements",
  "hardware",
  "pinmap",
  "wiring",
  "firmware",
];

export class InvalidArtifactKindError extends Error {
  constructor(kind: string) {
    super(`Invalid artifact kind: ${kind}`);
    this.name = "InvalidArtifactKindError";
  }
}

export class InvalidVersionNoError extends Error {
  constructor() {
    super("versionNo must be a positive integer");
    this.name = "InvalidVersionNoError";
  }
}

export class InvalidVersionStatusError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal version status transition: ${from} → ${to}`);
    this.name = "InvalidVersionStatusError";
  }
}

export type Artifact = ArtifactDto;
export type ArtifactVersion = ArtifactVersionDto;

/** 合法状态迁移（draft→accepted；其余 Slice 按需扩展） */
const LEGAL_TRANSITIONS: Record<ArtifactVersionDto["status"], readonly ArtifactVersionDto["status"][]> = {
  draft: ["accepted"],
  accepted: [],
};

export function createArtifact(input: {
  projectId: string;
  kind: ArtifactKind;
  now?: () => Date;
}): Artifact {
  if (!ARTIFACT_KINDS.includes(input.kind)) throw new InvalidArtifactKindError(input.kind);
  return {
    id: randomUUID(),
    projectId: input.projectId,
    kind: input.kind,
    currentVersionId: null,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

export function createArtifactVersion(input: {
  artifactId: string;
  versionNo: number;
  contentRef: string;
  contentHash: string;
  status: ArtifactVersionDto["status"];
  sourceKind: ArtifactVersionDto["sourceKind"];
  sourceProposalId: string | null;
  createdBy: string;
  now?: () => Date;
}): ArtifactVersion {
  if (!Number.isInteger(input.versionNo) || input.versionNo < 1) throw new InvalidVersionNoError();
  if (input.status !== "draft" && input.status !== "accepted") throw new InvalidVersionStatusError("?", input.status);
  // 不可变：冻结整个对象（I-2；内容字段创建后禁改）
  return Object.freeze({
    id: randomUUID(),
    artifactId: input.artifactId,
    versionNo: input.versionNo,
    contentRef: input.contentRef,
    contentHash: input.contentHash,
    status: input.status,
    sourceKind: input.sourceKind,
    sourceProposalId: input.sourceProposalId,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    createdBy: input.createdBy,
  });
}

/** 状态迁移返回新对象（原对象保持冻结不可变；返回对象同样冻结） */
export function transitionVersionStatus(v: ArtifactVersion, to: ArtifactVersionDto["status"]): ArtifactVersion {
  const allowed = LEGAL_TRANSITIONS[v.status] ?? [];
  if (!allowed.includes(to)) throw new InvalidVersionStatusError(v.status, to);
  return Object.freeze({ ...v, status: to });
}
