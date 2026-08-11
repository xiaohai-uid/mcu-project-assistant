// adapters/http/app.ts — HTTP surface（S1 projects + S2 artifacts/versions；ISSUE-001/002）
// /commands 未来 Slice 才引入；禁止现在建 Command 框架。
import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import {
  AlreadyArchivedError,
  ArchivedProjectError,
  InvalidProjectNameError,
  type Project,
} from "@/src/domain/models/project";
import {
  archiveProject as archiveProjectCapability,
  createProject as createProjectCapability,
  getProject as getProjectCapability,
  listProjects as listProjectsCapability,
} from "@/src/application/capabilities/projects";
import {
  ARTIFACT_KINDS,
  ArtifactNotFoundError,
  commitManualEdit as commitManualEditCapability,
  ensureArtifact as ensureArtifactCapability,
  getArtifact as getArtifactCapability,
  getVersion as getVersionCapability,
  InvalidContentError,
  listArtifacts as listArtifactsCapability,
  listVersions as listVersionsCapability,
} from "@/src/application/capabilities/artifacts";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { ArtifactKind, ArtifactVersionDto } from "@/src/shared-contracts/types";
import { ApiError, withErrorHandler } from "./error";
import { writeProjectMirror } from "@/src/infrastructure/workspace";

export interface AppDeps {
  persistence: PersistencePort;
  workspaceDir: string;
  content: ArtifactContentPort;
  events: EventPort;
  now?: () => Date;
}

interface ArchiveTokenEntry {
  projectId: string;
  token: string;
  expiresAt: number;
  used: boolean;
}

const ARCHIVE_TOKEN_TTL_MS = 60_000;

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  const capDeps = { persistence: deps.persistence };
  const artifactDeps = { persistence: deps.persistence, content: deps.content, events: deps.events };
  const now = deps.now ?? (() => new Date());

  // Idempotency-Key：内存映射（transport 层；重启即失，S1 记录在案——持久化幂等存储随需要引入）
  const idempotency = new Map<string, { project?: Project; version?: ArtifactVersionDto }>();
  const archiveTokens = new Map<string, ArchiveTokenEntry>();

  const handleCreate = async (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const key = req.header("Idempotency-Key");
    if (key && idempotency.has(key)) {
      res.status(201).json(idempotency.get(key)!.project);
      return;
    }
    try {
      const project = await createProjectCapability({ name, now }, capDeps);
      writeProjectMirror(deps.workspaceDir, project); // best-effort 镜像（DB 为真相源）
      if (key) idempotency.set(key, { project });
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof InvalidProjectNameError) throw new ApiError(400, "invalid_name", err.message);
      throw err;
    }
  };

  const handleList = async (_req: Request, res: Response) => {
    res.json(await listProjectsCapability(capDeps));
  };

  const handleGet = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.id as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    res.json(project);
  };

  const handleArchiveToken = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.id as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    if (project.archivedAt !== null) throw new ApiError(409, "already_archived", "Project is already archived");
    const token = randomUUID();
    archiveTokens.set(token, {
      projectId: project.id,
      token,
      expiresAt: now().getTime() + ARCHIVE_TOKEN_TTL_MS,
      used: false,
    });
    res.json({ token, expiresAt: new Date(now().getTime() + ARCHIVE_TOKEN_TTL_MS).toISOString(), impact: { projects: 1 } });
  };

  const handleArchive = async (req: Request, res: Response) => {
    const { confirmationToken } = req.body ?? {};
    if (typeof confirmationToken !== "string" || confirmationToken.length === 0) {
      throw new ApiError(403, "confirmation_missing", "confirmationToken is required");
    }
    const entry = archiveTokens.get(confirmationToken);
    if (!entry || entry.used || entry.projectId !== req.params.id) {
      throw new ApiError(403, "confirmation_invalid", "Invalid or expired confirmation token");
    }
    if (entry.expiresAt < now().getTime()) {
      archiveTokens.delete(confirmationToken);
      throw new ApiError(403, "confirmation_invalid", "Confirmation token expired");
    }
    entry.used = true; // 一次性
    try {
      const archived = await archiveProjectCapability({ id: req.params.id, reason: "user request", now }, capDeps);
      if (!archived) throw new ApiError(404, "not_found", "Project not found");
      res.json(archived);
    } catch (err) {
      if (err instanceof AlreadyArchivedError) throw new ApiError(409, "already_archived", err.message);
      if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
      throw err;
    }
  };

  // ---------- S2 Artifacts / Versions ----------

  const handleEnsureArtifact = async (req: Request, res: Response) => {
    const { kind } = req.body ?? {};
    if (typeof kind !== "string" || !ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
      throw new ApiError(400, "invalid_kind", "kind must be one of: requirements, hardware, pinmap, wiring, firmware");
    }
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    const artifact = await ensureArtifactCapability(
      { projectId: req.params.projectId as string, kind: kind as ArtifactKind },
      capDeps,
    );
    if (!artifact) throw new ApiError(404, "not_found", "Project not found");
    res.status(201).json(artifact);
  };

  const handleListArtifacts = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    res.json(await listArtifactsCapability({ projectId: req.params.projectId as string }, capDeps));
  };

  const handleCommitVersion = async (req: Request, res: Response) => {
    const key = req.header("Idempotency-Key");
    if (key && idempotency.has(key)) {
      res.status(201).json(idempotency.get(key)!.version);
      return;
    }
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    try {
      const version = await commitManualEditCapability(
        { artifactId: req.params.artifactId as string, content, now },
        artifactDeps,
      );
      if (key) idempotency.set(key, { version });
      res.status(201).json(version);
    } catch (err) {
      if (err instanceof ArtifactNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof InvalidContentError) throw new ApiError(400, "invalid_content", err.message);
      if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
      throw err;
    }
  };

  const handleListVersions = async (req: Request, res: Response) => {
    const artifact = await getArtifactCapability({ artifactId: req.params.artifactId as string }, capDeps);
    if (!artifact) throw new ApiError(404, "not_found", "Artifact not found");
    res.json(await listVersionsCapability({ artifactId: req.params.artifactId as string }, capDeps));
  };

  const handleGetVersion = async (req: Request, res: Response) => {
    const version = await getVersionCapability({ versionId: req.params.versionId as string }, capDeps);
    if (!version) throw new ApiError(404, "not_found", "Version not found");
    const content = await deps.content.load(version.contentRef).catch(() => null);
    res.json({ version, content });
  };

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/v1/projects", withErrorHandler(handleCreate));
  app.get("/api/v1/projects", withErrorHandler(handleList));
  app.get("/api/v1/projects/:id", withErrorHandler(handleGet));
  app.post("/api/v1/projects/:id/archive-token", withErrorHandler(handleArchiveToken));
  app.post("/api/v1/projects/:id/archive", withErrorHandler(handleArchive));
  app.get("/api/v1/projects/:projectId/artifacts", withErrorHandler(handleListArtifacts));
  app.post("/api/v1/projects/:projectId/artifacts", withErrorHandler(handleEnsureArtifact));
  app.post("/api/v1/artifacts/:artifactId/versions", withErrorHandler(handleCommitVersion));
  app.get("/api/v1/artifacts/:artifactId/versions", withErrorHandler(handleListVersions));
  app.get("/api/v1/versions/:versionId", withErrorHandler(handleGetVersion));

  return app;
}
