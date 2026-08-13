// infrastructure/task-runtime.ts — restart-safe reconstruction of durable task inputs.
// The switch is deliberately explicit: persisted capabilities are product
// operations, not a generic command registry.
import { executeRequirementAnalysis, type PersistedAnalysisTaskInput } from "@/src/application/capabilities/analysis";
import { executeBuildTask, type PersistedBuildTaskInput } from "@/src/application/capabilities/build";
import type { CompilerPort } from "@/src/ports/compiler";
import type { AIProviderPort } from "@/src/ports/ai-provider";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskContext, TaskRecord } from "@/src/ports/task-execution";
import { executeFlashTask, type FlashTaskDeps } from "@/src/application/capabilities/flash";
import type { DevicePort } from "@/src/ports/device";
import type { FlashTokenStore } from "@/src/application/capabilities/flash";
import { isRecord, parsePersistedJson } from "@/src/shared/persistence-integrity";

export interface ProductionTaskRuntimeDeps {
  persistence: PersistencePort;
  events: EventPort;
  ai: AIProviderPort;
  compiler: CompilerPort;
  workspaceDir: string;
  now?: () => Date;
  heartbeatIntervalMs?: number;
  device?: DevicePort;
  tokens?: FlashTokenStore;
}

function parseInput<T>(task: TaskRecord): T {
  return parsePersistedJson(task.input, "task", task.id, "input", isRecord) as T;
}

/**
 * Rebuilds the same application capability handlers used by normal requests.
 * Flash is intentionally fail-safe: its confirmation token and device session
 * are process-local and must never be replayed after a crash.
 */
export function createProductionTaskExecutor(deps: ProductionTaskRuntimeDeps) {
  return async (task: TaskRecord, ctx: TaskContext): Promise<void> => {
    switch (task.capability) {
      case "analyze_requirement":
        if (ctx.mode === "recovery") {
          throw Object.assign(new Error("Analysis was interrupted and cannot be safely replayed"), { code: "analysis_recovery_unsafe_replay" });
        }
        return executeRequirementAnalysis(parseInput<PersistedAnalysisTaskInput>(task), ctx, deps);
      case "run_build":
        return executeBuildTask(parseInput<PersistedBuildTaskInput>(task), ctx, deps);
      case "flash_device":
        if (ctx.mode === "recovery") {
          throw new Error("TASK_RECOVERY_UNSAFE_REPLAY: flash_device requires fresh confirmation and a live device session");
        }
        if (!deps.device || !deps.tokens) throw new Error("Flash task runtime dependencies are not configured");
        return executeFlashTask(parseInput(task), ctx, {
          persistence: deps.persistence,
          events: deps.events,
          device: deps.device,
          tokens: deps.tokens,
          workspaceDir: deps.workspaceDir,
          now: deps.now,
        } satisfies FlashTaskDeps);
      default:
        throw new Error(`No recovery executor for persisted task capability: ${task.capability}`);
    }
  };
}
