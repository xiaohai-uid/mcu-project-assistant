import type {
  ArtifactDto,
  ArtifactVersionDto,
  BuildRecordDto,
  ProjectDto,
  ProposalDto,
  TaskDto,
} from "../api/client";
import type { DeviceInfoDto, DeviceTruthDto } from "@/src/shared-contracts/types";
import type { BuildOutputEvidenceDto } from "@/src/shared-contracts/types";

export interface HydratedArtifact {
  artifact: ArtifactDto;
  versions: ArtifactVersionDto[];
  version: ArtifactVersionDto | null;
  content: string | null;
  builds: BuildRecordDto[];
}

export interface ProjectHydrationSnapshot {
  project: ProjectDto;
  artifacts: HydratedArtifact[];
  proposals: ProposalDto[];
  tasks: TaskDto[];
  staleMarks: Array<{ kind: string | null; level: string }>;
  device: { lastDevice: DeviceInfoDto | null };
  toolchain: { available: boolean | null };
}

export function hasVerifiedFirmwareOutput(build: {
  status: string;
  outputs: BuildOutputEvidenceDto[];
}): boolean {
  return build.status === "succeeded"
    && build.outputs.some((output) => output.kind === "bin" && output.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(output.sha256));
}

export function matchesBuildEvent(eventBuildId: string | null, currentBuildId: string | null): boolean {
  return eventBuildId !== null && eventBuildId === currentBuildId;
}

const TERMINAL = new Set<TaskDto["status"]>(["completed", "failed", "cancelled"]);

function time(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

/**
 * Merges a durable query with live state without allowing a stale refresh to
 * rewind a terminal task. A terminal conflict is resolved by completion time;
 * equal timestamps preserve the current value because it is the already-visible
 * truth from the live stream.
 */
export function mergeTaskTruth(current: TaskDto | null, incoming: TaskDto | null): TaskDto | null {
  if (!current) return incoming;
  if (!incoming) return current;
  if (current.id !== incoming.id) return time(incoming.createdAt) >= time(current.createdAt) ? incoming : current;

  const currentTerminal = TERMINAL.has(current.status);
  const incomingTerminal = TERMINAL.has(incoming.status);
  if (currentTerminal && !incomingTerminal) return current;
  if (!currentTerminal && incomingTerminal) return incoming;
  if (currentTerminal && incomingTerminal) {
    return time(incoming.completedAt) > time(current.completedAt) ? incoming : current;
  }
  return incoming;
}

export function latestTask(tasks: TaskDto[], capability: string): TaskDto | null {
  return tasks
    .filter((task) => task.capability === capability)
    .reduce<TaskDto | null>((latest, task) => {
      if (!latest) return task;
      return time(task.createdAt) >= time(latest.createdAt) ? task : latest;
    }, null);
}

export function parseAnalysisCapabilities(output: string | null): Array<{
  id: string;
  title: string;
  type: string;
  status: "complete" | "partial" | "pending";
  details: string;
  progress: number;
  icon: string;
  isWarning?: boolean;
}> {
  if (!output) return [];
  try {
    const value = JSON.parse(output) as { capabilities?: unknown };
    return Array.isArray(value.capabilities) ? value.capabilities.filter(isCapability) : [];
  } catch {
    return [];
  }
}

function isCapability(value: unknown): value is ReturnType<typeof parseAnalysisCapabilities>[number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.type === "string"
    && (item.status === "complete" || item.status === "partial" || item.status === "pending")
    && typeof item.details === "string"
    && typeof item.progress === "number"
    && typeof item.icon === "string";
}

export function parseTaskInput(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseFlashTruth(output: string | null): DeviceTruthDto | null {
  if (!output) return null;
  try {
    const value = JSON.parse(output) as { truth?: unknown };
    const truth = value.truth;
    if (!truth || typeof truth !== "object") return null;
    const item = truth as Record<string, unknown>;
    if ((item.executionReality === "simulation" || item.executionReality === "companion" || item.executionReality === "physical")
      && (item.verification === "verified" || item.verification === "blocked" || item.verification === "failed")
      && typeof item.physicalVerified === "boolean"
      && typeof item.adapter === "string") {
      return truth as DeviceTruthDto;
    }
    return null;
  } catch {
    return null;
  }
}
