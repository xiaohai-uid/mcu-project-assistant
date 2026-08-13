// application/capabilities/analysis.ts — 需求分析能力（application-contract 2.2/2.3；ISSUE-003 §3/§6）
// analyze_requirement：异步长任务（TaskExecutionPort in-process）→ AIProviderPort 流式 + 结构化
// → 事件（started/progress/clarification.requested(roundId 多轮)/completed/failed/cancelled）
// 分析期间零 artifact 写入（I-12/D7：Clarification 不建对象，Analysis Session 交互记录）。
// submit_clarification：roundId 校验；answer 或显式 skip（记录默认规格选择）。
// ProviderUnavailable → provider.unavailable 事件 + 任务 failed（合法降级，ADR-0010）。

import type { AIProviderPort, ProviderStatus } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";
import type { RequirementAnalysisOutput } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";
import { assertNotArchived } from "@/src/domain/models/project";
import { MAX_REQUIREMENT_CHARS, ResourceLimitError, createResourceSemaphore } from "@/src/shared/resource-limits";
import { randomUUID } from "node:crypto";
import type { IdempotencyRequest } from "@/src/shared/idempotency";
import { IdempotencyConflictError } from "@/src/shared/idempotency";

export class AnalysisNotFoundError extends Error {
  constructor() {
    super("Analysis task not found");
    this.name = "AnalysisNotFoundError";
  }
}

export class InvalidDescriptionError extends Error {
  constructor() {
    super("Description must be a non-empty string");
    this.name = "InvalidDescriptionError";
  }
}

export class InvalidRoundError extends Error {
  constructor(expected: number) {
    super(`Invalid clarification round: expected round ${expected}`);
    this.name = "InvalidRoundError";
  }
}

export class NotAwaitingClarificationError extends Error {
  constructor() {
    super("Analysis is not awaiting clarification");
    this.name = "NotAwaitingClarificationError";
  }
}

export interface AnalysisCapabilityDeps {
  persistence: PersistencePort;
  tasks: TaskExecutionPort;
  ai: AIProviderPort;
  events: EventPort;
  now?: () => Date;
  heartbeatIntervalMs?: number;
}

interface ClarificationAnswer {
  answer: string | null;
  skip: boolean;
}

interface ClarificationGate {
  roundId: number;
  answer: Promise<ClarificationAnswer>;
  resolve: (v: ClarificationAnswer) => void;
}

const OBSERVABILITY_HEARTBEAT_MS = 8_000;
const analyzeResources = createResourceSemaphore(4);

async function withAnalyzeCapacity<T>(run: () => Promise<T>): Promise<T> {
  const lease = analyzeResources.tryAcquire();
  if (!lease) throw new ResourceLimitError("resource_capacity_exceeded");
  try {
    return await run();
  } finally {
    lease.release();
  }
}

function withProviderPhase<T>(
  ctx: import("@/src/ports/task-execution").TaskContext,
  operation: "stream_text" | "generate_structured",
  run: (setPhase: (phase: "provider_waiting" | "provider_streaming") => void) => Promise<T>,
  heartbeatIntervalMs = OBSERVABILITY_HEARTBEAT_MS,
): Promise<T> {
  let phase: "provider_waiting" | "provider_streaming" = "provider_waiting";
  const setPhase = (next: "provider_waiting" | "provider_streaming") => {
    if (phase === next) return;
    phase = next;
    ctx.progress(phase, operation);
  };
  ctx.progress(phase, operation);
  const timer = setInterval(() => ctx.progress(phase, operation, true), heartbeatIntervalMs);
  const cleanup = () => clearInterval(timer);
  ctx.signal.addEventListener("abort", cleanup, { once: true });
  return run(setPhase).finally(() => {
    cleanup();
    ctx.signal.removeEventListener("abort", cleanup);
  });
}

/** 运行中分析的澄清门（taskId → 当前轮 gate；多轮 D7） */
const gates = new Map<string, ClarificationGate>();

export interface PersistedAnalysisTaskInput {
  projectId: string;
  description: string;
  lab?: Record<string, unknown>;
}

export async function executeRequirementAnalysis(
  input: PersistedAnalysisTaskInput,
  ctx: import("@/src/ports/task-execution").TaskContext,
  deps: Pick<AnalysisCapabilityDeps, "persistence" | "ai" | "events" | "now" | "heartbeatIntervalMs">,
): Promise<void> {
  const analysisId = ctx.taskId;
  const lab = input.lab ?? {};
  const now = deps.now ?? (() => new Date());
  let failureEmitted = false;
  try {
    let status: ProviderStatus;
    try {
      status = await deps.ai.status();
    } catch {
      status = "unavailable";
    }
    if (status !== "available") {
      const safe = toSafeError(new ProviderUnavailableError());
      failureEmitted = true;
      ctx.emit({ type: "provider.unavailable", provider: deps.ai.name, projectId: input.projectId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), reason: safe.message });
      ctx.emit({
        type: "requirement.analysis.failed",
        projectId: input.projectId,
        analysisId,
        taskId: ctx.taskId,
        code: safe.code,
        message: safe.message,
        timestamp: now().toISOString(),
        reason: safe.message,
      });
      throw new ProviderUnavailableError("AI provider is unavailable");
    }

    ctx.emit({
      type: "requirement.analysis.started",
      projectId: input.projectId,
      analysisId,
      taskId: ctx.taskId,
    });

    let streamed = false;
    await withAnalyzeCapacity(() => withProviderPhase(ctx, "stream_text", (setPhase) => deps.ai.streamText({
      prompt: input.description,
      hint: lab,
      signal: ctx.signal,
      onChunk: (chunk) => {
        if (ctx.signal.aborted) return;
        if (!streamed && chunk.trim()) {
          streamed = true;
          setPhase("provider_streaming");
        }
        ctx.emit({
          type: "requirement.analysis.progress",
          projectId: input.projectId,
          analysisId,
          taskId: ctx.taskId,
          stage: "streaming",
          chunk,
          timestamp: now().toISOString(),
        });
      },
    }), deps.heartbeatIntervalMs));

    let roundId = 0;
    let output: RequirementAnalysisOutput | null = null;
    for (;;) {
      if (ctx.signal.aborted) throw new Error("analysis aborted");
      const { data } = await withAnalyzeCapacity(() => withProviderPhase(ctx, "generate_structured", () =>
          deps.ai.generateStructured<RequirementAnalysisOutput>({
            prompt: input.description,
            schema: "requirement-analysis",
            context: { ...lab, roundId },
            signal: ctx.signal,
          }),
          deps.heartbeatIntervalMs,
        ));
      output = data;
      ctx.progress("processing", "application");

      for (const cap of data.capabilities) {
        ctx.emit({
          type: "requirement.analysis.progress",
          projectId: input.projectId,
          analysisId,
          taskId: ctx.taskId,
          stage: "capabilities",
          chunk: JSON.stringify(cap),
          timestamp: now().toISOString(),
        });
      }

      if (!data.clarification) break;
      roundId += 1;
      if (ctx.signal.aborted) throw new Error("analysis aborted");

      let resolveGate!: (v: ClarificationAnswer) => void;
      const answerPromise = new Promise<ClarificationAnswer>((resolve) => {
        resolveGate = resolve;
      });
      const abortPromise = new Promise<never>((_, reject) =>
        ctx.signal.addEventListener("abort", () => reject(new Error("analysis aborted")), { once: true }),
      );
      gates.set(ctx.taskId, { roundId, answer: answerPromise, resolve: resolveGate });
      ctx.emit({
        type: "requirement.analysis.clarification.requested",
        projectId: input.projectId,
        analysisId,
        roundId,
        question: data.clarification.question,
        detail: data.clarification.detail,
      });
      await Promise.race([answerPromise, abortPromise]);
      gates.delete(ctx.taskId);
    }

    if (!output) throw new Error("analysis produced no output");
    await ctx.setOutput(JSON.stringify({ capabilities: output.capabilities }));

    if (output.proposals && output.proposals.length > 0) {
      const { createProposalsFromAnalysis } = await import("@/src/application/capabilities/proposals");
      if (ctx.signal.aborted) throw new Error("analysis aborted");
      await createProposalsFromAnalysis(
        { projectId: input.projectId, proposals: output.proposals, now },
        { persistence: deps.persistence, now },
      );
    }
    if (ctx.signal.aborted) throw new Error("analysis aborted");
    ctx.emit({
      type: "requirement.analysis.completed",
      projectId: input.projectId,
      analysisId,
      capabilities: output.capabilities,
    });
  } catch (err) {
    gates.delete(ctx.taskId);
    if (ctx.signal.aborted) {
      ctx.emit({
        type: "requirement.analysis.cancelled",
        projectId: input.projectId,
        analysisId,
      });
    } else {
      const safe = toSafeError(err);
      if (!failureEmitted) {
        if (err instanceof ProviderUnavailableError) {
          ctx.emit({ provider: deps.ai.name, type: "provider.unavailable", projectId: input.projectId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), reason: safe.message });
        }
        ctx.emit({
          type: "requirement.analysis.failed",
          projectId: input.projectId,
          analysisId,
          taskId: ctx.taskId,
          code: safe.code,
          message: safe.message,
          timestamp: now().toISOString(),
          reason: safe.message,
        });
        failureEmitted = true;
      }
    }
    throw err;
  }
}

export async function analyzeRequirement(
  input: { projectId: string; description: string; lab?: Record<string, unknown>; now?: () => Date; idempotency?: IdempotencyRequest },
  deps: AnalysisCapabilityDeps,
): Promise<{ taskId: string }> {
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    throw new InvalidDescriptionError();
  }
  if (input.description.length > MAX_REQUIREMENT_CHARS) {
    throw new ResourceLimitError("input_too_large");
  }
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new AnalysisNotFoundError();
  assertNotArchived(project);

  if (input.idempotency && deps.persistence.getIdempotencyRecord) {
    const existing = await deps.persistence.getIdempotencyRecord(input.idempotency.scope, input.idempotency.key);
    if (existing) {
      if (existing.requestHash !== input.idempotency.requestHash) throw new IdempotencyConflictError();
      return JSON.parse(existing.responseBodyJson) as { taskId: string };
    }
  }

  // 同步 Provider 可用性预检：不可用 → 立即 503（ISSUE-003 §10 ProviderUnavailable 合法降级；
  // 运行中故障走任务失败事件路径，两者并存——预检避免空转任务）
  let preStatus: ProviderStatus;
  try {
    preStatus = await deps.ai.status();
  } catch {
    preStatus = "unavailable";
  }
  if (preStatus !== "available") {
    throw new ProviderUnavailableError("AI provider is unavailable");
  }

  const taskInput = JSON.stringify({ projectId: input.projectId, description: input.description, lab: input.lab ?? {} });
  if (!input.idempotency) {
    const taskId = await deps.tasks.submit({ capability: "analyze_requirement", input: taskInput });
    return { taskId };
  }
  const taskId = randomUUID();
  const task = {
    id: taskId,
    capability: "analyze_requirement",
    input: taskInput,
    status: "queued" as const,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    startedAt: null,
    completedAt: null,
    error: null,
    output: null,
  } satisfies TaskRecord;
  const result = await deps.persistence.withTransaction((uow) => {
    if (!uow.claimIdempotency) throw new Error("Durable idempotency is unavailable");
    const claim = uow.claimIdempotency(input.idempotency!, 202, JSON.stringify({ taskId }));
    if (claim.kind === "conflict") throw new IdempotencyConflictError();
    if (claim.kind === "replay") return JSON.parse(claim.record.responseBodyJson) as { taskId: string };
    uow.saveTask(task);
    return { taskId };
  });
  if (result.taskId === taskId) await deps.tasks.submit({ capability: task.capability, input: task.input, taskId });

  return result;
}

export async function submitClarification(
  input: { taskId: string; roundId: number; answer?: string; skip?: boolean },
  deps: AnalysisCapabilityDeps,
): Promise<{ roundId: number }> {
  const task = await deps.tasks.getTask(input.taskId);
  if (!task) throw new AnalysisNotFoundError();
  const gate = gates.get(input.taskId);
  if (!gate) throw new NotAwaitingClarificationError();
  if (gate.roundId !== input.roundId) throw new InvalidRoundError(gate.roundId);
  gate.resolve({ answer: input.answer ?? null, skip: input.skip === true });
  return { roundId: input.roundId };
}

export async function cancelAnalysis(
  input: { taskId: string },
  deps: AnalysisCapabilityDeps,
): Promise<boolean> {
  return deps.tasks.cancel(input.taskId);
}

export async function getTask(
  input: { taskId: string },
  deps: AnalysisCapabilityDeps,
): Promise<TaskRecord | null> {
  return deps.tasks.getTask(input.taskId);
}
