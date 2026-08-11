// infrastructure/workspace.ts — workspace 文件镜像（ISSUE-001 §8；DB 为真相源，镜像 best-effort）
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@/src/domain/models/project";

function slugify(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "project"}-${id.slice(0, 8)}`;
}

export function projectWorkspaceDir(workspaceDir: string, project: Project): string {
  return join(workspaceDir, slugify(project.name, project.id));
}

/** 写 project.json 镜像；失败仅记录（不影响创建成功语义） */
export function writeProjectMirror(workspaceDir: string, project: Project): void {
  try {
    const dir = projectWorkspaceDir(workspaceDir, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2), "utf8");
  } catch (err) {
    console.warn("workspace mirror write failed (best-effort)", err);
  }
}
