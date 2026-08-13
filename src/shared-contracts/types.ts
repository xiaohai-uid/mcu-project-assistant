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
export type ArtifactVersionSource = "manual" | "ai" | "proposal";

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

export interface TaskErrorDto {
  code: string;
  message: string;
}

export interface TaskDto {
  id: string;
  capability: string;
  input: string;
  status: TaskStatusDto;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: TaskErrorDto | null;
  /** 任务结果（如分析输出 capabilities） */
  output: string | null;
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
  /** 形式化提案（S3B：create_proposal 的输入来源） */
  proposals: AnalysisProposalDto[];
}

export interface ValidationRecordDto {
  id: string;
  artifactVersionId: string;
  kind: string;
  rules: string[];
  result: "pass" | "warn" | "fail";
  diagnostics: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  startedAt: string;
  completedAt: string | null;
}

// ---------- S9 Device truth boundary ----------

export type DeviceExecutionReality = "simulation" | "companion" | "physical";
export type DeviceVerification = "verified" | "blocked" | "failed";

/**
 * Evidence about where a device operation actually ran.  `physicalVerified`
 * is deliberately separate from operation verification: a companion-local
 * operation may be verified as a deterministic companion operation without
 * proving that physical hardware was touched.
 */
export interface DeviceTruthDto {
  executionReality: DeviceExecutionReality;
  verification: DeviceVerification;
  physicalVerified: boolean;
  adapter: string;
}

export interface DeviceInfoDto {
  id: string;
  model: string;
  port: string;
  baudRate: number;
  truth: DeviceTruthDto;
  protocol?: string;
  fqbn?: string;
  vid?: string;
  pid?: string;
  serialNumber?: string;
}

export interface FlashResultDto {
  exitCode: number;
  sessionId: string;
  truth: DeviceTruthDto;
  buildId?: string;
  artifactVersionId?: string;
  firmwareSha256?: string;
  port?: string;
  fqbn?: string;
  adapter?: string;
  toolchain?: string;
  toolchainVersion?: string | null;
  errorCode?: string;
}

export interface SerialResultDto {
  /** null means the bytes were accepted by a physical transport but no response protocol exists. */
  response: string | null;
  truth: DeviceTruthDto;
}

export interface SerialSessionDto {
  sessionId: string;
  projectId: string;
  deviceId: string;
  executionReality: DeviceExecutionReality;
  port: string;
  baudRate: number;
  adapter: string;
  openedAt: string;
  status: "connected" | "error" | "closed";
}

export interface SerialLineEventDto {
  sessionId: string;
  projectId: string;
  deviceId: string;
  executionReality: DeviceExecutionReality;
  timestamp: string;
  line: string;
}

// ---------- S7 Build ----------

export type BuildStatusDto = "running" | "succeeded" | "failed" | "cancelled";

export interface BuildOutputEvidenceDto {
  path: string;
  kind: "bin" | "elf" | "hex";
  sizeBytes: number;
  sha256: string;
}

/** BuildRecord（D2：Build 证据独立于版本；同版本可多次构建；Build 不产生 Firmware 版本） */
export interface BuildRecordDto {
  id: string;
  artifactVersionId: string;
  taskId: string | null;
  target: string;
  toolchain: string;
  toolchainVersion: string | null;
  options: Record<string, unknown>;
  status: BuildStatusDto;
  startedAt: string;
  completedAt: string | null;
  stdoutRef: string | null; // workspace .build/<buildId>.log（大体积证据；DB 只存 ref）
  stderrRef: string | null;
  exitCode: number | null;
  diagnostics: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  /** Phase 11: absent on legacy rows; present on newly executed builds. */
  sourceDir: string | null;
  outputDir: string | null;
  command: string[];
  outputs: BuildOutputEvidenceDto[];
}

export type StaleLevel = "L1" | "L2" | "L3";

export interface StaleMarkDto {
  id: string;
  projectId: string;
  artifactId: string;
  affectedVersionId: string | null;
  level: StaleLevel;
  reason: string;
  sourceVersionId: string | null;
  triggeredBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export type ProposalType = "requirement" | "firmware" | "dependency";
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface ProposalDto {
  id: string;
  projectId: string;
  artifactId: string;
  baseVersionId: string | null;
  type: ProposalType;
  /** formalized 内容（JSON 文本） */
  payload: string;
  diff: Record<string, unknown> | null;
  impacts: string[];
  reason: string | null;
  status: ProposalStatus;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  /** 决策历史（可逆且保留，审计） */
  decisionHistory: Array<{ status: ProposalStatus; at: string }>;
  /** UI 展示序号（#01…） */
  number: number;
}

/** 分析产出的形式化提案（mock 行为契约源：DISCOVERY_PROPOSALS 形状） */
export interface AnalysisProposalDto {
  title: string;
  initialIdea: string;
  formalizedRequirement: string;
  impacts: string[];
  isNew?: boolean;
}
