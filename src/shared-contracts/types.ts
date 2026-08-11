// shared-contracts/types.ts — UI ↔ 核心共享类型（单一事实源，ADR-0013）
// S1 仅 Project；随 Slice 增长（禁止提前加入未来类型）

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string; // ISO8601 UTC
  archivedAt: string | null;
  archivedReason: string | null;
}

/** 5 种 Artifact 种类（spec §6；build/validation/debug 不是 Artifact） */
export type ArtifactKind = "requirements" | "hardware" | "pinmap" | "wiring" | "firmware";

export interface ArtifactDto {
  id: string;
  projectId: string;
  kind: ArtifactKind;
  currentVersionId: string | null;
  createdAt: string;
}

export type ArtifactVersionStatus = "draft" | "accepted";
export type ArtifactVersionSource = "manual" | "ai";

export interface ArtifactVersionDto {
  id: string;
  artifactId: string;
  versionNo: number;
  contentRef: string;
  contentHash: string;
  status: ArtifactVersionStatus;
  sourceKind: ArtifactVersionSource;
  sourceProposalId: string | null;
  createdAt: string;
  createdBy: string;
}

// ---------- S3A Analysis / Tasks ----------

export type TaskStatusDto = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskDto {
  id: string;
  capability: string;
  input: string;
  status: TaskStatusDto;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

/** 需求分析能力卡（logical-events：analysis.completed 载荷） */
export interface AnalysisCapabilityDto {
  id: string;
  title: string;
  type: string;
  status: "complete" | "partial" | "pending";
  details: string;
  /** UI 呈现（冻结 UI 能力卡形状） */
  progress: number;
  icon: string;
  isWarning?: boolean;
}

/** 需求分析结构化输出 schema（AIProviderPort.generateStructured schema="requirement-analysis"） */
export interface RequirementAnalysisOutput {
  capabilities: AnalysisCapabilityDto[];
  clarification: { question: string; detail?: string } | null;
}
