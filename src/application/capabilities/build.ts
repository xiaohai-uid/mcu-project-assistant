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
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";
import type { BuildRecordDto, BuildStatusDto } from "@/src/shared-contracts/types";
import { toSafeError } from "@/src/shared-contracts/errors";
import {
  assertExistingPathContained,
  assertParentContainedForWrite,
  assertSafeRelativeReference,
  resolveContainedPath,
} from "@/src/shared/filesystem-confinement";
import { MAX_BUILD_LOG_BYTES, ResourceLimitError, createResourceSemaphore } from "@/src/shared/resource-limits";
import type { IdempotencyRequest } from "@/src/shared/idempotency";
import { IdempotencyConflictError } from "@/src/shared/idempotency";
import { isRecord, parseIdempotencyResponse } from "@/src/shared/persistence-integrity";
import { ESP32_S3_REFERENCE_KIT_ID, resolveArduinoBuildProfile } from "@/src/domain/services/build-profile";
import { deriveLocalReady } from "@/src/domain/services/build-readiness";

function isBuildSubmissionResponse(value: unknown): value is { buildId: string; taskId?: string } {
  return isRecord(value) && typeof value.buildId === "string" && (value.taskId === undefined || typeof value.taskId === "string");
}

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
  content?: ArtifactContentPort;
  workspaceDir: string;
  now?: () => Date;
}

const TARGET = "esp32-s3";
const BUILD_OUTPUT_ROOT = ".build";

export function buildLogRef(buildId: string): string {
  const ref = join(BUILD_OUTPUT_ROOT, buildId, "build.log");
  assertSafeRelativeReference(ref);
  return ref;
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
  try {
    assertSafeRelativeReference(contentRef);
    assertSafeRelativeReference(join(BUILD_OUTPUT_ROOT, buildId, "output"));
  } catch {
    throw new BuildInputError("Firmware content reference or build output path is invalid");
  }
  if (!contentRef || isAbsolute(contentRef)) throw new BuildInputError("Firmware content reference must be a relative path");
  const sourceFile = resolveContainedPath(workspaceDir, resolve(workspaceDir, contentRef));
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
  try {
    assertExistingPathContained(workspaceDir, sourceDir);
    assertExistingPathContained(workspaceDir, sourceFile);
    assertParentContainedForWrite(workspaceDir, outputDir);
  } catch {
    throw new BuildInputError("Firmware source or output path escapes the configured workspace");
  }
  return { sourceDir, sourceFile, outputDir };
}

function appendLog(workspaceDir: string, buildId: string, line: string, currentBytes: { value: number }): void {
  const bytes = Buffer.byteLength(`${line}\n`, "utf8");
  if (currentBytes.value + bytes > MAX_BUILD_LOG_BYTES) throw new ResourceLimitError("process_output_limit_exceeded");
  const target = resolveContainedPath(workspaceDir, resolve(workspaceDir, buildLogRef(buildId)));
  assertParentContainedForWrite(workspaceDir, target);
  mkdirSync(dirname(target), { recursive: true });
  assertParentContainedForWrite(workspaceDir, target);
  appendFileSync(target, `${line}\n`, "utf8");
  currentBytes.value += bytes;
}

async function referenceKitIdForProject(
  projectId: string,
  deps: Pick<BuildCapabilityDeps, "persistence" | "content">,
): Promise<string | null> {
  if (!deps.content) return ESP32_S3_REFERENCE_KIT_ID;
  const hardware = await deps.persistence.getArtifactByKind(projectId, "hardware");
  if (!hardware?.currentVersionId) return null;
  const version = await deps.persistence.getVersion(hardware.currentVersionId);
  if (!version) return null;
  const content = await deps.content.load(version.contentRef).catch(() => "");
  try {
    const parsed = JSON.parse(content) as { referenceKit?: { id?: unknown } };
    return typeof parsed.referenceKit?.id === "string" ? parsed.referenceKit.id : null;
  } catch {
    return null;
  }
}

async function readinessForBuild(
  projectId: string,
  record: BuildRecord,
  status: BuildStatusDto,
  exitCode: number | null,
  outputs: BuildRecord["outputs"],
  persistence: PersistencePort,
  result?: Awaited<ReturnType<CompilerPort["build"]>>,
) {
  const pinmap = await persistence.getArtifactByKind(projectId, "pinmap");
  const validation = pinmap?.currentVersionId ? await persistence.latestValidation(pinmap.currentVersionId) : null;
  return deriveLocalReady({
    buildStatus: status,
    exitCode,
    outputs,
    toolchainEvidence: result?.evidence ?? record.toolchainEvidence,
    cliVersion: record.toolchainVersion,
    coreVersion: result?.toolchainCoreVersion ?? record.toolchainCoreVersion,
    wiringValidation: validation?.result ?? null,
  });
}

const buildResources = createResourceSemaphore(2);

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
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  if (!artifact || artifact.projectId !== input.projectId || artifact.kind !== "firmware") {
    throw new BuildInputError("Firmware version does not belong to the requested project");
  }
  const currentRecord = { ...record, taskId: ctx.taskId };
  await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(currentRecord));

  let paths: BuildPaths;
  const logBytes = { value: 0 };
  try {
    paths = resolveBuildPaths(deps.workspaceDir, version.contentRef, input.buildId);
    if (record.sourceDir && resolve(record.sourceDir) !== paths.sourceDir) throw new BuildInputError("Durable source binding changed");
    if (record.outputDir && resolve(record.outputDir) !== paths.outputDir) throw new BuildInputError("Build output binding changed");
  } catch (err) {
    const safe = toSafeError(err);
    const readiness = await readinessForBuild(input.projectId, currentRecord, "failed", 1, [], deps.persistence);
    const finalized = finalizeBuildRecord(currentRecord, {
      status: "failed", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: 1,
      diagnostics: diagnostic("BUILD_SOURCE_INVALID", safe.message),
      readinessStatus: readiness.status,
      readinessReasons: readiness.reasons,
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), exitCode: 1 });
    throw new BuildExecutionError("BUILD_SOURCE_INVALID", safe.message);
  }

  const lease = buildResources.tryAcquire();
  if (!lease) {
    const capacityError = new ResourceLimitError("resource_capacity_exceeded");
    const safe = toSafeError(capacityError);
    const readiness = await readinessForBuild(input.projectId, currentRecord, "failed", 1, [], deps.persistence);
    const finalized = finalizeBuildRecord(currentRecord, {
      status: "failed", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: 1,
      diagnostics: diagnostic(safe.code, safe.message),
      readinessStatus: readiness.status,
      readinessReasons: readiness.reasons,
    });
    await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
    ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), exitCode: 1 });
    throw capacityError;
  }

  try {
    assertParentContainedForWrite(deps.workspaceDir, paths.outputDir);
    rmSync(paths.outputDir, { recursive: true, force: true });
    mkdirSync(paths.outputDir, { recursive: true });
    assertExistingPathContained(deps.workspaceDir, paths.outputDir);
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
          appendLog(deps.workspaceDir, input.buildId, line, logBytes);
          ctx.emit({ type: "build.output", projectId: input.projectId, buildId: input.buildId, line });
        },
        ctx.signal,
      );
      if (ctx.signal.aborted) {
        const readiness = await readinessForBuild(input.projectId, currentRecord, "cancelled", result.exitCode, [], deps.persistence, result);
        const finalized = finalizeBuildRecord(currentRecord, {
          status: "cancelled", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result.exitCode,
          sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result.command, outputs: [],
          toolchainCoreVersion: result.toolchainCoreVersion ?? currentRecord.toolchainCoreVersion,
          toolchainEvidence: result.evidence ?? currentRecord.toolchainEvidence,
          readinessStatus: readiness.status,
          readinessReasons: readiness.reasons,
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
      const readiness = await readinessForBuild(input.projectId, currentRecord, status, result.exitCode, result.outputs, deps.persistence, result);
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
        toolchainCoreVersion: result.toolchainCoreVersion ?? currentRecord.toolchainCoreVersion,
        toolchainEvidence: result.evidence ?? currentRecord.toolchainEvidence,
        readinessStatus: readiness.status,
        readinessReasons: readiness.reasons,
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
        const readiness = await readinessForBuild(input.projectId, currentRecord, "cancelled", result?.exitCode ?? 1, [], deps.persistence, result ?? undefined);
        const finalized = finalizeBuildRecord(currentRecord, {
          status: "cancelled", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result?.exitCode ?? 1,
          sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result?.command ?? [], outputs: [],
          toolchainCoreVersion: result?.toolchainCoreVersion ?? currentRecord.toolchainCoreVersion,
          toolchainEvidence: result?.evidence ?? currentRecord.toolchainEvidence,
          readinessStatus: readiness.status,
          readinessReasons: readiness.reasons,
        });
        await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
        ctx.emit({ type: "build.cancelled", projectId: input.projectId, buildId: input.buildId });
        return;
      }
      const code = err instanceof ResourceLimitError ? err.code
        : err instanceof BuildTimeoutError ? "BUILD_TIMEOUT"
        : err instanceof BuildExecutionError ? err.diagnosticCode
          : err instanceof UnsupportedBuildTargetError ? "BUILD_TARGET_UNSUPPORTED" : "BUILD_EXECUTION_FAILED";
      const safe = toSafeError({ ...(typeof err === "object" && err !== null ? err : {}), diagnosticCode: code });
      if (!(err instanceof BuildExecutionError)) {
        const readiness = await readinessForBuild(input.projectId, currentRecord, "failed", result?.exitCode ?? 1, result?.outputs ?? [], deps.persistence, result ?? undefined);
        const finalized = finalizeBuildRecord(currentRecord, {
          status: "failed", completedAt: now().toISOString(), stdoutRef: buildLogRef(input.buildId), exitCode: result?.exitCode ?? 1,
          sourceDir: paths.sourceDir, outputDir: paths.outputDir, command: result?.command ?? [], outputs: result?.outputs ?? [],
          diagnostics: diagnostic(code, safe.message),
          toolchainCoreVersion: result?.toolchainCoreVersion ?? currentRecord.toolchainCoreVersion,
          toolchainEvidence: result?.evidence ?? currentRecord.toolchainEvidence,
          readinessStatus: readiness.status,
          readinessReasons: readiness.reasons,
        });
        await deps.persistence.withTransaction((uow) => uow.updateBuildRecord(finalized));
        ctx.emit({ type: "build.failed", projectId: input.projectId, buildId: input.buildId, taskId: ctx.taskId, code: safe.code, message: safe.message, timestamp: now().toISOString(), exitCode: result?.exitCode ?? 1 });
      }
      throw err;
    }
  } finally {
    lease.release();
  }
}

export async function runBuild(
  input: { projectId: string; versionId: string; target?: string; toolchain?: string; options?: Record<string, unknown>; now?: () => Date; idempotency?: IdempotencyRequest },
  deps: BuildCapabilityDeps,
): Promise<{ buildId: string }> {
  const now = deps.now ?? (() => new Date());
  const project = await deps.persistence.getProject(input.projectId);
  if (!project) throw new ProjectNotFoundError();
  assertNotArchived(project);
  const version = await deps.persistence.getVersion(input.versionId);
  if (!version) throw new VersionNotFoundError();
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  if (!artifact || artifact.projectId !== input.projectId || artifact.kind !== "firmware") throw new BuildInputError("Firmware version does not belong to the requested project");
  const target = input.target ?? TARGET;
  if (target !== TARGET) throw new UnsupportedBuildTargetError(target);

  if (input.idempotency && deps.persistence.getIdempotencyRecord) {
    const existing = await deps.persistence.getIdempotencyRecord(input.idempotency.scope, input.idempotency.key);
    if (existing) {
      if (existing.requestHash !== input.idempotency.requestHash) throw new IdempotencyConflictError();
      return parseIdempotencyResponse(existing.responseBodyJson, isBuildSubmissionResponse);
    }
  }

  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  await assertNotBlocking({ projectId: input.projectId, action: "run_build" }, deps);
  const referenceKitId = await referenceKitIdForProject(input.projectId, deps);
  if (deps.content && referenceKitId !== ESP32_S3_REFERENCE_KIT_ID) {
    throw new BuildInputError(`Exact Reference Kit identity required before build: ${ESP32_S3_REFERENCE_KIT_ID}`);
  }
  const profile = resolveArduinoBuildProfile(target, referenceKitId ?? ESP32_S3_REFERENCE_KIT_ID);
  const requestedOptions = input.options ?? {};
  if (Object.keys(requestedOptions).length > 0 && JSON.stringify(requestedOptions) !== JSON.stringify(profile.options)) {
    throw new BuildInputError("Pinned Arduino build options cannot be overridden");
  }
  const toolchain = await deps.compiler.discoverToolchain();
  if (!toolchain.available) throw new ToolchainUnavailableError(toolchain.reason ?? "Toolchain unavailable");

  const buildId = randomUUID();
  const taskId = randomUUID();
  const paths = resolveBuildPaths(deps.workspaceDir, version.contentRef, buildId);
  const options = {
    referenceKitId: profile.referenceKitId,
    fqbn: profile.fqbn,
    resolvedFqbn: profile.resolvedFqbn,
    corePackage: profile.corePackage,
    coreVersion: profile.coreVersion,
    fqbnOptions: { ...profile.options },
  };
  const record = createBuildRecord({
    id: buildId,
    artifactVersionId: input.versionId,
    taskId,
    target,
    toolchain: "esp32-arduino",
    toolchainVersion: toolchain.version,
    toolchainCoreVersion: toolchain.coreVersion ?? null,
    toolchainEvidence: toolchain.evidence ?? "unknown",
    options,
    startedAt: now().toISOString(),
    sourceDir: paths.sourceDir,
    outputDir: paths.outputDir,
  });
  const task = {
    id: taskId,
    capability: "run_build",
    input: JSON.stringify({ buildId, projectId: input.projectId, versionId: input.versionId }),
    status: "queued" as const,
    createdAt: record.startedAt,
    startedAt: null,
    completedAt: null,
    error: null,
    output: null,
  };
  const result = await deps.persistence.withTransaction((uow) => {
    if (input.idempotency) {
      if (!uow.claimIdempotency) throw new Error("Durable idempotency is unavailable");
      const claim = uow.claimIdempotency(input.idempotency, 202, JSON.stringify({ buildId, taskId }));
      if (claim.kind === "conflict") throw new IdempotencyConflictError();
      if (claim.kind === "replay") return parseIdempotencyResponse(claim.record.responseBodyJson, isBuildSubmissionResponse) as { buildId: string; taskId: string };
    }
    uow.createBuildRecord(record);
    uow.saveTask(task);
    return { buildId, taskId };
  });
  if (result.buildId === buildId) await deps.tasks.submit({ capability: task.capability, input: task.input, taskId });
  return { buildId: result.buildId };
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
