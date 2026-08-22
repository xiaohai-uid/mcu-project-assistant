// adapters/http/app.ts — HTTP surface（S1 projects + S2 artifacts/versions + S3A commands/SSE）
// /commands 是 HTTP 收口；Application 内部调用明确函数（analyzeRequirement()…），禁止 CommandBus/Registry 框架。
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import express, { type Express, type Request, type Response } from "express";
import {
  AlreadyArchivedError,
  ArchivedProjectError,
  InvalidProjectNameError,
} from "@/src/domain/models/project";
import {
  archiveProject as archiveProjectCapability,
  createProject as createProjectCapability,
  getProject as getProjectCapability,
  listProjects as listProjectsCapability,
} from "@/src/application/capabilities/projects";
import { AI_FORBIDDEN_OPERATIONS, AI_PERMISSION_TABLE, aiPermissionFor } from "@/src/application/ai-permissions";
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
import {
  generateFirmwareProposal as generateFirmwareProposalCapability,
  NoPinMapError,
} from "@/src/application/capabilities/firmware";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { CompilerPort } from "@/src/ports/compiler";
import { ToolchainUnavailableError, UnsupportedBuildTargetError } from "@/src/ports/compiler";
import type { DevicePort, SerialSession } from "@/src/ports/device";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";
import { parseTaskError } from "@/src/ports/task-execution";
import type { InProcessTaskRuntime } from "@/src/adapters/task/in-process";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import type { ArtifactKind, DeviceExecutionReality, SerialSessionDto } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";
import { ApiError, apiErrorBoundary, withErrorHandler } from "./error";
import { loadVerifiedArtifactContent, PersistenceIntegrityError } from "@/src/shared/persistence-integrity";
import { writeProjectMirror } from "@/src/infrastructure/workspace";
import {
  BuildNotCancellableError,
  BuildInputError,
  BuildNotFoundError,
  cancelBuild as cancelBuildCapability,
  getBuildRecord as getBuildRecordCapability,
  listBuilds as listBuildsCapability,
  runBuild as runBuildCapability,
  VersionNotFoundError as BuildVersionNotFoundError,
} from "@/src/application/capabilities/build";
import { getAcceptancePolicyReport, getDeliveryReport, ReadinessProjectNotFoundError } from "@/src/application/capabilities/readiness";
import {
  BuildNotFailedError,
  BuildNotFoundError as DiagnosisBuildNotFoundError,
  diagnoseBuild as diagnoseBuildCapability,
} from "@/src/application/capabilities/diagnosis";
import {
  ConfirmationExpiredError,
  ConfirmationMissingError,
  DeviceDisconnectedError,
  PhysicalFlashBlockedError,
  DeviceMismatchError,
  detectDevice as detectDeviceCapability,
  disconnectDevice as disconnectDeviceCapability,
  FirmwareVersionNotFoundError,
  FlashBuildNotVerifiedError,
  FlashFirmwareMissingError,
  FlashFirmwareHashMismatchError,
  PhysicalDeviceNotFoundError,
  PhysicalDeviceAmbiguousError,
  PhysicalDeviceChangedError,
  flashDevice as flashDeviceCapability,
  issueFlashToken as issueFlashTokenCapability,
  sendSerial as sendSerialCapability,
  TokenReusedError,
} from "@/src/application/capabilities/flash";
import { createFlashTokenStore } from "@/src/application/capabilities/flash";
import {
  latestPhysicalAcceptance as latestPhysicalAcceptanceCapability,
  PhysicalAcceptanceInputError,
  PhysicalAcceptanceProjectNotFoundError,
  recordPhysicalAcceptance,
} from "@/src/application/capabilities/physical-acceptance";
import {
  addPriceObservation,
  BomInputError,
  BomProjectNotFoundError,
  createBomItem,
  exportProjectBom,
  getProjectBom,
} from "@/src/application/capabilities/bom";
import { MAX_HTTP_BODY_BYTES, MAX_SERIAL_WRITE_BYTES, ResourceLimitError, assertUtf8Bytes } from "@/src/shared/resource-limits";
import { createClientRateLimiter, resolveClientAddress } from "@/src/shared/client-rate-limit";
import { SerialWriteTooLargeError } from "@/src/ports/device";
import { createBrowserTrustMiddleware } from "./browser-trust";
import { createBasicAuthMiddleware, createBrowserSessionAuth, hasOperatorBasicCredentials, invalidCredentials, type BasicAuthCredentials } from "./basic-auth";
import type { EventLogPort } from "@/src/adapters/persistence/sqlite/event-log-store";
import { newCorrelationId } from "@/src/adapters/persistence/sqlite/event-log-store";
import type { Logger } from "@/src/infrastructure/logger";
import { IdempotencyConflictError, InvalidIdempotencyKeyError, makeIdempotencyRequest, parseIdempotencyKey } from "@/src/shared/idempotency";
import type { ShutdownState } from "@/src/infrastructure/shutdown";

export interface AppDeps {
  persistence: PersistencePort;
  workspaceDir: string;
  content: ArtifactContentPort;
  events: EventPort;
  tasks: TaskExecutionPort;
  compiler: CompilerPort;
  device: DevicePort;
  ai: AIProviderPort;
  frontendDist?: string;
  now?: () => Date;
  shutdown?: ShutdownState;
  publicMode?: boolean;
  basicAuth?: BasicAuthCredentials | null;
  eventLog?: EventLogPort;
  /** Reverse proxies trusted to append the real client address to X-Forwarded-For. Empty = never honor the header. */
  trustedProxies?: readonly string[];
  logger?: Logger;
}

export interface HttpApp extends Express {
  closeSseStreams(): void;
}

interface ArchiveTokenEntry {
  projectId: string;
  token: string;
  expiresAt: number;
  used: boolean;
}

const ARCHIVE_TOKEN_TTL_MS = 60_000;

export function createApp(deps: AppDeps): HttpApp {
  const app = express() as HttpApp;
  const browserSessions = createBrowserSessionAuth(deps.basicAuth);
  // Public platform health probes cannot provide the internal Basic Auth
  // credentials. Keep this endpoint deliberately data-free; the API health
  // route below remains protected with the rest of the application surface.
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  // Load the JSON parser and browser shell before the API perimeter. This
  // lets a browser show a normal login form instead of receiving a native
  // Basic Auth challenge, which some embedded browsers cannot complete.
  app.use(express.json({ limit: MAX_HTTP_BODY_BYTES }));
  if (deps.frontendDist) {
    app.use(express.static(deps.frontendDist, { index: "index.html" }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(join(deps.frontendDist!, "index.html"));
    });
  }
  app.use("/api", createBrowserTrustMiddleware(deps.publicMode ? "public" : "local"));
  app.get("/api/v1/auth/session", (req, res) => {
    res.json({ authenticated: browserSessions.isValid(req) });
  });
  app.post("/api/v1/auth/login", (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!browserSessions.login(req, res, username, password)) {
      invalidCredentials(res);
      return;
    }
    res.json({ authenticated: true });
  });
  app.post("/api/v1/auth/logout", (req, res) => {
    browserSessions.clear(res, req);
    res.json({ authenticated: false });
  });
  app.use(createBasicAuthMiddleware(deps.basicAuth, browserSessions));

  // 诊断切片：请求关联 ID + 请求日志（stdout 全量；event_log 只收 ≥400 或慢请求）。
  const httpObservers = { logger: deps.logger, eventLog: deps.eventLog };
  const route = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) => withErrorHandler(handler, httpObservers);
  app.use("/api", (req, res, next) => {
    const requestId = newCorrelationId();
    res.setHeader("x-request-id", requestId);
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      const status = res.statusCode;
      deps.logger?.info("http.request", { method: req.method, path: req.path, status, durationMs, requestId });
      if (!deps.eventLog) return;
      // 持久化策略：错误/告警状态码，或慢请求（成功但 >5s）
      if (status >= 400 || durationMs > 5_000) {
        deps.eventLog.append({
          level: status >= 500 ? "error" : "warn",
          source: "server",
          type: "http.request",
          correlationId: requestId,
          data: { method: req.method, path: req.path, status, durationMs },
        });
      }
    });
    next();
  });

  app.use("/api", (req, res, next) => {
    if (deps.shutdown?.isDraining() && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      res.status(503).json({ error: { code: "server_draining", message: "Server is shutting down" } });
      return;
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    try {
      if (req.header("Idempotency-Key") !== undefined) parseIdempotencyKey(req.header("Idempotency-Key"));
      next();
    } catch (err) {
      if (err instanceof InvalidIdempotencyKeyError) {
        res.status(400).json({ error: { code: "invalid_idempotency_key", message: "Idempotency-Key is invalid" } });
        return;
      }
      next(err);
    }
  });
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
  const buildDeps = {
    persistence: deps.persistence,
    tasks: deps.tasks,
    events: deps.events,
    compiler: deps.compiler,
    content: deps.content,
    workspaceDir: deps.workspaceDir,
    now,
  };
  const readinessDeps = { persistence: deps.persistence, content: deps.content, now };
  const diagnosisDeps = { persistence: deps.persistence, content: deps.content, events: deps.events, ai: deps.ai, now };
  const flashTokens = createFlashTokenStore();
  const flashDeps = {
    persistence: deps.persistence,
    tasks: deps.tasks,
    events: deps.events,
    device: deps.device,
    tokens: flashTokens,
    workspaceDir: deps.workspaceDir,
    now,
  };

  const serialDto = (value: SerialSession): SerialSessionDto => ({ ...value });
  const taskDto = (value: TaskRecord) => ({ ...value, error: parseTaskError(value.error) });

  const taskRuntime = deps.tasks as Partial<InProcessTaskRuntime>;
  taskRuntime.setExecutor?.(
    createProductionTaskExecutor({
      persistence: deps.persistence,
      events: deps.events,
      ai: deps.ai,
      compiler: deps.compiler,
      workspaceDir: deps.workspaceDir,
      now,
      device: deps.device,
      tokens: flashTokens,
    }),
  );

  const archiveTokens = new Map<string, ArchiveTokenEntry>();
  const serialStreams = new Set<() => void>();

  const closeSseStreams = (): void => {
    const sse = deps.events as Partial<import("@/src/adapters/events/sse").SseEvents>;
    sse.closeAll?.();
    for (const close of [...serialStreams]) close();
  };

  const handleCreate = async (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const idempotency = makeIdempotencyRequest(req.header("Idempotency-Key"), "POST:/api/v1/projects", { name }, now().toISOString());
    try {
      const project = await createProjectCapability({ name, now, idempotency }, capDeps);
      writeProjectMirror(deps.workspaceDir, project); // best-effort 镜像（DB 为真相源）
      res.status(201).json(project);
    } catch (err) {
      if (err instanceof InvalidProjectNameError) throw new ApiError(400, "invalid_name", err.message);
      if (err instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", err.message);
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
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const idempotency = makeIdempotencyRequest(
      req.header("Idempotency-Key"),
      `POST:/api/v1/artifacts/${req.params.artifactId as string}/versions`,
      { content },
      now().toISOString(),
    );
    try {
      const version = await commitManualEditCapability(
        { artifactId: req.params.artifactId as string, content, now, idempotency },
        artifactDeps,
      );
      res.status(201).json(version);
    } catch (err) {
      if (err instanceof ArtifactNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof InvalidContentError) throw new ApiError(400, "invalid_content", err.message);
      if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
      if (err instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", err.message);
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
    try {
      const content = await loadVerifiedArtifactContent(version, deps.content);
      res.json({ version, content });
    } catch (error) {
      if (error instanceof PersistenceIntegrityError) {
        throw new ApiError(409, error.code, error.message);
      }
      throw error;
    }
  };

  // ---------- S3A Commands / Tasks / SSE ----------

  const handleCommands = async (req: Request, res: Response) => {
    const { capability, payload } = req.body ?? {};
    const projectId = req.params.projectId as string;
    const project = await getProjectCapability({ id: projectId }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");

    // R4：AI 权限三级表 fail-closed 强制——未登记拒绝、forbidden 拒绝、其余按既有提案路径放行。
    const tier = aiPermissionFor(String(capability ?? ""));
    if (tier === null) throw new ApiError(404, "unknown_capability", `Unknown command capability: ${String(capability)}`);
    if (tier === "forbidden") {
      throw new ApiError(403, "capability_forbidden", `Capability is not reachable via the AI command surface: ${String(capability)}`);
    }

    if (capability === "analyze_requirement") {
      const description = typeof payload?.description === "string" ? payload.description : "";
      const idempotency = makeIdempotencyRequest(
        req.header("Idempotency-Key"),
        `POST:/api/v1/projects/${projectId}/commands:analyze_requirement`,
        { description, lab: payload?.lab },
        now().toISOString(),
      );
      try {
        const { taskId } = await analyzeRequirementCapability(
          { projectId, description, lab: payload?.lab, now, idempotency },
          analysisDeps,
        );
        res.status(202).json({ taskId });
      } catch (err) {
        if (err instanceof InvalidDescriptionError) throw new ApiError(400, "invalid_description", err.message);
        if (err instanceof ResourceLimitError && err.code === "input_too_large") throw new ApiError(413, "input_too_large", err.message);
        if (err instanceof ResourceLimitError && err.code === "resource_capacity_exceeded") throw new ApiError(503, "resource_capacity_exceeded", err.message);
        if (err instanceof AnalysisNotFoundError) throw new ApiError(404, "not_found", err.message);
        if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
        if (err instanceof ProviderUnavailableError) throw new ApiError(503, "provider_unavailable", err.message);
        if (err instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", err.message);
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

    if (capability === "generate_firmware") {
      try {
        // S6：只产出 Proposal（I-1 不写版本）；Diff/接受/拒绝走提案机制
        const result = await generateFirmwareProposalCapability({ projectId }, proposalDeps);
        res.json(result);
      } catch (err) {
        if (err instanceof NoPinMapError) throw new ApiError(409, "no_pin_map", err.message);
        if (err instanceof BlockingStaleError) throw new ApiError(409, "blocking_stale", err.message);
        if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
        throw err;
      }
      return;
    }

    // 权限守卫已拦截未知 capability（404 unknown_capability）；能走到这里说明
    // 权限表有项但缺命令分支——表/分支漂移，按同一词汇报 404 而非悬挂响应。
    throw new ApiError(404, "unknown_capability", "Capability registered without a command branch");
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
    if (!ok) throw new ApiError(409, "invalid_analysis_state", "Task is not cancellable (already terminal or missing)");
    res.status(202).json({ taskId: req.params.taskId, status: "cancelled" });
  };

  const handleGetTask = async (req: Request, res: Response) => {
    const task = await getTaskCapability({ taskId: req.params.taskId as string }, analysisDeps);
    if (!task) throw new ApiError(404, "not_found", "Task not found");
    res.json(taskDto(task));
  };

  const handleListTasks = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    res.json((await deps.persistence.listTasks?.(project.id) ?? []).map(taskDto));
  };

  const handleEvents = (req: Request, res: Response) => {
    if (deps.shutdown?.isDraining()) throw new ApiError(503, "server_draining", "Server is shutting down");
    // Subscribe before committing SSE headers so setup failures still reach the
    // shared JSON error boundary.
    const sse = deps.events as import("@/src/adapters/events/sse").SseEvents;
    try {
      sse.subscribe(req.params.projectId as string, res);
    } catch (err) {
      if (err instanceof ResourceLimitError && err.code === "subscriber_limit_reached") {
        throw new ApiError(503, "subscriber_limit_reached", "Subscriber limit reached");
      }
      throw err;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
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

  // ---------- S7 Build ----------

  const handleRunBuild = async (req: Request, res: Response) => {
    const buildInput = {
      projectId: req.params.projectId as string,
      versionId: typeof req.body?.versionId === "string" ? req.body.versionId : "",
      target: typeof req.body?.target === "string" ? req.body.target : undefined,
      toolchain: typeof req.body?.toolchain === "string" ? req.body.toolchain : undefined,
      options: req.body?.options,
      now,
    };
    const idempotency = makeIdempotencyRequest(
      req.header("Idempotency-Key"),
      `POST:/api/v1/projects/${buildInput.projectId}/builds`,
      { versionId: buildInput.versionId, target: buildInput.target, toolchain: buildInput.toolchain, options: buildInput.options },
      now().toISOString(),
    );
    try {
      const { buildId } = await runBuildCapability({ ...buildInput, idempotency }, buildDeps);
      res.status(202).json({ buildId });
    } catch (err) {
      if (err instanceof BuildVersionNotFoundError || err instanceof BuildNotFoundError)
        throw new ApiError(404, "not_found", err.message);
      if (err instanceof ToolchainUnavailableError) throw new ApiError(503, "toolchain_unavailable", err.message);
      if (err instanceof UnsupportedBuildTargetError) throw new ApiError(400, "unsupported_build_target", err.message);
      if (err instanceof BuildInputError) throw new ApiError(400, "invalid_build_source", err.message);
      if (err instanceof ResourceLimitError && err.code === "resource_capacity_exceeded") throw new ApiError(503, "resource_capacity_exceeded", err.message);
      if (err instanceof BlockingStaleError) throw new ApiError(409, "blocking_stale", err.message);
      if (err instanceof ArchivedProjectError) throw new ApiError(409, "archived_read_only", err.message);
      if (err instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", err.message);
      throw err;
    }
  };

  const handleGetBuild = async (req: Request, res: Response) => {
    const record = await getBuildRecordCapability({ buildId: req.params.buildId as string }, buildDeps);
    if (!record) throw new ApiError(404, "not_found", "Build record not found");
    res.json(record);
  };

  const handleReadinessReport = async (req: Request, res: Response) => {
    try {
      res.json(await getAcceptancePolicyReport({ projectId: req.params.projectId as string }, readinessDeps));
    } catch (err) {
      if (err instanceof ReadinessProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      throw err;
    }
  };

  const handleDeliveryReport = async (req: Request, res: Response) => {
    try {
      res.json(await getDeliveryReport({ projectId: req.params.projectId as string }, readinessDeps));
    } catch (err) {
      if (err instanceof ReadinessProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      throw err;
    }
  };

  const handleCancelBuild = async (req: Request, res: Response) => {
    try {
      const result = await cancelBuildCapability({ buildId: req.params.buildId as string }, buildDeps);
      res.status(202).json(result);
    } catch (err) {
      if (err instanceof BuildNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof BuildNotCancellableError) throw new ApiError(409, "invalid_build_state", err.message);
      throw err;
    }
  };

  const handleListBuilds = async (req: Request, res: Response) => {
    res.json(await listBuildsCapability({ versionId: req.params.versionId as string }, buildDeps));
  };

  // 工具链发现（真实检测；UI 横幅 + 重检测）
  const handleToolchain = async (_req: Request, res: Response) => {
    const info = await deps.compiler.discoverToolchain();
    res.json(info);
  };

  // ---------- S9 Device / Flash / Serial ----------

  const handleDetectDevice = async (_req: Request, res: Response) => {
    try {
      const device = await detectDeviceCapability({}, flashDeps);
      res.json(device);
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as Error & { code?: unknown }).code) : "";
      if (code === "PHYSICAL_TOOL_UNAVAILABLE") throw new ApiError(503, "physical_tool_unavailable", err instanceof Error ? err.message : String(err));
      if (code === "PHYSICAL_DEVICE_NOT_FOUND") throw new ApiError(409, "physical_device_not_found", err instanceof Error ? err.message : String(err));
      if (code === "PHYSICAL_DEVICE_AMBIGUOUS") throw new ApiError(409, "physical_device_ambiguous", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const handleDeviceState = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    const raw = await deps.persistence.getPreference("last_device");
    if (!raw) {
      res.json({ lastDevice: null });
      return;
    }
    try {
      res.json({ lastDevice: JSON.parse(raw) });
    } catch {
      res.json({ lastDevice: null });
    }
  };

  const handlePhysicalAcceptance = async (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const buildId = typeof req.body?.buildId === "string" ? req.body.buildId : "";
    const artifactVersionId = typeof req.body?.artifactVersionId === "string" ? req.body.artifactVersionId : "";
    const serialObservation = typeof req.body?.serialObservation === "string" ? req.body.serialObservation : undefined;
    if (!buildId || !artifactVersionId) throw new ApiError(400, "invalid_capability", "buildId and artifactVersionId are required");
    try {
      res.status(201).json(await recordPhysicalAcceptance({ projectId, buildId, artifactVersionId, serialObservation }, readinessDeps));
    } catch (err) {
      if (err instanceof PhysicalAcceptanceProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof PhysicalAcceptanceInputError) throw new ApiError(400, "invalid_capability", err.message);
      throw err;
    }
  };

  const handleLatestPhysicalAcceptance = async (req: Request, res: Response) => {
    const project = await getProjectCapability({ id: req.params.projectId as string }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    res.json({ record: await latestPhysicalAcceptanceCapability({ projectId: project.id }, flashDeps) });
  };

  const handleGetBom = async (req: Request, res: Response) => {
    try {
      res.json(await getProjectBom({ projectId: req.params.projectId as string }, readinessDeps));
    } catch (err) {
      if (err instanceof BomProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      throw err;
    }
  };

  const handleCreateBomItem = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      res.status(201).json(await createBomItem({
        projectId: req.params.projectId as string,
        componentId: typeof body.componentId === "string" ? body.componentId : "",
        displayName: typeof body.displayName === "string" ? body.displayName : "",
        sourceKind: "user-input",
        identityStatus: body.identityStatus === "exact" ? "exact" : "unresolved",
        manufacturer: typeof body.manufacturer === "string" ? body.manufacturer : null,
        manufacturerPartNumber: typeof body.manufacturerPartNumber === "string" ? body.manufacturerPartNumber : null,
        supplierSku: typeof body.supplierSku === "string" ? body.supplierSku : null,
        quantity: Number(body.quantity),
        unresolvedReason: typeof body.unresolvedReason === "string" ? body.unresolvedReason : null,
      }, readinessDeps));
    } catch (err) {
      if (err instanceof BomProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof BomInputError) throw new ApiError(400, "invalid_capability", err.message);
      throw err;
    }
  };

  const handlePriceObservation = async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const numberOrNull = (value: unknown): number | null => value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
      res.status(201).json(await addPriceObservation({
        projectId: req.params.projectId as string,
        bomItemId: req.params.itemId as string,
        supplierSku: typeof body.supplierSku === "string" ? body.supplierSku : "",
        manufacturerPartNumber: typeof body.manufacturerPartNumber === "string" ? body.manufacturerPartNumber : null,
        quantityTier: Number(body.quantityTier) as 1 | 10 | 100,
        unitPrice: numberOrNull(body.unitPrice),
        lineTotal: numberOrNull(body.lineTotal),
        shipping: numberOrNull(body.shipping),
        tax: numberOrNull(body.tax),
        fees: numberOrNull(body.fees),
        stockStatus: body.stockStatus === "in-stock" || body.stockStatus === "out-of-stock" ? body.stockStatus : "unknown",
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : "",
        observedAt: typeof body.observedAt === "string" ? body.observedAt : undefined,
      }, readinessDeps));
    } catch (err) {
      if (err instanceof BomProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof BomInputError) throw new ApiError(400, "invalid_capability", err.message);
      throw err;
    }
  };

  const handleBomExport = async (req: Request, res: Response) => {
    try {
      const format = req.query.format === "markdown" ? "markdown" : req.query.format === "csv" ? "csv" : "";
      if (!format) throw new BomInputError("format must be csv or markdown");
      const result = await exportProjectBom({ projectId: req.params.projectId as string, format }, readinessDeps);
      res.json(result);
    } catch (err) {
      if (err instanceof BomProjectNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof BomInputError) throw new ApiError(400, "invalid_capability", err.message);
      throw err;
    }
  };

  const handleFlashToken = async (req: Request, res: Response) => {
    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : "";
    if (!deviceId) throw new ApiError(400, "invalid_capability", "deviceId required");
    res.json(await issueFlashTokenCapability({ deviceId }, flashDeps));
  };

  const handleFlash = async (req: Request, res: Response) => {
    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : "";
    const confirmationToken = typeof req.body?.confirmationToken === "string" ? req.body.confirmationToken : "";
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
    const buildId = typeof req.body?.buildId === "string" ? req.body.buildId : "";
    const artifactVersionId = typeof req.body?.artifactVersionId === "string" ? req.body.artifactVersionId : "";
    const requestedReality = req.body?.executionReality;
    const executionReality: DeviceExecutionReality | undefined =
      requestedReality === "simulation" || requestedReality === "companion" || requestedReality === "physical"
        ? requestedReality
        : requestedReality === undefined
          ? undefined
          : (() => { throw new ApiError(400, "invalid_capability", "executionReality must be simulation, companion, or physical"); })();
    const idempotency = makeIdempotencyRequest(
      req.header("Idempotency-Key"),
      `POST:/api/v1/device/flash:${projectId}`,
      { projectId, deviceId, confirmationToken, buildId, artifactVersionId, executionReality },
      now().toISOString(),
    );
    try {
      const result = await flashDeviceCapability({ projectId, deviceId, confirmationToken, buildId, artifactVersionId, executionReality, idempotency }, flashDeps);
      res.status(202).json(result);
    } catch (err) {
      if (err instanceof ConfirmationMissingError) throw new ApiError(403, "confirmation_missing", err.message);
      if (err instanceof ConfirmationExpiredError) throw new ApiError(403, "confirmation_expired", err.message);
      if (err instanceof TokenReusedError) throw new ApiError(403, "token_reused", err.message);
      if (err instanceof DeviceMismatchError) throw new ApiError(403, "device_mismatch", err.message);
      if (err instanceof DeviceDisconnectedError) throw new ApiError(409, "device_disconnected", err.message);
      if (err instanceof Error && "code" in err && String((err as Error & { code?: unknown }).code) === "DEVICE_BUSY") throw new ApiError(409, "device_busy", err.message);
      if (err instanceof PhysicalFlashBlockedError) throw new ApiError(409, "physical_flash_blocked", err.message);
      if (err instanceof FlashBuildNotVerifiedError) throw new ApiError(409, "flash_build_not_verified", err.message);
      if (err instanceof FlashFirmwareMissingError) throw new ApiError(409, "flash_firmware_missing", err.message);
      if (err instanceof FlashFirmwareHashMismatchError) throw new ApiError(409, "flash_firmware_hash_mismatch", err.message);
      if (err instanceof PhysicalDeviceNotFoundError) throw new ApiError(409, "physical_device_not_found", err.message);
      if (err instanceof PhysicalDeviceAmbiguousError) throw new ApiError(409, "physical_device_ambiguous", err.message);
      if (err instanceof PhysicalDeviceChangedError) throw new ApiError(409, "physical_device_changed", err.message);
      const adapterCode = err instanceof Error && "code" in err ? String((err as Error & { code?: unknown }).code) : "";
      if (adapterCode === "PHYSICAL_TOOL_UNAVAILABLE") throw new ApiError(503, "physical_tool_unavailable", err instanceof Error ? err.message : String(err));
      if (adapterCode === "PHYSICAL_DEVICE_NOT_FOUND") throw new ApiError(409, "physical_device_not_found", err instanceof Error ? err.message : String(err));
      if (adapterCode === "PHYSICAL_DEVICE_AMBIGUOUS") throw new ApiError(409, "physical_device_ambiguous", err instanceof Error ? err.message : String(err));
      if (adapterCode === "PHYSICAL_DEVICE_CHANGED") throw new ApiError(409, "physical_device_changed", err instanceof Error ? err.message : String(err));
      if (adapterCode === "FLASH_TIMEOUT") throw new ApiError(504, "flash_timeout", err instanceof Error ? err.message : String(err));
      if (err instanceof BlockingStaleError) throw new ApiError(409, "blocking_stale", err.message);
      if (err instanceof FirmwareVersionNotFoundError) throw new ApiError(404, "not_found", err.message);
      if (err instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", err.message);
      throw err;
    }
  };

  const handleDisconnect = async (_req: Request, res: Response) => {
    await disconnectDeviceCapability(flashDeps);
    res.json({ status: "disconnected" });
  };

  const handleOpenSerial = async (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const project = await getProjectCapability({ id: projectId }, capDeps);
    if (!project) throw new ApiError(404, "not_found", "Project not found");
    const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : "";
    if (!deviceId) throw new ApiError(400, "invalid_capability", "deviceId required");
    const baudRate = req.body?.baudRate === undefined ? undefined : Number(req.body.baudRate);
    if (baudRate !== undefined && (!Number.isInteger(baudRate) || baudRate < 1)) throw new ApiError(400, "invalid_capability", "baudRate must be a positive integer");
    try {
      res.status(201).json(serialDto(await deps.device.openSerialSession({ projectId, deviceId, baudRate })));
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as Error & { code?: unknown }).code) : "";
      if (code === "SERIAL_DEVICE_NOT_FOUND") throw new ApiError(409, "serial_device_not_found", err instanceof Error ? err.message : String(err));
      if (code === "SERIAL_DEVICE_CHANGED") throw new ApiError(409, "serial_device_changed", err instanceof Error ? err.message : String(err));
      if (code === "DEVICE_BUSY") throw new ApiError(409, "device_busy", err instanceof Error ? err.message : String(err));
      throw new ApiError(409, "serial_transport_error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSerialState = async (req: Request, res: Response) => {
    const value = deps.device.getSerialSession(req.params.projectId as string, req.params.sessionId as string);
    if (!value) throw new ApiError(404, "serial_session_not_found", "Serial session not found");
    res.json(serialDto(value));
  };

  const handleCloseSerial = async (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const sessionId = req.params.sessionId as string;
    if (!deps.device.getSerialSession(projectId, sessionId)) throw new ApiError(404, "serial_session_not_found", "Serial session not found");
    await deps.device.closeSerialSession(sessionId);
    res.json({ status: "disconnected", sessionId });
  };

  const handleWriteSerial = async (req: Request, res: Response) => {
    const projectId = req.params.projectId as string;
    const sessionId = req.params.sessionId as string;
    const command = typeof req.body?.command === "string" ? req.body.command : "";
    if (!command.trim()) throw new ApiError(400, "invalid_capability", "command required");
    try {
      assertUtf8Bytes(command, MAX_SERIAL_WRITE_BYTES, "serial_write_too_large");
    } catch (err) {
      if (err instanceof ResourceLimitError || err instanceof SerialWriteTooLargeError) {
        throw new ApiError(413, "serial_write_too_large", "Serial write exceeds the supported size");
      }
      throw err;
    }
    if (!deps.device.getSerialSession(projectId, sessionId)) throw new ApiError(404, "serial_session_not_found", "Serial session not found");
    try {
      res.json(await sendSerialCapability({ sessionId, command }, flashDeps));
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as Error & { code?: unknown }).code) : "";
      if (code === "SERIAL_SESSION_NOT_OPEN") throw new ApiError(409, "serial_session_not_open", err instanceof Error ? err.message : String(err));
      if (code === "SERIAL_LINE_TOO_LARGE") throw new ApiError(409, "serial_line_too_large", err instanceof Error ? err.message : String(err));
      if (code === "SERIAL_WRITE_TOO_LARGE" || code === "serial_write_too_large") throw new ApiError(413, "serial_write_too_large", "Serial write exceeds the supported size");
      throw new ApiError(409, "serial_transport_error", err instanceof Error ? err.message : String(err));
    }
  };

  const handleSerialStream = (req: Request, res: Response) => {
    if (deps.shutdown?.isDraining()) throw new ApiError(503, "server_draining", "Server is shutting down");
    const projectId = req.params.projectId as string;
    const sessionId = req.params.sessionId as string;
    const current = deps.device.getSerialSession(projectId, sessionId);
    if (!current) throw new ApiError(404, "serial_session_not_found", "Serial session not found");
    let closed = false;
    let backpressured = false;
    let unsubscribe: () => void = () => undefined;
    const timerRef: { current?: NodeJS.Timeout } = {};
    const closeStream = (): void => {
      if (closed) return;
      closed = true;
      if (timerRef.current) clearInterval(timerRef.current);
      unsubscribe();
      res.removeListener("drain", onDrain);
      serialStreams.delete(closeStream);
      if (!res.writableEnded) res.end();
    };
    const write = (frame: string): void => {
      if (closed) return;
      if (backpressured) {
        closeStream();
        return;
      }
      try {
        if (!res.write(frame)) backpressured = true;
      } catch {
        closeStream();
      }
    };
    const onDrain = () => { backpressured = false; };
    res.on("drain", onDrain);
    try {
      unsubscribe = deps.device.subscribeSerialSession(projectId, sessionId, (event) => {
      if (event.type === "line") {
        write(`event: serial.line\ndata: ${JSON.stringify({ sessionId, projectId, deviceId: event.session.deviceId, executionReality: event.session.executionReality, timestamp: event.receivedAt, line: event.line })}\n\n`);
      } else if (event.type === "error") {
        const safe = toSafeError({ code: event.code, message: event.message });
        write(`event: serial.session.error\ndata: ${JSON.stringify({ sessionId, projectId, deviceId: event.session.deviceId, code: safe.code, message: safe.message, timestamp: event.receivedAt })}\n\n`);
      } else {
        write(`event: serial.session.closed\ndata: ${JSON.stringify({ sessionId, projectId, reason: event.reason, timestamp: event.receivedAt })}\n\n`);
        closeStream();
      }
      });
    } catch (err) {
      if (err instanceof Error && "code" in err && ["SUBSCRIBER_LIMIT_REACHED", "subscriber_limit_reached"].includes(String((err as Error & { code?: unknown }).code))) {
        res.removeListener("drain", onDrain);
        throw new ApiError(503, "subscriber_limit_reached", "Subscriber limit reached");
      }
      res.removeListener("drain", onDrain);
      throw err;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    write(": connected\n\n");
    // Companion is deterministic but still models a live serial producer. The
    // physical adapter's tickSerial is intentionally a no-op: physical lines
    // can only arrive from OS transport bytes. This timer is stream-scoped and
    // never replays buffered lines.
    timerRef.current = setInterval(() => {
      if (!deps.device.getSerialSession(projectId, sessionId)) {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      deps.device.tickSerial();
    }, 800);
    serialStreams.add(closeStream);
    req.on("close", closeStream);
  };

  // S8：诊断（Build FAILED → 原因/建议/Fix 提案；不写版本）
  const handleDiagnoseBuild = async (req: Request, res: Response) => {
    try {
      const result = await diagnoseBuildCapability({ buildId: req.params.buildId as string, now }, diagnosisDeps);
      res.json(result);
    } catch (err) {
      if (err instanceof BuildNotFoundError || err instanceof DiagnosisBuildNotFoundError)
        throw new ApiError(404, "not_found", err.message);
      if (err instanceof BuildNotFailedError) throw new ApiError(409, "build_not_failed", err.message);
      if (err instanceof ProviderUnavailableError) throw new ApiError(503, "provider_unavailable", err.message);
      throw err;
    }
  };

  app.get("/api/v1/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/v1/projects", route(handleCreate));
  app.get("/api/v1/projects", route(handleList));
  app.get("/api/v1/projects/:id", route(handleGet));
  app.post("/api/v1/projects/:id/archive-token", route(handleArchiveToken));
  app.post("/api/v1/projects/:id/archive", route(handleArchive));
  app.get("/api/v1/projects/:projectId/artifacts", route(handleListArtifacts));
  app.post("/api/v1/projects/:projectId/artifacts", route(handleEnsureArtifact));
  app.post("/api/v1/artifacts/:artifactId/versions", route(handleCommitVersion));
  app.get("/api/v1/artifacts/:artifactId/versions", route(handleListVersions));
  app.get("/api/v1/versions/:versionId", route(handleGetVersion));
  app.post("/api/v1/versions/:versionId/validations", route(handleValidateWiring));
  app.get("/api/v1/versions/:versionId/validations", route(handleLatestValidation));
  app.post("/api/v1/projects/:projectId/commands", route(handleCommands));
  app.get("/api/v1/ai/permissions", route(async (_req: Request, res: Response) => {
    res.json({ permissions: AI_PERMISSION_TABLE, forbidden: AI_FORBIDDEN_OPERATIONS });
  }));
  app.get("/api/v1/projects/:projectId/tasks", route(handleListTasks));
  app.get("/api/v1/projects/:projectId/proposals", route(handleListProposals));
  app.post("/api/v1/projects/:projectId/requirements/commit", route(handleCommitRequirements));
  app.post("/api/v1/proposals/:proposalId/decision", route(handleResolveProposal));
  app.post("/api/v1/commands/:taskId/clarification", route(handleClarification));
  app.post("/api/v1/commands/:taskId/cancel", route(handleCancel));
  app.get("/api/v1/commands/:taskId", route(handleGetTask));
  app.get("/api/v1/projects/:projectId/stale-marks", route(handleStaleMarks));
  app.post("/api/v1/projects/:projectId/builds", route(handleRunBuild));
  app.get("/api/v1/builds/:buildId", route(handleGetBuild));
  app.get("/api/v1/projects/:projectId/readiness-report", route(handleReadinessReport));
  app.get("/api/v1/projects/:projectId/delivery-report", route(handleDeliveryReport));
  app.post("/api/v1/builds/:buildId/diagnose", route(handleDiagnoseBuild));
  app.post("/api/v1/builds/:buildId/cancel", route(handleCancelBuild));
  app.get("/api/v1/versions/:versionId/builds", route(handleListBuilds));
  app.get("/api/v1/toolchain", route(handleToolchain));
  app.post("/api/v1/device/detect", route(handleDetectDevice));
  app.get("/api/v1/projects/:projectId/device-state", route(handleDeviceState));
  app.get("/api/v1/projects/:projectId/physical-acceptance", route(handleLatestPhysicalAcceptance));
  app.post("/api/v1/projects/:projectId/physical-acceptance", route(handlePhysicalAcceptance));
  app.get("/api/v1/projects/:projectId/bom", route(handleGetBom));
  app.get("/api/v1/projects/:projectId/bom/export", route(handleBomExport));
  app.post("/api/v1/projects/:projectId/bom/items", route(handleCreateBomItem));
  app.post("/api/v1/projects/:projectId/bom/items/:itemId/price-observations", route(handlePriceObservation));
  app.post("/api/v1/device/flash-token", route(handleFlashToken));
  app.post("/api/v1/device/flash", route(handleFlash));
  app.post("/api/v1/device/disconnect", route(handleDisconnect));
  app.post("/api/v1/projects/:projectId/device/serial/session", route(handleOpenSerial));
  app.get("/api/v1/projects/:projectId/device/serial/session/:sessionId", route(handleSerialState));
  app.delete("/api/v1/projects/:projectId/device/serial/session/:sessionId", route(handleCloseSerial));
  app.post("/api/v1/projects/:projectId/device/serial/session/:sessionId/write", route(handleWriteSerial));
  app.get("/api/v1/projects/:projectId/device/serial/session/:sessionId/events", route(handleSerialStream));
  app.get("/api/v1/projects/:projectId/events", route(handleEvents));

  // ---------- 诊断切片：客户端错误上报 + 运营者诊断读取 ----------
  const clientReportLimiter = createClientRateLimiter({
    limit: 60,
    windowMs: 10 * 60 * 1000,
    maxKeys: 10_000,
  });
  const asBoundedString = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    return value.length > max ? value.slice(0, max) : value;
  };
  const handleClientErrorReport = async (req: Request, res: Response) => {
    if (!deps.eventLog) throw new ApiError(503, "resource_capacity_exceeded", "Diagnostics storage is not available");
    const clientAddress = resolveClientAddress(
      { remoteAddress: req.socket.remoteAddress, forwardedFor: req.header("x-forwarded-for") },
      deps.trustedProxies ?? [],
    );
    if (!clientReportLimiter.take(clientAddress)) {
      throw new ApiError(429, "rate_limited", "Too many client error reports from this address");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = asBoundedString(body.message, 2000);
    if (!message) throw new ApiError(400, "invalid_content", "message is required");
    const extraRaw = body.extra && typeof body.extra === "object" && !Array.isArray(body.extra) ? body.extra : undefined;
    const extra = extraRaw && JSON.stringify(extraRaw).length <= 4000 ? (extraRaw as Record<string, unknown>) : undefined;
    // ISSUE-003：correlationId 用本请求的 x-request-id（与请求日志/服务端错误行同键，可 join）；
    // 客户端自造 sessionId 降级为 data 字段保留（同浏览器多错误的聚合键）。
    const requestId = res.getHeader("x-request-id");
    const sessionId = asBoundedString(body.sessionId, 64);
    deps.eventLog.append({
      level: "error",
      source: "client",
      type: "client.error",
      correlationId: typeof requestId === "string" ? requestId : null,
      data: {
        message,
        ...(sessionId ? { sessionId } : {}),
        ...(asBoundedString(body.stack, 16000) ? { stack: asBoundedString(body.stack, 16000) } : {}),
        ...(asBoundedString(body.url, 500) ? { url: asBoundedString(body.url, 500) } : {}),
        ...(asBoundedString(body.userAgent, 200) ? { userAgent: asBoundedString(body.userAgent, 200) } : {}),
        ...(asBoundedString(body.appVersion, 64) ? { appVersion: asBoundedString(body.appVersion, 64) } : {}),
        ...(extra ? { extra } : {}),
      },
    });
    res.status(202).json({ status: "accepted" });
  };
  const requireOperator = (req: Request): void => {
    if (!hasOperatorBasicCredentials(req, deps.basicAuth)) {
      throw new ApiError(403, "forbidden", "Operator credentials required");
    }
    if (!deps.eventLog) throw new ApiError(503, "resource_capacity_exceeded", "Diagnostics storage is not available");
  };
  const handleDiagnosticsEvents = async (req: Request, res: Response) => {
    requireOperator(req);
    const level = req.query.level === "info" || req.query.level === "warn" || req.query.level === "error" ? req.query.level : undefined;
    const source = req.query.source === "server" || req.query.source === "client" ? req.query.source : undefined;
    const type = asBoundedString(req.query.type, 100);
    const projectId = asBoundedString(req.query.projectId, 64);
    const limitRaw = typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : undefined;
    res.json({ events: deps.eventLog!.list({ level, source, type, projectId, limit: limitRaw }) });
  };
  const handleDiagnosticsSummary = async (req: Request, res: Response) => {
    requireOperator(req);
    res.json(deps.eventLog!.summary());
  };
  app.post("/api/v1/diagnostics/client-errors", route(handleClientErrorReport));
  app.get("/api/v1/diagnostics/events", route(handleDiagnosticsEvents));
  app.get("/api/v1/diagnostics/summary", route(handleDiagnosticsSummary));


  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "API route not found" } });
  });

  // Keep every API failure JSON-shaped, including express.json() parser
  // failures and handlers that are not wrapped by a route-specific adapter.
  app.use(apiErrorBoundary(httpObservers));

  app.closeSseStreams = closeSseStreams;
  return app;
}
