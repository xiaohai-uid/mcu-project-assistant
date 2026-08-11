// adapters/http/app.ts — HTTP surface（S1 projects + S2 artifacts/versions + S3A commands/SSE）
// /commands 是 HTTP 收口；Application 内部调用明确函数（analyzeRequirement()…），禁止 CommandBus/Registry 框架。
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
import {
  AnalysisNotFoundError,
  analyzeRequirement as analyzeRequirementCapability,
  cancelAnalysis as cancelAnalysisCapability,
  getTask as getTaskCapability,
  InvalidDescriptionError,
  InvalidRoundError,
  NotAwaitingClarificationError,
  submitClarification as submitClarificationCapability,
} from "@/src/application/capabilities/analysis";
import {
  generatePinMap as generatePinMapCapability,
  NoHardwareSelectedError,
  validateWiring as validateWiringCapability,
  latestValidation as latestValidationCapability,
} from "@/src/application/capabilities/wiring";
import {
  InvalidMcuError,
  ProjectNotFoundError as McuProjectNotFoundError,
  recommendMcu as recommendMcuCapability,
  selectMcu as selectMcuCapability,
} from "@/src/application/capabilities/mcu";
import {
  commitRequirements as commitRequirementsCapability,
  listProposals as listProposalsCapability,
  NoAcceptedProposalsError,
  OutdatedProposalError,
  ProposalNotFoundError,
  resolveProposal as resolveProposalCapability,
} from "@/src/application/capabilities/proposals";
import {
  activeStaleMarks as activeStaleMarksCapability,
  BlockingStaleError,
  NoStaleError,
  revalidateScope as revalidateScopeCapability,
} from "@/src/application/capabilities/revalidate";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";
import type { ArtifactKind, ArtifactVersionDto } from "@/src/shared-contracts/types";
import { ApiError, withErrorHandler } from "./error";
import { writeProjectMirror } from "@/src/infrastructure/workspace";

export interface AppDeps {
  persistence: PersistencePort;
  workspaceDir: string;
  content: ArtifactContentPort;
  events: EventPort;
  tasks: TaskExecutionPort;
  ai: AIProviderPort;
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
  const analysisDeps = {
    persistence: deps.persistence,
    tasks: deps.tasks,
    ai: deps.ai,
    events: deps.events,
    now,
  };
  const proposalDeps = { persistence: deps.persistence, content: deps.content, events: deps.events, now };

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

  // ---------- S3A Commands / Tasks / SSE ----------

  const handleCommands = async (req: Request, res: Response) => {
    const { capability, payload } = req.body ?? {};
    const projectId = req.params.projectId as string;
    const project = await getProjectCapability({ id: projectId }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");

    if (capability === "analyze_requirement") {
      const description = typeof payload?.description === "string" ? payload.description : "";
      try {
        const { taskId } = await analyzeRequirementCapability(
          { projectId, description, lab: payload?.lab, now },
          analysisDeps,
        );
        res.status(202).json({ taskId });
      } catch (err) {
        if (err instanceof InvalidDescriptionError) throw new ApiError(400, "invalid_description", err.message);
        if (err instanceof AnalysisNotFoundError) throw new ApiError(404, "not_found", err.message);
        if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
        if (err instanceof ProviderUnavailableError) throw new ApiError(503, "provider_unavailable", err.message);
        throw err;
      }
      return;
    }

    if (capability === "recommend_mcu") {
      try {
        const result = await recommendMcuCapability({ projectId }, { persistence: deps.persistence, content: deps.content });
        res.json(result); // 纯 knowledge 求值（同步；无长任务）
      } catch (err) {
        if (err instanceof McuProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
        throw err;
      }
      return;
    }

    if (capability === "generate_pin_map") {
      try {
        const result = await generatePinMapCapability({ projectId }, proposalDeps);
        res.json(result); // 纯知识求值（同步）
      } catch (err) {
        if (err instanceof NoHardwareSelectedError) throw new ApiError(409, "no_hardware_selected", err.message);
        if (err instanceof McuProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
        throw err;
      }
      return;
    }

    if (capability === "select_mcu") {
      const mcuId = typeof payload?.mcuId === "string" ? payload.mcuId : "";
      try {
        const result = await selectMcuCapability({ projectId, mcuId }, proposalDeps);
        res.json(result);
      } catch (err) {
        if (err instanceof McuProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
        if (err instanceof InvalidMcuError) throw new ApiError(400, "invalid_mcu", err.message);
        if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
        throw err;
      }
      return;
    }

    if (capability === "revalidate_artifact") {
      const kind = typeof payload?.kind === "string" && payload.kind ? payload.kind : undefined;
      try {
        // kind 缺省 → 全部（contract 2.14 stale 范围 or all）；逐项结果（validated/proposal_created/error）
        const results = await revalidateScopeCapability({ projectId, kind }, proposalDeps);
        res.json({ results });
      } catch (err) {
        if (err instanceof NoStaleError) throw new ApiError(409, "no_stale", err.message);
        if (err instanceof BlockingStaleError) throw new ApiError(409, "blocking_stale", err.message);
        if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
        throw err;
      }
      return;
    }

    throw new ApiError(400, "invalid_capability", "Unknown capability");
  };

  const handleClarification = async (req: Request, res: Response) => {
    const { roundId, answer, skip } = req.body ?? {};
    try {
      const result = await submitClarificationCapability(
        {
          taskId: req.params.taskId as string,
          roundId: typeof roundId === "number" ? roundId : Number(roundId),
          answer: typeof answer === "string" ? answer : undefined,
          skip: skip === true,
        },
        analysisDeps,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AnalysisNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof InvalidRoundError) throw new ApiError(409, "invalid_round", err.message);
      if (err instanceof NotAwaitingClarificationError)
        throw new ApiError(409, "invalid_analysis_state", err.message);
      throw err;
    }
  };

  const handleCancel = async (req: Request, res: Response) => {
    const ok = await cancelAnalysisCapability({ taskId: req.params.taskId as string }, analysisDeps);
    if (!ok) throw new ApiError(409, "invalid_analysis_state", "Task is not cancellable (not running)");
    res.status(202).json({ taskId: req.params.taskId, status: "cancelled" });
  };

  const handleGetTask = async (req: Request, res: Response) => {
    const task = await getTaskCapability({ taskId: req.params.taskId as string }, analysisDeps);
    if (!task) throw new ApiError(404, "not_found", "Task not found");
    res.json(task);
  };

  const handleEvents = (req: Request, res: Response) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    // SseEvents 订阅（SSE 专属能力；EventPort 基接口无 subscribe）
    const sse = deps.events as import("@/src/adapters/events/sse").SseEvents;
    sse.subscribe(req.params.projectId as string, res);
  };

  // ---------- S3B Proposals ----------

  const handleListProposals = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    res.json(await listProposalsCapability({ projectId: req.params.projectId as string }, capDeps));
  };

  const handleResolveProposal = async (req: Request, res: Response) => {
    const { decision } = req.body ?? {};
    if (decision !== "accept" && decision !== "reject") {
      throw new ApiError(400, "invalid_decision", "decision must be accept|reject");
    }
    try {
      const decided = await resolveProposalCapability(
        { proposalId: req.params.proposalId as string, decision, now },
        proposalDeps,
      );
      res.json(decided);
    } catch (err) {
      if (err instanceof ProposalNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof OutdatedProposalError) {
        throw new ApiError(409, "outdated_proposal", err.message, {
          proposalId: err.proposalId,
          baseVersionId: err.baseVersionId,
          currentVersionId: err.currentVersionId,
        });
      }
      throw err;
    }
  };

  const handleCommitRequirements = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    try {
      const result = await commitRequirementsCapability(
        { projectId: req.params.projectId as string, capabilities: req.body?.capabilities, now },
        proposalDeps,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof NoAcceptedProposalsError) throw new ApiError(409, "no_accepted_proposals", err.message);
      if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
      throw err;
    }
  };

  const handleValidateWiring = async (req: Request, res: Response) => {
    try {
      const record = await validateWiringCapability({ versionId: req.params.versionId as string }, proposalDeps);
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof McuProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof BlockingStaleError) throw new ApiError(409, "blocking_stale", err.message);
      throw err;
    }
  };

  const handleLatestValidation = async (req: Request, res: Response) => {
    const record = await latestValidationCapability({ versionId: req.params.versionId as string }, proposalDeps);
    if (!record) throw new ApiError(404, "not_found", "No validation for this version");
    res.json(record);
  };

  // get_stale_scope（contract 2.19 查询族）：当前活动 StaleMark + 解析后的 artifact kind
  const handleStaleMarks = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    const marks = await activeStaleMarksCapability({ projectId: project.id }, capDeps);
    const enriched = await Promise.all(
      marks.map(async (m) => {
        const artifact = await deps.persistence.getArtifact(m.artifactId);
        return { ...m, kind: artifact?.kind ?? null };
      }),
    );
    res.json({ marks: enriched });
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
  app.post("/api/v1/versions/:versionId/validations", withErrorHandler(handleValidateWiring));
  app.get("/api/v1/versions/:versionId/validations", withErrorHandler(handleLatestValidation));
  app.post("/api/v1/projects/:projectId/commands", withErrorHandler(handleCommands));
  app.get("/api/v1/projects/:projectId/proposals", withErrorHandler(handleListProposals));
  app.post("/api/v1/projects/:projectId/requirements/commit", withErrorHandler(handleCommitRequirements));
  app.post("/api/v1/proposals/:proposalId/decision", withErrorHandler(handleResolveProposal));
  app.post("/api/v1/commands/:taskId/clarification", withErrorHandler(handleClarification));
  app.post("/api/v1/commands/:taskId/cancel", withErrorHandler(handleCancel));
  app.get("/api/v1/commands/:taskId", withErrorHandler(handleGetTask));
  app.get("/api/v1/projects/:projectId/stale-marks", withErrorHandler(handleStaleMarks));
  app.get("/api/v1/projects/:projectId/events", handleEvents);

  return app;
}
