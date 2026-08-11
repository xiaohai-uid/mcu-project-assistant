// application/capabilities/projects.ts — Project 能力（application-contract 2.1）
// 显式 use-case 函数（禁止 CommandBus/Registry 框架；/commands 只是 transport 收口）。

import type { Project } from "@/src/domain/models/project";
import {
  archiveProject as domainArchive,
  createProject as domainCreate,
} from "@/src/domain/models/project";
import type { PersistencePort } from "@/src/ports/persistence";

export interface ProjectCapabilityDeps {
  persistence: PersistencePort;
}

export async function createProject(
  input: { name: string; now?: () => Date },
  deps: ProjectCapabilityDeps,
): Promise<Project> {
  const project = domainCreate(input.name, input.now);
  await deps.persistence.withTransaction((uow) => uow.createProject(project));
  return project;
}

export async function getProject(
  input: { id: string },
  deps: ProjectCapabilityDeps,
): Promise<Project | null> {
  return deps.persistence.getProject(input.id);
}

/** 活跃项目列表（归档移出活跃列表；记录保留） */
export async function listProjects(deps: ProjectCapabilityDeps): Promise<Project[]> {
  const all = await deps.persistence.listProjects();
  return all.filter((p) => p.archivedAt === null);
}

export async function archiveProject(
  input: { id: string; reason: string | null; now?: () => Date },
  deps: ProjectCapabilityDeps,
): Promise<Project | null> {
  const existing = await deps.persistence.getProject(input.id);
  if (!existing) return null;
  const archived = domainArchive(existing, input.reason, input.now);
  await deps.persistence.withTransaction((uow) =>
    uow.archiveProject(archived.id, archived.archivedAt!, archived.archivedReason),
  );
  return archived;
}
