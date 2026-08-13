// unit/adapters/workspace-files — ArtifactContentPort 的 Workspace Files 实现（ADR-0006；ISSUE-002 §9/§11）
// store → <projectId>/<kind>/NNNN.json 原子写（临时文件→rename）；load 往返；hash = SHA-256；临时文件清理。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s2-fs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample = JSON.stringify({
  pins: [
    { component: "Capacitive Soil Sensor", pinId: "IO4", type: "Analog" },
    { component: "5V Pump Relay Driver", pinId: "IO12", type: "Digital" },
  ],
});

describe("WorkspaceFiles（ADR-0006）", () => {
  it("store：写入 <projectId>/<kind>/NNNN.json，返回 contentRef + SHA-256 hash", async () => {
    const port = createWorkspaceFilesContent(dir);
    const { contentRef, contentHash } = await port.store(
      { projectId: "p1", kind: "pinmap", versionNo: 1 },
      sample,
    );
    expect(contentRef).toBe("p1/pinmap/0001.json");
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = readFileSync(join(dir, contentRef), "utf8");
    expect(onDisk).toBe(sample);
  });

  it("load：往返一致", async () => {
    const port = createWorkspaceFilesContent(dir);
    const { contentRef } = await port.store({ projectId: "p1", kind: "pinmap", versionNo: 1 }, sample);
    const loaded = await port.load(contentRef);
    expect(loaded).toBe(sample);
  });

  it("原子写：目录中无残留临时文件；不同版本共存", async () => {
    const port = createWorkspaceFilesContent(dir);
    await port.store({ projectId: "p1", kind: "pinmap", versionNo: 1 }, "A");
    await port.store({ projectId: "p1", kind: "pinmap", versionNo: 2 }, "B");
    const files = readdirSync(join(dir, "p1", "pinmap")).sort();
    expect(files).toEqual(["0001.json", "0002.json"]);
    expect(readdirSync(join(dir, "p1", "pinmap")).filter((f) => f.includes(".tmp"))).toHaveLength(0);
    expect(existsSync(join(dir, "p1", "pinmap", "0001.json"))).toBe(true);
    expect(existsSync(join(dir, "p1", "pinmap", "0002.json"))).toBe(true);
  });

  it("hash：同内容同 hash；不同内容不同 hash", async () => {
    const port = createWorkspaceFilesContent(dir);
    const h1 = await port.hash("hello");
    const h2 = await port.hash("hello");
    const h3 = await port.hash("world");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);
  });

  it("load 不存在的 contentRef → 明确错误（不吞）", async () => {
    const port = createWorkspaceFilesContent(dir);
    await expect(port.load("pinmap/9999.json")).rejects.toThrow(/not found/i);
  });

  it("拒绝 traversal、absolute path、symlink read 与 project/subpath escape write", async () => {
    const port = createWorkspaceFilesContent(dir);
    const outside = mkdtempSync(join(tmpdir(), "mcu-s2-outside-"));
    try {
      const secret = join(outside, "secret.txt");
      writeFileSync(secret, "outside-secret", "utf8");
      await expect(port.load("../outside/secret.txt")).rejects.toThrow(/workspace|reference|unsafe/i);
      await expect(port.load(secret)).rejects.toThrow(/workspace|reference|unsafe/i);

      const linkDir = join(dir, "p1", "pinmap");
      mkdirSync(linkDir, { recursive: true });
      symlinkSync(secret, join(linkDir, "link.json"), "file");
      await expect(port.load("p1/pinmap/link.json")).rejects.toThrow(/symlink|workspace/i);

      await expect(port.store({ projectId: "../escaped", kind: "pinmap", versionNo: 1 }, "escape")).rejects.toThrow(/workspace|reference|unsafe/i);
      await expect(port.store({ projectId: "p1", kind: "pinmap", versionNo: 1, subpath: "../../escaped.txt" }, "escape")).rejects.toThrow(/workspace|reference|unsafe/i);
      expect(existsSync(join(dir, "..", "escaped"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("workspace root 缺失时也拒绝通过 symlink ancestor 创建到外部", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mcu-s2-root-outside-"));
    try {
      const linkedParent = join(dir, "linked-workspace-parent");
      symlinkSync(outside, linkedParent, "junction");
      const port = createWorkspaceFilesContent(join(linkedParent, "new-workspace"));
      await expect(port.store({ projectId: "p1", kind: "pinmap", versionNo: 1 }, "escape")).rejects.toThrow(/symlink|workspace/i);
      expect(existsSync(join(outside, "new-workspace"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
