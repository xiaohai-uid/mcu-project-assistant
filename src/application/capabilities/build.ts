// application/capabilities/build.ts — run_build（application-contract 2.12；ISSUE-009 §3/§6）
// Build success is deliberately evidence-based: the exact durable firmware version,
// supported target, external process lifecycle, isolated output directory, and
// hashed firmware output must all be true before a build is considered succeeded.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertNotArchived } from "@/src/domain/models/project";
import { createBuildRecord, finalizeBuildRecord, type BuildRecord } from "@/src/domain/models/build-record";
import type { CompilerPort } from "@/src/ports/compiler";
import { BuildTimeoutError, ToolchainUnavailableError, UnsupportedBuildTargetError } from "@/src/ports/compiler";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";
import type { BuildRecordDto, BuildStatusDto } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";

export class ProjectNotFoundError extends Error {
  constructor() { super("Project not found"); this.name = "ProjectNotFoundError"; }
}

export class VersionNotFoundError extends Error {
  constructor() { super("Version not found"); this.name = "VersionNotFoundError"; }
}

export class BuildNotFoundError extends Error {
  constructor() { super("Build record not found"); this.name = "BuildNotFoundError"; }
}

export class BuildNotCancellableError extends Error {
  constructor() { super("Build is not cancellable (not running)"); this.name = "BuildNotCancellableError"; }
}

export class BuildInputError extends Error {
  readonly code = "BUILD_SOURCE_INVALID";
  constructor(message: string) { super(message); this.name = "BuildInputError"; }
}

export class BuildExecutionError extends Error {
  constructor(readonly diagnosticCode: string, message: string, readonly exitCode: number | null = 1) {
    super(message);
    this.name = "BuildExecutionError";
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
const BUILD_OUTPUT_ROOT = ".build";

export function buildLogRef(buildId: string): string {
  return join(BUILD_OUTPUT_ROOT, buildId, "build.log");
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export interface BuildPaths {
  sourceDir: string;
  sourceFile: string;
  outputDir: string;
}

/** Resolve only the firmware source layout; this is not a general filesystem sandbox. */
export function resolveBuildPaths(workspaceDir: string, contentRef: string, buildId: string): BuildPaths {
  if (!contentRef || isAbsolute(contentRef)) throw new BuildInputError("Firmware content reference must be a relative path");
  const sourceFile = resolve(workspaceDir, contentRef);
  if (!isWithin(workspaceDir, sourceFile) || !sourceFile.endsWith(`${sep}src${sep}main.cpp`)) {
    throw new BuildInputError("Firmware version does not resolve to workspace/src/main.cpp");
  }
  const sourceDir = dirname(sourceFile);
  const outputDir = resolve(workspaceDir, BUILD_OUTPUT_ROOT, buildId, "output");
  if (!isWithin(workspaceDir, sourceDir) || !isWithin(join(workspaceDir, BUILD_OUTPUT_ROOT), outputDir)) {
    throw new BuildInputError("Build source or output path escapes the configured workspace");
  }
  if (!existsSync(sourceFile) || !statSync(sourceFile).isFile()) throw new BuildInputError("Firmware source file is missing");
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) throw new BuildInputError("Firmware source directory is missing");
  return { sourceDir, sourceFile, outputDir };
}

function appendLog(workspaceDir: string, buildId: string, line: string): void {
  const target = join(workspaceDir, buildLogRef(buildId));
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${line}\n`, "utf8");
}

function diagnostic(code: string, message: string, details?: Record<string, unknown>) {
  return [{ code, severity: "error", message, ...(details ? { details } : {}) }];
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

  let paths: BuildPaths;
  try {
    paths = resolveBuildPaths(deps.workspaceDir, version.contentRef, input.buildId);
    if (record.sourceDir && resolve(record.sourceDir) !== paths.sourceDir) throw new BuildInputError("Durable source binding changed");
    if (record.outputDir && resolve(record.outputDir) !== paths.outputDir) throw new BuildInputError("Build output binding changed");
  } catch (err) {
    const safe = toSafeError(err);
    const finalized = finalizeBuildRecord(currentRecord, {
      status: "failed", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: 1,
      diagnostics: diagnostic("BUILD_SOURCE_INVALID", safe.message),
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), exitCode: 1 });
    throw new BuildExecutionError("BUILD_SOURCE_INVALID", safe.message);
  }

  rmSync(paths.outputDir, { recursive: true, force: true });
  mkdirSync(paths.outputDir, { recursive: true });
  const request = {
    target: record.target,
    toolchain: "esp32-arduino" as const,
    options: record.options,
    sourceDir: paths.sourceDir,
    outputDir: paths.outputDir,
  };
  let result: Awaited<ReturnType<CompilerPort["build"]>> | null = null;
  try {
    result = await deps.compiler.build(
      request,
      (line) => {
        appendLog(deps.workspaceDir, input.buildId, line);
        ctx.emit({ type: "build.output", projectId: input.projectId, buildId: input.buildId, line });
      },
      ctx.signal,
    );
    if (ctx.signal.aborted) {
      const finalized = finalizeBuildRecord(currentRecord, {
        status: "cancelled", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result.exitCode,
        sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result.command, outputs: [],
      });
      await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
      ctx.emit({ type: "build.cancelled", projectId: input.projectId, buildId: input.buildId });
      return;
    }
    const hasFirmware = result.outputs.some((output) => output.kind === "bin" && output.sizeBytes > 0 && output.sha256.length === 64);
    const status: BuildStatusDto = result.exitCode === 0 && hasFirmware ? "succeeded" : "failed";
    const failureCode = result.exitCode !== 0 ? "BUILD_EXIT_NONZERO" : "BUILD_OUTPUT_MISSING";
    const failureMessage = result.exitCode !== 0 ? "Firmware build failed" : "Firmware build produced no verified output";
    const failureSafe = toSafeError({ diagnosticCode: failureCode, message: failureMessage });
    const finalized = finalizeBuildRecord(currentRecord, {
      status,
      completedAt: now().toISOString(),
      stdoutRef: buildLogRef(input.buildId),
      exitCode: result.exitCode,
      sourceDir: paths.sourceDir,
      outputDir: paths.outputDir,
      command: result.command,
      outputs: result.outputs,
      diagnostics: status === "failed" ? diagnostic(failureCode, failureSafe.message) : [],
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    if (status === "succeeded") {
      ctx.emit({ type: "build.succeeded", projectId: input.projectId, buildId: input.buildId, exitCode: result.exitCode });
      return;
    }
    ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: failureSafe.code, message: failureSafe.message, timestamp: now().toISOString(), exitCode: result.exitCode });
    throw new BuildExecutionError(failureCode, failureMessage, result.exitCode);
  } catch (err) {
    if (ctx.signal.aborted) {
      const finalized = finalizeBuildRecord(currentRecord, {
        status: "cancelled", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result?.exitCode ?? 1,
        sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result?.command ?? [], outputs: [],
      });
      await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
      ctx.emit({ type: "build.cancelled", projectId: input.projectId, buildId: input.buildId });
      return;
    }
    const code = err instanceof BuildTimeoutError ? "BUILD_TIMEOUT"
      : err instanceof BuildExecutionError ? err.diagnosticCode
        : err instanceof UnsupportedBuildTargetError ? "BUILD_TARGET_UNSUPPORTED" : "BUILD_EXECUTION_FAILED";
    const safe = toSafeError({ ...(typeof err === "object" && err !== null ? err : {}), diagnosticCode: code });
    if (!(err instanceof BuildExecutionError)) {
      const finalized = finalizeBuildRecord(currentRecord, {
        status: "failed", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result?.exitCode ?? 1,
        sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result?.command ?? [], outputs: result?.outputs ?? [],
        diagnostics: diagnostic(code, safe.message),
      });
      await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
      ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), exitCode: result?.exitCode ?? 1 });
    }
    throw err;
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
  const target = input.target ?? TARGET;
  if (target !== TARGET) throw new UnsupportedBuildTargetError(target);

  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  await assertNotBlocking({ projectId: input.projectId, action: "run_build" }, deps);
  const toolchain = await deps.compiler.discoverToolchain();
  if (!toolchain.available) throw new ToolchainUnavailableError(toolchain.reason ?? "Toolchain unavailable");

  const buildId = randomUUID();
  const paths = resolveBuildPaths(deps.workspaceDir, version.contentRef, buildId);
  const options = input.options ?? {};
  const record = createBuildRecord({
    id: buildId,
    artifactVersionId: input.versionId,
    taskId: null,
    target,
    toolchain: "esp32-arduino",
    toolchainVersion: toolchain.version,
    options,
    startedAt: now().toISOString(),
    sourceDir: paths.sourceDir,
    outputDir: paths.outputDir,
  });
  await deps.persistence.withTransaction((uow) => uow.createBuildRecord(record));
  await deps.tasks.submit({ capability: "run_build", input: JSON.stringify({ buildId, projectId: input.projectId, versionId: input.versionId }) });
  return { buildId };
}

export async function getBuildRecord(input: { buildId: string }, deps: Pick<BuildCapabilityDeps, "persistence">): Promise<BuildRecord | null> {
  return deps.persistence.getBuildRecord(input.buildId);
}

export async function listBuilds(input: { versionId: string }, deps: Pick<BuildCapabilityDeps, "persistence">): Promise<BuildRecordDto[]> {
  return deps.persistence.listBuilds(input.versionId);
}

export async function cancelBuild(input: { buildId: string }, deps: Pick<BuildCapabilityDeps, "persistence" | "tasks">): Promise<{ buildId: string; status: "cancelled" }> {
  const record = await deps.persistence.getBuildRecord(input.buildId);
  if (!record) throw new BuildNotFoundError();
  if (record.status !== "running" || !record.taskId) throw new BuildNotCancellableError();
  const ok = await deps.tasks.cancel(record.taskId);
  if (!ok) throw new BuildNotCancellableError();
  return { buildId: input.buildId, status: "cancelled" };
}
