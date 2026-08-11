// ports/artifact-content.ts — ArtifactContentPort（ADR-0006；ISSUE-002 §9）
// store(versionRef, content) → contentRef；load(contentRef) → content；hash(content) → digest。
// Local Adapter = Workspace Files（人读、Git-friendly）；Cloud Adapter = Object/Blob Storage（未来）。
// 版本行只引用 contentRef；内容本体永不进 SQLite。
import type { ArtifactKind } from "@/src/shared-contracts/types";

export interface VersionRef {
  projectId: string;
  kind: ArtifactKind;
  versionNo: number;
}

export interface StoredContent {
  contentRef: string;
  contentHash: string;
}

export interface ArtifactContentPort {
  store(ref: VersionRef, content: string): Promise<StoredContent>;
  load(contentRef: string): Promise<string>;
  hash(content: string): Promise<string>;
}
