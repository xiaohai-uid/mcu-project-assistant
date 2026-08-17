import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProductionStateOwnership } from "@/src/infrastructure/backup-restore";

const roots: string[] = [];

function expectOwnershipConflict(action: () => unknown): void {
  try {
    action();
    throw new Error("expected production_state_in_use");
  } catch (error) {
    expect(error).toMatchObject({ code: "production_state_in_use" });
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("production state ownership", () => {
  it("locks the database and workspace as one deterministic resource set", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-state-ownership-"));
    roots.push(root);
    const dbPath = join(root, "state", "mcu.db");
    const workspaceDir = join(root, "workspace");
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });

    const owner = acquireProductionStateOwnership(dbPath, workspaceDir);
    expectOwnershipConflict(() => acquireProductionStateOwnership(dbPath, workspaceDir));
    expectOwnershipConflict(() => acquireProductionStateOwnership(join(root, "other.db"), workspaceDir));
    const independent = acquireProductionStateOwnership(join(root, "other.db"), join(root, "other-workspace"));
    independent.release();
    owner.release();
  });

  it("does not let an old owner release a replacement lock", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-state-ownership-race-"));
    roots.push(root);
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    const first = acquireProductionStateOwnership(dbPath, workspaceDir);
    writeFileSync(`${dbPath}.state.lock`, JSON.stringify({ version: 1, ownerId: "replacement", pid: process.pid, createdAt: new Date().toISOString(), resourcePath: dbPath, resourceKind: "database" }), "utf8");
    first.release();
    expect(() => acquireProductionStateOwnership(dbPath, workspaceDir)).toThrow();
    rmSync(`${dbPath}.state.lock`, { force: true });
    const second = acquireProductionStateOwnership(dbPath, workspaceDir);
    second.release();
  });

  it("fails closed for malformed locks and does not reclaim a live unverified pid", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-state-ownership-lock-"));
    roots.push(root);
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    const lockPath = `${dbPath}.state.lock`;
    writeFileSync(lockPath, "not-json", "utf8");
    expectOwnershipConflict(() => acquireProductionStateOwnership(dbPath, workspaceDir));

    rmSync(lockPath);
    writeFileSync(lockPath, JSON.stringify({ version: 1, ownerId: "unknown", pid: process.pid, resourcePath: dbPath, resourceKind: "database" }), "utf8");
    expectOwnershipConflict(() => acquireProductionStateOwnership(dbPath, workspaceDir));
  });

  it("reclaims a lock from a previous process that reused the same pid", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-state-ownership-pid-reuse-"));
    roots.push(root);
    const dbPath = join(root, "state.db");
    const workspaceDir = join(root, "workspace");
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(
      `${dbPath}.state.lock`,
      JSON.stringify({
        version: 1,
        ownerId: "previous-process",
        pid: process.pid,
        createdAt: "2000-01-01T00:00:00.000Z",
        resourcePath: dbPath,
        resourceKind: "database",
      }),
      "utf8",
    );

    const owner = acquireProductionStateOwnership(dbPath, workspaceDir);

    owner.release();
  });

  it("blocks an existing workspace alias when the filesystem can create a junction", () => {
    const root = mkdtempSync(join(tmpdir(), "mcu-state-ownership-alias-"));
    roots.push(root);
    const dbA = join(root, "a.db");
    const dbB = join(root, "b.db");
    const workspace = join(root, "workspace");
    const alias = join(root, "workspace-alias");
    mkdirSync(workspace, { recursive: true });
    try {
      symlinkSync(workspace, alias, "junction");
    } catch {
      return;
    }
    const owner = acquireProductionStateOwnership(dbA, workspace);
    expectOwnershipConflict(() => acquireProductionStateOwnership(dbB, alias));
    owner.release();
  });
});
