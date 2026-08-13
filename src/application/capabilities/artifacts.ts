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
import { computeDownstreamMarks } from "@/src/application/capabilities/revalidate";
import type { IdempotencyRequest } from "@/src/shared/idempotency";
import { IdempotencyConflictError } from "@/src/shared/idempotency";
import { isRecord, parseIdempotencyResponse } from "@/src/shared/persistence-integrity";

function isArtifactVersionResponse(value: unknown): value is ArtifactVersion {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.artifactId === "string" && Number.isInteger(value.versionNo) &&
    typeof value.contentRef === "string" && typeof value.contentHash === "string" && typeof value.status === "string" &&
    typeof value.sourceKind === "string" && (value.sourceProposalId === null || typeof value.sourceProposalId === "string") &&
    typeof value.createdAt === "string" && typeof value.createdBy === "string";
}

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

const versionLocks = new Map<string, { requestHash: string; operation: Promise<ArtifactVersion> }>();

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
  input: { artifactId: string; content: string; now?: () => Date; idempotency?: IdempotencyRequest },
  deps: ArtifactCapabilityDeps,
  lockHeld = false,
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

  const lockKey = input.idempotency ? `${input.idempotency.scope}\u0000${input.idempotency.key}` : null;
  if (lockKey && !lockHeld) {
    const active = versionLocks.get(lockKey);
    if (active) {
      if (active.requestHash !== input.idempotency!.requestHash) throw new IdempotencyConflictError();
      return active.operation;
    }
    const operation = commitManualEdit(input, deps, true);
    versionLocks.set(lockKey, { requestHash: input.idempotency!.requestHash, operation });
    try {
      return await operation;
    } finally {
      if (versionLocks.get(lockKey)?.operation === operation) versionLocks.delete(lockKey);
    }
  }

  if (input.idempotency && deps.persistence.getIdempotencyRecord) {
    const existing = await deps.persistence.getIdempotencyRecord(input.idempotency.scope, input.idempotency.key);
    if (existing) {
      if (existing.requestHash !== input.idempotency.requestHash) throw new IdempotencyConflictError();
      return parseIdempotencyResponse(existing.responseBodyJson, isArtifactVersionResponse);
    }
  }

  const content = input.content; // 内容按提交原样存储（版本不可变，不 trim 改写）

  // versionNo 在事务外计算（max+1），由 UNIQUE(artifact_id, version_no) 兜底；
  // 并发同号提交 → 重算重试（单用户本地 app，冲突窗口极小，重试有界）
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const versions = await deps.persistence.listVersions(artifact.id);
    const versionNo = versions.reduce((max, v) => Math.max(max, v.versionNo), 0) + 1;
    const stored = artifact.kind === "firmware"
      ? await (async () => {
          let files: Record<string, unknown> | null = null;
          try { files = JSON.parse(content) as Record<string, unknown>; } catch { /* legacy/free-form content */ }
          const main = files?.["src/main.cpp"];
          const platformio = files?.["platformio.ini"];
          if (typeof main !== "string" || typeof platformio !== "string") {
            return deps.content.store({ projectId: artifact.projectId, kind: artifact.kind, versionNo }, content);
          }
          const mainStore = await deps.content.store(
            { projectId: artifact.projectId, kind: artifact.kind, versionNo, subpath: "src/main.cpp" },
            main,
          );
          await deps.content.store(
            { projectId: artifact.projectId, kind: artifact.kind, versionNo, subpath: "platformio.ini" },
            platformio,
          );
          return mainStore;
        })()
      : await deps.content.store({ projectId: artifact.projectId, kind: artifact.kind, versionNo }, content);
    const { contentRef, contentHash } = stored;
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

    // S5B：手动编辑仍触发依赖求值（D4——stale-semantics §6.2）；只读计算，随版本提交同事务写 marks（T1/T2 同事务）
    const prevVersion = versions[versions.length - 1] ?? null;
    const prevContent =
      prevVersion && versionNo > 1 ? await deps.content.load(prevVersion.contentRef).catch(() => "") : "";
    const downstreamMarks =
      versionNo > 1
        ? await computeDownstreamMarks(
            {
              projectId: artifact.projectId,
              kind: artifact.kind,
              fromContent: prevContent,
              toContent: content,
              sourceVersionId: version.id,
              triggeredBy: "commit_manual_edit",
              now: input.now,
            },
            deps,
          )
        : [];

    try {
      const committed = await deps.persistence.withTransaction((uow) => {
        if (input.idempotency) {
          if (!uow.claimIdempotency) throw new Error("Durable idempotency is unavailable");
          const claim = uow.claimIdempotency(input.idempotency, 201, JSON.stringify(version));
          if (claim.kind === "conflict") throw new IdempotencyConflictError();
          if (claim.kind === "replay") return parseIdempotencyResponse(claim.record.responseBodyJson, isArtifactVersionResponse);
        }
        uow.createVersion(version);
        uow.setCurrentVersion(artifact.id, version.id);
        if (downstreamMarks.length) uow.saveStaleMarks(downstreamMarks);
        return version;
      });
      if (committed.id !== version.id) return committed;
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
