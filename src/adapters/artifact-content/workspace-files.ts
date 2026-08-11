// adapters/artifact-content/workspace-files.ts — ArtifactContentPort → Workspace Files（ADR-0006；ISSUE-002 §8）
// 版本目录原子写：临时文件 → rename（同文件系统原子）；无残留临时文件。
// 内容布局：<workspace>/<projectId>/<kind>/NNNN.json（内容本体 = 工作区文件，SQLite 只存引用）。
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArtifactContentPort, VersionRef } from "@/src/ports/artifact-content";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createWorkspaceFilesContent(workspaceDir: string): ArtifactContentPort {
  return {
    async store(ref: VersionRef, content: string): Promise<{ contentRef: string; contentHash: string }> {
      const contentRef = `${ref.projectId}/${ref.kind}/${String(ref.versionNo).padStart(4, "0")}.json`;
      const target = join(workspaceDir, contentRef);
      mkdirSync(dirname(target), { recursive: true });
      // 原子写：临时文件 → rename（同目录同文件系统）
      const tmp = join(dirname(target), `.tmp-${randomBytes(6).toString("hex")}`);
      try {
        writeFileSync(tmp, content, "utf8");
        renameSync(tmp, target);
      } catch (err) {
        rmSync(tmp, { force: true }); // 失败清理临时文件
        throw err;
      }
      return { contentRef, contentHash: sha256(content) };
    },
    async load(contentRef: string): Promise<string> {
      const target = join(workspaceDir, contentRef);
      try {
        return readFileSync(target, "utf8");
      } catch {
        throw new Error(`Artifact content not found: ${contentRef}`);
      }
    },
    async hash(content: string): Promise<string> {
      return sha256(content);
    },
  };
}
