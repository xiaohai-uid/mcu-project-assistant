// application/capabilities/artifacts.ts — Artifact 能力（application-contract 2.1b；ISSUE-002 §3/§6）
// ensure_artifact：聚合容器懒创建（UNIQUE(project_id,kind) 幂等）
// commit_manual_edit：手动编辑免 Proposal 直接产生新版本（I-11）；事务 T1：写内容→插版本→更新 current→发事件
// 本票不实现 Stale 求值（S5B）；依赖求值只留事件 seam（artifact.version.created）。
import { assertNotArchived } from "@/src/domain/models/project";
import {
  createArtifact as domainCreateArtifact,
  createArtifactVersion,
  ARTIFACT_KINDS,
  type Artifact,
  type ArtifactVersion,
} from "@/src/domain/models/artifact";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { ArtifactKind } from "@/src/shared-contracts/types";

export class ArtifactNotFoundError extends Error {
  constructor() {
    super("Artifact not found");
    this.name = "ArtifactNotFoundError";
  }
}

export class InvalidContentError extends Error {
  constructor() {
    super("Content must be a non-empty string");
    this.name = "InvalidContentError";
  }
}

export interface ArtifactCapabilityDeps {
  persistence: PersistencePort;
  content: ArtifactContentPort;
  events: EventPort;
}

const OWNER = "owner"; // M1 本地单用户；项目所有者人工通道（application-contract 2.1b Authorization Boundary）
const MAX_CONTENT_BYTES = 1024 * 1024;

export async function ensureArtifact(
  input: { projectId: string; kind: ArtifactKind },
  deps: { persistence: PersistencePort },
): Promise<Artifact | null> {
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) return null;
  assertNotArchived(project); // 归档只读（I-10）
  const existing = await deps.persistence.getArtifactByKind(input.projectId, input.kind);
  if (existing) return existing;
  const artifact = domainCreateArtifact({ projectId: input.projectId, kind: input.kind });
  await deps.persistence.withTransaction((uow) => uow.createArtifact(artifact));
  return artifact;
}

export async function commitManualEdit(
  input: { artifactId: string; content: string; now?: () => Date },
  deps: ArtifactCapabilityDeps,
): Promise<ArtifactVersion> {
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    throw new InvalidContentError();
  }
  if (Buffer.byteLength(input.content, "utf8") > MAX_CONTENT_BYTES) {
    throw new InvalidContentError();
  }
  const artifact = await deps.persistence.getArtifact(input.artifactId);
  if (!artifact) throw new ArtifactNotFoundError();
  const project = await deps.persistence.getProject(artifact.projectId);
  if (!project) throw new ArtifactNotFoundError();
  assertNotArchived(project); // 归档项目只读（I-10）

  const content = input.content; // 内容按提交原样存储（版本不可变，不 trim 改写）

  // versionNo 在事务外计算（max+1），由 UNIQUE(artifact_id, version_no) 兜底；
  // 并发同号提交 → 重算重试（单用户本地 app，冲突窗口极小，重试有界）
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const versions = await deps.persistence.listVersions(artifact.id);
    const versionNo = versions.reduce((max, v) => Math.max(max, v.versionNo), 0) + 1;
    const { contentRef, contentHash } = await deps.content.store(
      { projectId: artifact.projectId, kind: artifact.kind, versionNo },
      content,
    );
    const version = createArtifactVersion({
      artifactId: artifact.id,
      versionNo,
      contentRef,
      contentHash,
      status: "accepted", // 手动路径直接 accepted（I-11 免 Proposal）
      sourceKind: "manual",
      sourceProposalId: null,
      createdBy: OWNER,
      now: input.now,
    });

    try {
      await deps.persistence.withTransaction((uow) => {
        uow.createVersion(version);
        uow.setCurrentVersion(artifact.id, version.id);
      });
    } catch (err) {
      const isVersionNoCollision =
        err instanceof Error && /UNIQUE.*version_no|version_no.*UNIQUE/i.test(err.message);
      if (!isVersionNoCollision || attempt === MAX_ATTEMPTS - 1) throw err;
      continue; // 冲突 → 重算 versionNo 重试
    }

    deps.events.publish({
      type: "artifact.version.created",
      projectId: artifact.projectId,
      artifactId: artifact.id,
      versionId: version.id,
      kind: artifact.kind,
      versionNo: version.versionNo,
      createdAt: version.createdAt,
    });

    return version;
  }
  throw new Error("commit_manual_edit: too many version collisions");
}

export async function listArtifacts(
  input: { projectId: string },
  deps: { persistence: PersistencePort },
): Promise<Artifact[]> {
  return deps.persistence.listArtifacts(input.projectId);
}

export async function listVersions(
  input: { artifactId: string },
  deps: { persistence: PersistencePort },
): Promise<ArtifactVersion[]> {
  return deps.persistence.listVersions(input.artifactId);
}

export async function getVersion(
  input: { versionId: string },
  deps: { persistence: PersistencePort },
): Promise<ArtifactVersion | null> {
  return deps.persistence.getVersion(input.versionId);
}

export async function getArtifact(
  input: { artifactId: string },
  deps: { persistence: PersistencePort },
): Promise<Artifact | null> {
  return deps.persistence.getArtifact(input.artifactId);
}

export { ARTIFACT_KINDS };
