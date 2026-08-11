// domain/models/project.ts — Project 聚合（domain-contract 6.1；I-10 归档语义）
// S1 只实现 Create Project 真正需要的最小形态；成员/云状态等一律不建。

import { randomUUID } from "node:crypto";
import type { ProjectDto } from "@/src/shared-contracts/types";

export const MAX_PROJECT_NAME_LENGTH = 200;

export class InvalidProjectNameError extends Error {
  constructor() {
    super("Project name must be non-empty after trimming (max 200 chars)");
    this.name = "InvalidProjectNameError";
  }
}

export class AlreadyArchivedError extends Error {
  constructor() {
    super("Project is already archived");
    this.name = "AlreadyArchivedError";
  }
}

export class ArchivedProjectError extends Error {
  constructor() {
    super("Archived project is read-only");
    this.name = "ArchivedProjectError";
  }
}

export type Project = ProjectDto;

export function createProject(name: string, now: () => Date = () => new Date()): Project {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new InvalidProjectNameError();
  }
  return {
    id: randomUUID(),
    name: trimmed,
    createdAt: now().toISOString(),
    archivedAt: null,
    archivedReason: null,
  };
}

export function archiveProject(p: Project, reason: string | null, now: () => Date = () => new Date()): Project {
  if (p.archivedAt !== null) throw new AlreadyArchivedError();
  return { ...p, archivedAt: now().toISOString(), archivedReason: reason };
}

export function assertNotArchived(p: Project): void {
  if (p.archivedAt !== null) throw new ArchivedProjectError();
}
