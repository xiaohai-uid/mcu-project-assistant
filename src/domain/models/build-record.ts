// domain/models/build-record.ts — BuildRecord（implementation-spec §13；ISSUE-009 §7）
// D2：Build 证据独立于版本（同版本可多次构建；Build **不产生 Firmware 版本**）。
// I-6：失败也落记录；状态机 running→succeeded|failed|cancelled（单向终态）。
import type { BuildRecordDto, BuildStatusDto } from "@/src/shared-contracts/types";

export type BuildRecord = BuildRecordDto;

export class IllegalBuildTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal build record transition: ${from} → ${to}`);
    this.name = "IllegalBuildTransitionError";
  }
}

export function createBuildRecord(input: {
  id: string; // 与 run_build 返回的 buildId 一致（日志/事件/记录同键）
  artifactVersionId: string;
  taskId: string | null;
  target: string;
  toolchain: string;
  toolchainVersion: string | null;
  options: Record<string, unknown>;
  startedAt: string;
}): BuildRecord {
  return {
    id: input.id,
    artifactVersionId: input.artifactVersionId,
    taskId: input.taskId,
    target: input.target,
    toolchain: input.toolchain,
    toolchainVersion: input.toolchainVersion,
    options: input.options,
    status: "running",
    startedAt: input.startedAt,
    completedAt: null,
    stdoutRef: null,
    stderrRef: null,
    exitCode: null,
    diagnostics: [],
  };
}

/** 终态化（running → 终态；终态不可再转——幂等返回原记录） */
export function finalizeBuildRecord(
  record: BuildRecord,
  input: { status: BuildStatusDto; completedAt: string; stdoutRef: string | null; exitCode: number | null; diagnostics?: BuildRecordDto["diagnostics"] },
): BuildRecord {
  if (record.status !== "running") return record; // 幂等：终态不再转
  return {
    ...record,
    status: input.status,
    completedAt: input.completedAt,
    stdoutRef: input.stdoutRef,
    exitCode: input.exitCode,
    diagnostics: input.diagnostics ?? record.diagnostics,
  };
}
