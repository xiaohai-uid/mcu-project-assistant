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
import { assertNotArchived } from "@/src/domain/models/project";

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

/** 运行中分析的澄清门（taskId → 当前轮 gate；多轮 D7） */
const gates = new Map<string, ClarificationGate>();

export async function analyzeRequirement(
  input: { projectId: string; description: string; lab?: Record<string, unknown>; now?: () => Date },
  deps: AnalysisCapabilityDeps,
): Promise<{ taskId: string }> {
  if (typeof input.description !== "string" || input.description.trim().length === 0) {
    throw new InvalidDescriptionError();
  }
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new AnalysisNotFoundError();
  assertNotArchived(project);

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

  const taskId = await deps.tasks.submit(
    { capability: "analyze_requirement", input: input.description },
    async (ctx) => {
      const analysisId = ctx.taskId;
      const lab = input.lab ?? {};
      try {
        // Provider 可用性检查（合法降级：provider.unavailable 事件；不 fallback mock）
        let status: ProviderStatus;
        try {
          status = await deps.ai.status();
        } catch {
          status = "unavailable";
        }
        if (status !== "available") {
          deps.events.publish({ type: "provider.unavailable", provider: "mock", reason: "provider status != available" });
          deps.events.publish({
            type: "requirement.analysis.failed",
            projectId: input.projectId,
            analysisId,
            reason: "AI provider is unavailable",
          });
          throw new ProviderUnavailableError("AI provider is unavailable");
        }

        deps.events.publish({
          type: "requirement.analysis.started",
          projectId: input.projectId,
          analysisId,
          taskId: ctx.taskId,
        });

        // 流式文本（可取消）
        await deps.ai.streamText({
          prompt: input.description,
          hint: lab,
          signal: ctx.signal,
          onChunk: (chunk) => {
            if (ctx.signal.aborted) return;
            deps.events.publish({
              type: "requirement.analysis.progress",
              projectId: input.projectId,
              analysisId,
              stage: "streaming",
              chunk,
            });
          },
        });

        // 结构化输出：能力卡 + 多轮澄清（roundId 递增；D7）
        let roundId = 0;
        let output: RequirementAnalysisOutput | null = null;
        for (;;) {
          if (ctx.signal.aborted) throw new Error("analysis aborted");
          const { data } = await deps.ai.generateStructured<RequirementAnalysisOutput>({
            prompt: input.description,
            schema: "requirement-analysis",
            context: { ...lab, roundId },
            signal: ctx.signal,
          });
          output = data;

          for (const cap of data.capabilities) {
            deps.events.publish({
              type: "requirement.analysis.progress",
              projectId: input.projectId,
              analysisId,
              stage: "capabilities",
              chunk: JSON.stringify(cap),
            });
          }

          if (!data.clarification) break;
          roundId += 1;

          // await 间隙中可能已 abort（监听器尚未建立）→ 显式检查，避免错过取消
          if (ctx.signal.aborted) throw new Error("analysis aborted");

          // 澄清门：等待 submit_clarification（answer|skip）；取消 → 抛错终止任务
          let resolveGate!: (v: ClarificationAnswer) => void;
          const answerPromise = new Promise<ClarificationAnswer>((resolve) => {
            resolveGate = resolve;
          });
          const abortPromise = new Promise<never>((_, reject) =>
            ctx.signal.addEventListener("abort", () => reject(new Error("analysis aborted")), { once: true }),
          );
          gates.set(ctx.taskId, { roundId, answer: answerPromise, resolve: resolveGate });
          deps.events.publish({
            type: "requirement.analysis.clarification.requested",
            projectId: input.projectId,
            analysisId,
            roundId,
            question: data.clarification.question,
            detail: data.clarification.detail,
          });
          await Promise.race([answerPromise, abortPromise]);
          gates.delete(ctx.taskId);
          // answer 已通过 context.roundId 递增体现；skip 显式记录（默认规格选择）
        }

        if (!output) throw new Error("analysis produced no output");
        deps.events.publish({
          type: "requirement.analysis.completed",
          projectId: input.projectId,
          analysisId,
          capabilities: output.capabilities,
        });

        // S3B：分析完成后为每个形式化项产出提案（引用 base 版本，零写入；I-1 Proposal Gate）
        if (output.proposals && output.proposals.length > 0) {
          const { createProposalsFromAnalysis } = await import("@/src/application/capabilities/proposals");
          await createProposalsFromAnalysis(
            { projectId: input.projectId, proposals: output.proposals, now: input.now },
            { persistence: deps.persistence, now: input.now },
          );
        }
      } catch (err) {
        // 澄清门清理（取消/异常时不留 stale gate——内存泄漏防护）
        gates.delete(ctx.taskId);
        if (ctx.signal.aborted) {
          deps.events.publish({
            type: "requirement.analysis.cancelled",
            projectId: input.projectId,
            analysisId,
          });
        } else if (err instanceof ProviderUnavailableError) {
          // 运行中 provider 故障：显式降级事件（ADR-0010；不 fallback mock）
          deps.events.publish({ type: "provider.unavailable", provider: "mock", reason: err.message });
          deps.events.publish({
            type: "requirement.analysis.failed",
            projectId: input.projectId,
            analysisId,
            reason: err.message,
          });
        }
        throw err;
      }
    },
  );

  return { taskId };
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
