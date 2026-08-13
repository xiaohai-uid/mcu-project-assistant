// adapters/http/app.ts — HTTP surface（S1 projects + S2 artifacts/versions + S3A commands/SSE）
// /commands 是 HTTP 收口；Application 内部调用明确函数（analyzeRequirement()…），禁止 CommandBus/Registry 框架。
import { randomUUID } from "node:crypto";
import { join } from "node:path";
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
import type { ArtifactKind, ArtifactVersionDto, DeviceExecutionReality, SerialSessionDto } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";
import { ApiError, apiErrorBoundary, withErrorHandler } from "./error";
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
import { MAX_HTTP_BODY_BYTES, MAX_SERIAL_WRITE_BYTES, ResourceLimitError, assertUtf8Bytes } from "@/src/shared/resource-limits";
import { SerialWriteTooLargeError } from "@/src/ports/device";

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
  app.use(express.json({ limit: MAX_HTTP_BODY_BYTES }));

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
    workspaceDir: deps.workspaceDir,
    now,
  };
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
        if (err instanceof ResourceLimitError && err.code === "input_too_large") throw new ApiError(413, "input_too_large", err.message);
        if (err instanceof ResourceLimitError && err.code === "resource_capacity_exceeded") throw new ApiError(503, "resource_capacity_exceeded", err.message);
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
    try {
      const { buildId } = await runBuildCapability(
        {
          projectId: req.params.projectId as string,
          versionId: typeof req.body?.versionId === "string" ? req.body.versionId : "",
          target: typeof req.body?.target === "string" ? req.body.target : undefined,
          toolchain: typeof req.body?.toolchain === "string" ? req.body.toolchain : undefined,
          options: req.body?.options,
          now,
        },
        buildDeps,
      );
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
      throw err;
    }
  };

  const handleGetBuild = async (req: Request, res: Response) => {
    const record = await getBuildRecordCapability({ buildId: req.params.buildId as string }, buildDeps);
    if (!record) throw new ApiError(404, "not_found", "Build record not found");
    res.json(record);
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
    try {
      const result = await flashDeviceCapability({ projectId, deviceId, confirmationToken, buildId, artifactVersionId, executionReality }, flashDeps);
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
    const projectId = req.params.projectId as string;
    const sessionId = req.params.sessionId as string;
    const current = deps.device.getSerialSession(projectId, sessionId);
    if (!current) throw new ApiError(404, "serial_session_not_found", "Serial session not found");
    let closed = false;
    let backpressured = false;
    let unsubscribe: () => void = () => undefined;
    const write = (frame: string): void => {
      if (closed) return;
      if (backpressured) {
        closed = true;
        unsubscribe();
        res.removeListener("drain", onDrain);
        res.end();
        return;
      }
      try {
        if (!res.write(frame)) backpressured = true;
      } catch {
        closed = true;
        unsubscribe();
        res.removeListener("drain", onDrain);
        res.end();
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
        if (!closed) { closed = true; res.end(); }
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
    const timer = setInterval(() => {
      if (!deps.device.getSerialSession(projectId, sessionId)) {
        clearInterval(timer);
        return;
      }
      deps.device.tickSerial();
    }, 800);
    req.on("close", () => {
      closed = true;
      clearInterval(timer);
      unsubscribe();
      res.removeListener("drain", onDrain);
    });
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
  app.get("/api/v1/projects/:projectId/tasks", withErrorHandler(handleListTasks));
  app.get("/api/v1/projects/:projectId/proposals", withErrorHandler(handleListProposals));
  app.post("/api/v1/projects/:projectId/requirements/commit", withErrorHandler(handleCommitRequirements));
  app.post("/api/v1/proposals/:proposalId/decision", withErrorHandler(handleResolveProposal));
  app.post("/api/v1/commands/:taskId/clarification", withErrorHandler(handleClarification));
  app.post("/api/v1/commands/:taskId/cancel", withErrorHandler(handleCancel));
  app.get("/api/v1/commands/:taskId", withErrorHandler(handleGetTask));
  app.get("/api/v1/projects/:projectId/stale-marks", withErrorHandler(handleStaleMarks));
  app.post("/api/v1/projects/:projectId/builds", withErrorHandler(handleRunBuild));
  app.get("/api/v1/builds/:buildId", withErrorHandler(handleGetBuild));
  app.post("/api/v1/builds/:buildId/diagnose", withErrorHandler(handleDiagnoseBuild));
  app.post("/api/v1/builds/:buildId/cancel", withErrorHandler(handleCancelBuild));
  app.get("/api/v1/versions/:versionId/builds", withErrorHandler(handleListBuilds));
  app.get("/api/v1/toolchain", withErrorHandler(handleToolchain));
  app.post("/api/v1/device/detect", withErrorHandler(handleDetectDevice));
  app.get("/api/v1/projects/:projectId/device-state", withErrorHandler(handleDeviceState));
  app.post("/api/v1/device/flash-token", withErrorHandler(handleFlashToken));
  app.post("/api/v1/device/flash", withErrorHandler(handleFlash));
  app.post("/api/v1/device/disconnect", withErrorHandler(handleDisconnect));
  app.post("/api/v1/projects/:projectId/device/serial/session", withErrorHandler(handleOpenSerial));
  app.get("/api/v1/projects/:projectId/device/serial/session/:sessionId", withErrorHandler(handleSerialState));
  app.delete("/api/v1/projects/:projectId/device/serial/session/:sessionId", withErrorHandler(handleCloseSerial));
  app.post("/api/v1/projects/:projectId/device/serial/session/:sessionId/write", withErrorHandler(handleWriteSerial));
  app.get("/api/v1/projects/:projectId/device/serial/session/:sessionId/events", withErrorHandler(handleSerialStream));
  app.get("/api/v1/projects/:projectId/events", withErrorHandler(handleEvents));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "API route not found" } });
  });

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

  // Keep every API failure JSON-shaped, including express.json() parser
  // failures and handlers that are not wrapped by a route-specific adapter.
  app.use(apiErrorBoundary());

  return app;
}
