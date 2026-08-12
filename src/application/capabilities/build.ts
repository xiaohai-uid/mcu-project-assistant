// application/capabilities/build.ts — run_build（application-contract 2.12；ISSUE-009 §3/§6）
// POST /projects/:id/builds → 202 {buildId}：BuildRecord（running）+ 任务执行（in-process）
// → CompilerPort 逐行输出（SSE build.output；.build/<buildId>.log 证据分离）→ 终态记录。
// D2：Build 不产生 Firmware 版本；I-6：失败也落记录；取消幂等（终态不再转）。
// L3 门禁（S5B）：run_build 被 BlockingStale 拒绝（I-8；门禁矩阵：生成固件/编译 L3 ❌）。
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNotArchived } from "@/src/domain/models/project";
import { createBuildRecord, finalizeBuildRecord, type BuildRecord } from "@/src/domain/models/build-record";
import type { CompilerPort } from "@/src/ports/compiler";
import { ToolchainUnavailableError } from "@/src/ports/compiler";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";
import type { BuildRecordDto, BuildStatusDto } from "@/src/shared-contracts/types";

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}

export class VersionNotFoundError extends Error {
  constructor() {
    super("Version not found");
    this.name = "VersionNotFoundError";
  }
}

export class BuildNotFoundError extends Error {
  constructor() {
    super("Build record not found");
    this.name = "BuildNotFoundError";
  }
}

export class BuildNotCancellableError extends Error {
  constructor() {
    super("Build is not cancellable (not running)");
    this.name = "BuildNotCancellableError";
  }
}

export interface BuildCapabilityDeps {
  persistence: PersistencePort;
  tasks: TaskExecutionPort;
  events: EventPort;
  compiler: CompilerPort;
  workspaceDir: string;
  now?: () => Date;
}

const TARGET = "esp32-s3";

/** 证据分离：大体积编译日志 → workspace .build/<buildId>.log（DB 只存 ref——相对 workspace 路径） */
function buildLogRef(buildId: string): string {
  return join(".build", `${buildId}.log`);
}

function appendLog(workspaceDir: string, buildId: string, line: string): void {
  const target = join(workspaceDir, buildLogRef(buildId));
  mkdirSync(join(workspaceDir, ".build"), { recursive: true });
  appendFileSync(target, `${line}\n`, "utf8");
}

export interface PersistedBuildTaskInput {
  buildId: string;
  projectId: string;
  versionId: string;
}

export async function executeBuildTask(
  input: PersistedBuildTaskInput,
  ctx: import("@/src/ports/task-execution").TaskContext,
  deps: Pick<BuildCapabilityDeps, "persistence" | "events" | "compiler" | "workspaceDir" | "now">,
  initialRecord?: BuildRecord,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const record = initialRecord ?? (await deps.persistence.getBuildRecord(input.buildId));
  if (!record) throw new BuildNotFoundError();
  const version = await deps.persistence.getVersion(record.artifactVersionId);
  if (!version) throw new VersionNotFoundError();
  const currentRecord = { ...record, taskId: ctx.taskId };
  await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(currentRecord));

  const request = {
    target: record.target,
    toolchain: "esp32-arduino" as const,
    options: record.options,
    firmwareRef: version.contentRef,
  };
  try {
    const result = await deps.compiler.build(
      request,
      (line) => {
        appendLog(deps.workspaceDir, input.buildId, line);
        ctx.emit({ type: "build.output", projectId: input.projectId, buildId: input.buildId, line });
      },
      ctx.signal,
    );
    const status: BuildStatusDto = ctx.signal.aborted ? "cancelled" : result.exitCode === 0 ? "succeeded" : "failed";
    const finalized = finalizeBuildRecord(currentRecord, {
      status,
      completedAt: now().toISOString(),
      stdoutRef: buildLogRef(input.buildId),
      exitCode: result.exitCode,
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    if (status === "succeeded") {
      ctx.emit({ type: "build.succeeded", projectId: input.projectId, buildId: input.buildId, exitCode: result.exitCode });
    } else if (status === "failed") {
      ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, exitCode: result.exitCode });
    } else {
      ctx.emit({ type: "build.cancelled", projectId: input.projectId, buildId: input.buildId });
    }
  } catch (err) {
    if (ctx.signal.aborted) {
      const finalized = finalizeBuildRecord(currentRecord, {
        status: "cancelled",
        completedAt: now().toISOString(),
        stdoutRef: buildLogRef(input.buildId),
        exitCode: 1,
      });
      await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
      ctx.emit({ type: "build.cancelled", projectId: input.projectId, buildId: input.buildId });
      return;
    }
    const finalized = finalizeBuildRecord(currentRecord, {
      status: "failed",
      completedAt: now().toISOString(),
      stdoutRef: buildLogRef(input.buildId),
      exitCode: 1,
      diagnostics: [{ code: "BUILD_START_FAILED", severity: "error", message: (err as Error).message }],
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, exitCode: 1 });
  }
}

export async function runBuild(
  input: { projectId: string; versionId: string; target?: string; toolchain?: string; options?: Record<string, unknown>; now?: () => Date },
  deps: BuildCapabilityDeps,
): Promise<{ buildId: string }> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();
  assertNotArchived(project);
  const version = await deps.persistence.getVersion(input.versionId);
  if (!version) throw new VersionNotFoundError();

  // I-8 / 门禁矩阵：L3 stale 下拒绝编译（S5B 门禁接入）
  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  await assertNotBlocking({ projectId: input.projectId, action: "run_build" }, deps);

  // 工具链发现（真实检测；缺失 → 503 ToolchainUnavailable）
  const toolchain = await deps.compiler.discoverToolchain();
  if (!toolchain.available) {
    throw new ToolchainUnavailableError(toolchain.reason ?? "Toolchain unavailable");
  }

  const buildId = randomUUID();
  const options = input.options ?? {};
  const request = {
    target: input.target ?? TARGET,
    toolchain: "esp32-arduino" as const,
    options: { ...options, srcDir: "src" },
    firmwareRef: version.contentRef,
  };

  // BuildRecord 先落库（running；任务执行期间可见/可取消）
  const startedAt = now().toISOString();
  const record = createBuildRecord({
    id: buildId,
    artifactVersionId: input.versionId,
    taskId: null,
    target: request.target,
    toolchain: request.toolchain,
    toolchainVersion: toolchain.version,
    options: request.options,
    startedAt,
  });
  await deps.persistence.withTransaction((uow) => uow.createBuildRecord(record));

  // 任务执行（ADR-0007 in-process）：逐行输出 → SSE + .build 日志；终态 → 记录 + 事件
  await deps.tasks.submit(
    { capability: "run_build", input: JSON.stringify({ buildId, projectId: input.projectId, versionId: input.versionId }) },
  );

  return { buildId };
}

export async function getBuildRecord(
  input: { buildId: string },
  deps: Pick<BuildCapabilityDeps, "persistence">,
): Promise<BuildRecord | null> {
  return deps.persistence.getBuildRecord(input.buildId);
}

export async function listBuilds(
  input: { versionId: string },
  deps: Pick<BuildCapabilityDeps, "persistence">,
): Promise<BuildRecordDto[]> {
  return deps.persistence.listBuilds(input.versionId);
}

export async function cancelBuild(
  input: { buildId: string },
  deps: Pick<BuildCapabilityDeps, "persistence" | "tasks">,
): Promise<{ buildId: string; status: "cancelled" }> {
  const record = await deps.persistence.getBuildRecord(input.buildId);
  if (!record) throw new BuildNotFoundError();
  if (record.status !== "running" || !record.taskId) throw new BuildNotCancellableError();
  const ok = await deps.tasks.cancel(record.taskId);
  if (!ok) throw new BuildNotCancellableError();
  // 终态（build.cancelled + 记录 cancelled）由任务处理器异步完成；此处返回确认
  return { buildId: input.buildId, status: "cancelled" };
}
