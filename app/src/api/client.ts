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
};
