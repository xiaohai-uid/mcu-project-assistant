// app/src/api/client.ts — Capability HTTP 客户端（S1：projects 面；随 Slice 扩展）
// Progressive Swap：替换 Mock 引擎的 create/open/archive 路径（ISSUE-001 §5）
import type { BuildOutputEvidenceDto, CommercialReadinessReportDto, DeviceInfoDto, FlashResultDto, PhysicalAcceptanceRecordDto, SerialResultDto, SerialSessionDto, TaskErrorDto } from "@/src/shared-contracts/types";
import type { ReferenceKitDefinition } from "@/src/domain/knowledge/platforms";

export interface AppError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export class ApiError extends Error implements AppError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toAppError(value: unknown, fallback = "Internal server error"): AppError {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && typeof record.message === "string") {
      return { code: record.code, message: record.message, ...(typeof record.status === "number" ? { status: record.status } : {}), ...(record.details !== undefined ? { details: record.details } : {}) };
    }
  }
  return { code: "internal", message: fallback };
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "network_unavailable", "Cannot reach the local workspace server");
  }
  const body = (await res.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error?.code ?? "unknown",
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.details,
    );
  }
  return body;
}

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string;
  archivedAt: string | null;
  archivedReason: string | null;
}

export type ArtifactKindDto = "requirements" | "hardware" | "pinmap" | "wiring" | "firmware";

export interface ArtifactDto {
  id: string;
  projectId: string;
  kind: ArtifactKindDto;
  currentVersionId: string | null;
  createdAt: string;
}

export interface ArtifactVersionDto {
  id: string;
  artifactId: string;
  versionNo: number;
  contentRef: string;
  contentHash: string;
  status: "draft" | "accepted";
  sourceKind: "manual" | "ai";
  sourceProposalId: string | null;
  createdAt: string;
  createdBy: string;
}

export const api = {
  createProject: (name: string) =>
    request<ProjectDto>("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  listProjects: () => request<ProjectDto[]>("/api/v1/projects"),
  getProject: (id: string, signal?: AbortSignal) => request<ProjectDto>(`/api/v1/projects/${id}`, { signal }),
  archiveToken: (id: string) =>
    request<{ token: string; expiresAt: string; impact: { projects: number } }>(
      `/api/v1/projects/${id}/archive-token`,
      { method: "POST" },
    ),
  archiveProject: (id: string, confirmationToken: string) =>
    request<ProjectDto>(`/api/v1/projects/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationToken }),
    }),
  // ---------- S2 Artifacts / Versions ----------
  ensureArtifact: (projectId: string, kind: ArtifactKindDto) =>
    request<ArtifactDto>(`/api/v1/projects/${projectId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    }),
  listArtifacts: (projectId: string, signal?: AbortSignal) => request<ArtifactDto[]>(`/api/v1/projects/${projectId}/artifacts`, { signal }),
  commitVersion: (artifactId: string, content: string) =>
    request<ArtifactVersionDto>(`/api/v1/artifacts/${artifactId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  listVersions: (artifactId: string, signal?: AbortSignal) => request<ArtifactVersionDto[]>(`/api/v1/artifacts/${artifactId}/versions`, { signal }),
  getVersion: (versionId: string, signal?: AbortSignal) =>
    request<{ version: ArtifactVersionDto; content: string | null }>(`/api/v1/versions/${versionId}`, { signal }),
  // ---------- S3A Commands / Tasks ----------
  analyzeRequirement: (projectId: string, description: string, lab?: Record<string, unknown>) =>
    request<{ taskId: string }>(`/api/v1/projects/${projectId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "analyze_requirement", payload: { description, lab } }),
    }),
  submitClarification: (taskId: string, roundId: number, answer?: string, skip?: boolean) =>
    request<{ roundId: number }>(`/api/v1/commands/${taskId}/clarification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId, answer, skip }),
    }),
  cancelTask: (taskId: string) =>
    request<{ taskId: string; status: string }>(`/api/v1/commands/${taskId}/cancel`, { method: "POST" }),
  getTask: (taskId: string) => request<TaskDto>(`/api/v1/commands/${taskId}`),
  listTasks: (projectId: string, signal?: AbortSignal) => request<TaskDto[]>(`/api/v1/projects/${projectId}/tasks`, { signal }),
  // ---------- S3B Proposals ----------
  listProposals: (projectId: string, signal?: AbortSignal) => request<ProposalDto[]>(`/api/v1/projects/${projectId}/proposals`, { signal }),
  resolveProposal: (proposalId: string, decision: "accept" | "reject") =>
    request<ProposalDto>(`/api/v1/proposals/${proposalId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }),
  commitRequirements: (projectId: string, capabilities?: Array<{ id: string; title: string; status: string }>) =>
    request<{ artifact: ArtifactDto; version: ArtifactVersionDto }>(
      `/api/v1/projects/${projectId}/requirements/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilities }),
      },
    ),
  // ---------- S4 MCU ----------
  recommendMcu: (projectId: string) =>
    request<{ candidates: McuCandidateDto[]; peripherals: PeripheralDto[] }>(
      `/api/v1/projects/${projectId}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "recommend_mcu", payload: {} }),
      },
    ),
  generatePinMap: (projectId: string) =>
    request<{
      artifact: ArtifactDto;
      version: ArtifactVersionDto;
      pinMap: Array<{ component: string; pinId: string; type: string }>;
      issues: Array<{
        code: string;
        pinId: string;
        severity: "warning" | "error";
        title: string;
        detail: string;
        blocksClaim?: boolean;
        componentId?: string;
        pendingReason?: string;
        source?: { owner: string; url: string; title: string; revision?: string; accessedAt: string; confidence: string };
      }>;
      claimStatus: "ready" | "pending";
    }>(`/api/v1/projects/${projectId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "generate_pin_map", payload: {} }),
    }),
  validateWiring: (versionId: string) =>
    request<{
      id: string;
      artifactVersionId: string;
      kind: string;
      rules: string[];
      result: "pass" | "warn" | "fail";
      diagnostics: Array<{
        code: string;
        severity: string;
        message: string;
        details?: Record<string, unknown>;
        source?: { owner: string; url: string; title: string; revision?: string; accessedAt: string; confidence: string };
      }>;
      startedAt: string;
      completedAt: string | null;
    }>(`/api/v1/versions/${versionId}/validations`, { method: "POST" }),
  selectMcu: (projectId: string, mcuId: string) =>
    request<{ artifact: ArtifactDto; version: ArtifactVersionDto; changed: boolean }>(
      `/api/v1/projects/${projectId}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "select_mcu", payload: { mcuId } }),
      },
    ),
  // ---------- S5B Stale / Revalidate ----------
  getStaleMarks: (projectId: string, signal?: AbortSignal) =>
    request<{ marks: Array<StaleMarkDto & { kind: string | null }> }>(`/api/v1/projects/${projectId}/stale-marks`, { signal }),
  revalidateArtifact: (projectId: string, kind?: string) =>
    request<{
      results: Array<{
        outcome: "validated" | "proposal_created" | "error";
        kind: string;
        proposalId?: string;
        error?: string;
      }>;
    }>(`/api/v1/projects/${projectId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "revalidate_artifact", payload: kind ? { kind } : {} }),
    }),
  // ---------- S6 Firmware Proposal ----------
  generateFirmware: (projectId: string) =>
    request<{ proposal: ProposalDto }>(`/api/v1/projects/${projectId}/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: "generate_firmware", payload: {} }),
    }),
  // ---------- S7 Build ----------
  runBuild: (projectId: string, versionId: string) =>
    request<{ buildId: string }>(`/api/v1/projects/${projectId}/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    }),
  cancelBuild: (buildId: string) =>
    request<{ buildId: string; status: string }>(`/api/v1/builds/${buildId}/cancel`, { method: "POST" }),
  getBuilds: (versionId: string, signal?: AbortSignal) => request<BuildRecordDto[]>(`/api/v1/versions/${versionId}/builds`, { signal }),
  getBuild: (buildId: string) => request<BuildRecordDto>(`/api/v1/builds/${buildId}`),
  getReadinessReport: (projectId: string, signal?: AbortSignal) => request<CommercialReadinessReportDto>(`/api/v1/projects/${projectId}/readiness-report`, { signal }),
  checkToolchain: (signal?: AbortSignal) =>
    request<{ available: boolean; toolchain: string; version: string | null; reason?: string }>("/api/v1/toolchain", { signal }),
  // ---------- S8 Diagnosis ----------
  diagnoseBuild: (buildId: string) =>
    request<{
      diagnosis: {
        title: string;
        cause: string;
        fix: string;
        proposal: { file: string; diff: string; proposalId?: string } | null;
      };
      proposal: ProposalDto;
    }>(`/api/v1/builds/${buildId}/diagnose`, { method: "POST" }),
  // ---------- S9 Device / Flash / Serial ----------
  detectDevice: () => request<DeviceInfoDto>("/api/v1/device/detect", { method: "POST" }),
  getDeviceState: (projectId: string, signal?: AbortSignal) =>
    request<{ lastDevice: DeviceInfoDto | null }>(`/api/v1/projects/${projectId}/device-state`, { signal }),
  getPhysicalAcceptance: (projectId: string, signal?: AbortSignal) => request<{ record: PhysicalAcceptanceRecordDto | null }>(`/api/v1/projects/${projectId}/physical-acceptance`, { signal }),
  recordPhysicalAcceptance: (projectId: string, input: { buildId: string; artifactVersionId: string; serialObservation: string }) =>
    request<PhysicalAcceptanceRecordDto>(`/api/v1/projects/${projectId}/physical-acceptance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  issueFlashToken: (deviceId: string) =>
    request<{ token: string; expiresAt: string }>("/api/v1/device/flash-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId }),
    }),
  flashDevice: (input: { projectId: string; deviceId: string; confirmationToken: string; buildId: string; artifactVersionId: string; executionReality?: "simulation" | "companion" | "physical" }) =>
    request<FlashResultDto>("/api/v1/device/flash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  disconnectDevice: () => request<{ status: string }>("/api/v1/device/disconnect", { method: "POST" }),
  openSerial: (projectId: string, deviceId: string, baudRate?: number) =>
    request<SerialSessionDto>(`/api/v1/projects/${projectId}/device/serial/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, ...(baudRate === undefined ? {} : { baudRate }) }),
    }),
  closeSerial: (projectId: string, sessionId: string) =>
    request<{ status: string; sessionId: string }>(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}`, { method: "DELETE" }),
  sendSerial: (projectId: string, sessionId: string, command: string) =>
    request<{ echo: string } & SerialResultDto>(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    }),
};

export interface StaleMarkDto {
  id: string;
  projectId: string;
  artifactId: string;
  affectedVersionId: string | null;
  level: "L1" | "L2" | "L3";
  reason: string;
  sourceVersionId: string | null;
  triggeredBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BuildRecordDto {
  id: string;
  artifactVersionId: string;
  taskId: string | null;
  target: string;
  toolchain: string;
  toolchainVersion: string | null;
  toolchainCoreVersion: string | null;
  toolchainEvidence: "real" | "fixture" | "unknown";
  options: Record<string, unknown>;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  stdoutRef: string | null;
  stderrRef: string | null;
  exitCode: number | null;
  diagnostics: Array<{ code: string; severity: string; message: string; details?: Record<string, unknown> }>;
  sourceDir: string | null;
  outputDir: string | null;
  command: string[];
  outputs: BuildOutputEvidenceDto[];
  readinessStatus: "local-ready" | "blocked";
  readinessReasons: string[];
}

export interface McuCandidateDto {
  id: string;
  displayName: string;
  tier: "recommended" | "alternative" | "industrial";
  core: string;
  wireless: string;
  flashSram: string;
  ioMatrix: string;
  reason: string;
  constraints: string[];
  referenceKit?: ReferenceKitDefinition;
}

export interface PeripheralDto {
  id: string;
  displayName: string;
  interfaceType: string;
  capability: string;
}

export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface ProposalDto {
  id: string;
  projectId: string;
  artifactId: string;
  baseVersionId: string | null;
  type: "requirement" | "firmware" | "dependency";
  payload: string;
  diff: Record<string, unknown> | null;
  impacts: string[];
  reason: string | null;
  status: ProposalStatus;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  decisionHistory: Array<{ status: ProposalStatus; at: string }>;
  number: number;
}

export interface TaskDto {
  id: string;
  capability: string;
  input: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: TaskErrorDto | null;
  output: string | null;
}

/** 需求分析能力卡（与 shared-contracts AnalysisCapabilityDto 同形；SSE 载荷） */
export interface AnalysisCapabilityDto {
  id: string;
  title: string;
  type: string;
  status: "complete" | "partial" | "pending";
  details: string;
  progress: number;
  icon: string;
  isWarning?: boolean;
}
