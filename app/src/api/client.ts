// app/src/api/client.ts — Capability HTTP 客户端（S1：projects 面；随 Slice 扩展）
// Progressive Swap：替换 Mock 引擎的 create/open/archive 路径（ISSUE-001 §5）

export class ApiError extends Error {
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
  getProject: (id: string) => request<ProjectDto>(`/api/v1/projects/${id}`),
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
  listArtifacts: (projectId: string) => request<ArtifactDto[]>(`/api/v1/projects/${projectId}/artifacts`),
  commitVersion: (artifactId: string, content: string) =>
    request<ArtifactVersionDto>(`/api/v1/artifacts/${artifactId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  listVersions: (artifactId: string) => request<ArtifactVersionDto[]>(`/api/v1/artifacts/${artifactId}/versions`),
  getVersion: (versionId: string) =>
    request<{ version: ArtifactVersionDto; content: string | null }>(`/api/v1/versions/${versionId}`),
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
  // ---------- S3B Proposals ----------
  listProposals: (projectId: string) => request<ProposalDto[]>(`/api/v1/projects/${projectId}/proposals`),
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
};

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
  error: string | null;
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
