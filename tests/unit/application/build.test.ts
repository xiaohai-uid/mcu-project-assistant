// unit/application/build — run_build（application-contract 2.12；ISSUE-009 §11）
// 202 → BuildRecord running → 逐行输出（SSE build.output + .build 日志）→ 终态（succeeded/failed/cancelled）。
// D2 断言：Build 不产生 Firmware 版本；503 ToolchainUnavailable（真实检测）；L3 门禁 409。
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { Proposal } from "@/src/domain/models/proposal";
import type { Project } from "@/src/domain/models/project";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { StaleMarkDto } from "@/src/shared-contracts/types";
import { createWorkspaceFilesContent } from "@/src/adapters/artifact-content/workspace-files";
import { createMockCompiler, createUnavailableMockCompiler } from "@/src/adapters/compiler/mock";
import { createInProcessTasks } from "@/src/adapters/task/in-process";
import { createProductionTaskExecutor } from "@/src/infrastructure/task-runtime";
import { createNoopEvents } from "@/src/adapters/events/noop";
import { ToolchainUnavailableError } from "@/src/ports/compiler";
import { BuildExecutionError, BuildInputError, executeBuildTask, resolveBuildPaths, runBuild, getBuildRecord, listBuilds, cancelBuild } from "@/src/application/capabilities/build";
import { selectMcu } from "@/src/application/capabilities/mcu";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  proposals: Map<string, Proposal>;
  stale: Map<string, StaleMarkDto>;
  builds: Map<string, BuildRecord>;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcu-s7-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakePersistence(): PersistencePort & { mem: FakeMem } {
  const mem: FakeMem = {
    projects: new Map(),
    artifacts: new Map(),
    versions: new Map(),
    proposals: new Map(),
    stale: new Map(),
    builds: new Map(),
  };
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void mem.projects.set(p.id, p),
        archiveProject: () => {},
        getProject: (id) => mem.projects.get(id) ?? null,
        listProjects: () => [...mem.projects.values()],
        createArtifact: (a) => void mem.artifacts.set(a.id, a),
        setCurrentVersion: (artifactId, versionId) => {
          const a = mem.artifacts.get(artifactId);
          if (a) mem.artifacts.set(artifactId, { ...a, currentVersionId: versionId });
        },
        createVersion: (v) => void mem.versions.set(v.id, v),
        setVersionStatus: () => {},
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: (p) => void mem.proposals.set(p.id, p),
        resolveProposal: (p) => void mem.proposals.set(p.id, p),
        createValidationRecord: () => {},
        saveStaleMarks: (marks) => {
          for (const m of marks) mem.stale.set(m.id, m);
        },
        resolveStaleMarks: () => {},
        createBuildRecord: (b) => void mem.builds.set(b.id, b),
        updateBuildRecord: (b) => void mem.builds.set(b.id, b),
        setPreference: () => {},
      };
      return fn(uow);
    },
    getProject: async (id) => mem.projects.get(id) ?? null,
    listProjects: async () => [...mem.projects.values()],
    getArtifact: async (id) => mem.artifacts.get(id) ?? null,
    getArtifactByKind: async (projectId, kind) =>
      [...mem.artifacts.values()].find((a) => a.projectId === projectId && a.kind === kind) ?? null,
    listArtifacts: async (projectId) => [...mem.artifacts.values()].filter((a) => a.projectId === projectId),
    getVersion: async (id) => mem.versions.get(id) ?? null,
    listVersions: async (artifactId) =>
      [...mem.versions.values()].filter((v) => v.artifactId === artifactId).sort((a, b) => a.versionNo - b.versionNo),
    getTask: async () => null,
    latestTaskOutput: async () => null,
    getProposal: async (id) => mem.proposals.get(id) ?? null,
    listProposals: async (projectId) => [...mem.proposals.values()].filter((p) => p.projectId === projectId),
    latestValidation: async () => null,
    activeStaleMarks: async (projectId) =>
      [...mem.stale.values()].filter((m) => m.projectId === projectId && m.resolvedAt === null),
    getBuildRecord: async (id) => mem.builds.get(id) ?? null,
    listBuilds: async (versionId) => [...mem.builds.values()].filter((b) => b.artifactVersionId === versionId),
    getPreference: async () => null,
  };
  return { ...port, mem };
}

function deps(compiler = createMockCompiler()) {
  const persistence = fakePersistence();
  const content = createWorkspaceFilesContent(join(dir, "ws"));
  const events = createNoopEvents();
  const tasks = createInProcessTasks({ persistence, events });
  const buildDeps = { persistence, tasks, events, compiler, workspaceDir: join(dir, "ws"), now };
  tasks.setExecutor(createProductionTaskExecutor({ persistence, events, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler, workspaceDir: join(dir, "ws"), now }));
  return { persistence, content, events, tasks, buildDeps };
}

async function seedJourney(d: ReturnType<typeof deps>): Promise<{ project: Project; versionId: string }> {
  const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
  const req = domainCreateArtifact({ projectId: project.id, kind: "requirements", now });
  await d.persistence.withTransaction((uow) => uow.createArtifact(req));
  const reqStore = await d.content.store(
    { projectId: project.id, kind: "requirements", versionNo: 1 },
    JSON.stringify({
      capabilities: [
        { id: "req-1", title: "Soil moisture monitoring", status: "complete" },
        { id: "req-2", title: "Water pump control", status: "complete" },
        { id: "req-3", title: "Local status display", status: "complete" },
      ],
      acceptedProposalIds: [],
    }),
  );
  await d.persistence.withTransaction((uow) => {
    uow.createVersion({
      id: "req-v1", artifactId: req.id, versionNo: 1, contentRef: reqStore.contentRef,
      contentHash: reqStore.contentHash, status: "accepted", sourceKind: "proposal", sourceProposalId: null,
      createdAt: NOW, createdBy: "owner",
    });
    uow.setCurrentVersion(req.id, "req-v1");
  });
  await selectMcu(
    { projectId: project.id, mcuId: "ESP32-S3" },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  // 固件 v1（S6 接受路径的简化：直接手动提交占位固件）
  const fw = await d.persistence.getArtifactByKind(project.id, "firmware");
  if (!fw) {
    const { ensureArtifact, commitManualEdit } = await import("@/src/application/capabilities/artifacts");
    const fwArtifact = await ensureArtifact({ projectId: project.id, kind: "firmware" }, d);
    await commitManualEdit(
      { artifactId: fwArtifact!.id, content: JSON.stringify({ "src/main.cpp": "void setup(){}", "platformio.ini": "[env:esp32s3]" }) },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
  }
  const fwArtifact = await d.persistence.getArtifactByKind(project.id, "firmware");
  return { project, versionId: fwArtifact!.currentVersionId! };
}

const waitFor = async (fn: () => Promise<boolean>, ms = 2000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timeout");
};

describe("run_build（contract 2.12；D2 Build 不产生版本）", () => {
  it("编译成功 → BuildRecord succeeded + 逐行输出 + .build 日志；Firmware 版本数不变（D2）", async () => {
    const d = deps();
    const { project, versionId } = await seedJourney(d);
    const fwVersionsBefore = d.persistence.mem.versions.size;

    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    const record = await getBuildRecord({ buildId }, d.buildDeps);
    expect(record?.status).toBe("running");

    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "succeeded");
    const done = (await getBuildRecord({ buildId }, d.buildDeps))!;
    expect(done.exitCode).toBe(0);
    expect(done.sourceDir).toContain("firmware");
    expect(done.outputDir).toContain(buildId);
    expect(done.outputs).toHaveLength(1);
    expect(done.outputs[0]?.kind).toBe("bin");
    expect(done.outputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(done.stdoutRef).toContain(".build");
    expect(done.stdoutRef).toContain(buildId);
    // .build/<buildId>.log 真实存在（证据分离；DB 只存 ref）
    expect(existsSync(join(dir, "ws", done.stdoutRef!))).toBe(true);
    const log = readFileSync(join(dir, "ws", done.stdoutRef!), "utf8");
    expect(log).toContain("[OK] Build complete");
    expect(log.split("\n").length).toBeGreaterThan(3);
    // 同版本可多次构建（历史）
    const history = await listBuilds({ versionId }, d.buildDeps);
    expect(history.length).toBe(1);
    // D2：Build 不产生 Firmware 版本
    expect(d.persistence.mem.versions.size).toBe(fwVersionsBefore);
  });

  it("编译失败 → BuildRecord failed + exitCode（I-6 失败也落记录）", async () => {
    const d = deps(createMockCompiler({
      lines: ["$ arduino-cli compile ...", "[ERR] src/main.cpp:12:9: error: 'PUMP_RELAY_PIN' was not declared"],
      exitCode: 1,
    }));
    const { project, versionId } = await seedJourney(d);
    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "failed");
    const done = (await getBuildRecord({ buildId }, d.buildDeps))!;
    expect(done.exitCode).toBe(1);
    expect(done.status).toBe("failed");
  });

  it("取消：running 可取消 → build.cancelled；终态不可取消（幂等 409 语义）", async () => {
    const d = deps(createMockCompiler({ lines: ["line1", "line2", "line3", "line4", "line5", "line6", "line7", "line8", "line9", "line10"], lineDelayMs: 40 }));
    const { project, versionId } = await seedJourney(d);
    const { buildId } = await runBuild({ projectId: project.id, versionId }, d.buildDeps);
    await new Promise((r) => setTimeout(r, 60));
    const result = await cancelBuild({ buildId }, d.buildDeps);
    expect(result.status).toBe("cancelled");
    await waitFor(async () => (await getBuildRecord({ buildId }, d.buildDeps))?.status === "cancelled");
    // 取消幂等：终态再取消 → BuildNotCancellableError
    await expect(cancelBuild({ buildId }, d.buildDeps)).rejects.toThrow(/not cancellable/i);
  });

  it("工具链缺失 → ToolchainUnavailableError（503 语义；真实检测）", async () => {
    const d = deps(createUnavailableMockCompiler());
    const { project, versionId } = await seedJourney(d);
    await expect(runBuild({ projectId: project.id, versionId }, d.buildDeps)).rejects.toThrow(ToolchainUnavailableError);
  });

  it("同时存在多个固件版本时，只把请求版本的绝对 sourceDir 交给 compiler", async () => {
    const base = deps();
    const { project, versionId } = await seedJourney(base);
    const firmware = (await base.persistence.getArtifactByKind(project.id, "firmware"))!;
    const second = await base.content.store({ projectId: project.id, kind: "firmware", versionNo: 2, subpath: "src/main.cpp" }, "void setup(){ /* B */ }");
    const secondConfig = await base.content.store({ projectId: project.id, kind: "firmware", versionNo: 2, subpath: "platformio.ini" }, "[env:esp32s3]");
    await base.persistence.withTransaction((uow) => {
      uow.createVersion({ id: "firmware-v2", artifactId: firmware.id, versionNo: 2, contentRef: second.contentRef, contentHash: second.contentHash, status: "accepted", sourceKind: "manual", sourceProposalId: null, createdAt: NOW, createdBy: "owner" });
      void secondConfig;
    });
    const captured: string[] = [];
    const delegate = createMockCompiler();
    const compiler = {
      discoverToolchain: delegate.discoverToolchain,
      build: async (request: Parameters<typeof delegate.build>[0], onOutput: Parameters<typeof delegate.build>[1], signal: Parameters<typeof delegate.build>[2]) => {
        captured.push(request.sourceDir);
        return delegate.build(request, onOutput, signal);
      },
    };
    base.tasks.setExecutor(createProductionTaskExecutor({ persistence: base.persistence, events: base.events, ai: { name: "test", status: async () => "unavailable", streamText: async () => {}, generateStructured: async () => ({ data: {} }) } as never, compiler, workspaceDir: join(dir, "ws"), now }));
    const buildDeps = { ...base.buildDeps, compiler };
    const { buildId } = await runBuild({ projectId: project.id, versionId }, buildDeps);
    await waitFor(async () => (await getBuildRecord({ buildId }, buildDeps))?.status === "succeeded");
    const done = (await getBuildRecord({ buildId }, buildDeps))!;
    expect(done.artifactVersionId).toBe(versionId);
    expect(captured).toEqual([done.sourceDir]);
    expect(done.sourceDir).not.toContain("0002");
    expect(done.sourceDir).toContain("0001");
  });

  it("rejects missing and foreign firmware source paths before compiler execution", async () => {
    const workspace = join(dir, "ws");
    expect(() => resolveBuildPaths(workspace, "firmware/9999/src/main.cpp", "build-missing")).toThrow(BuildInputError);
    expect(() => resolveBuildPaths(workspace, "../outside/src/main.cpp", "build-escape")).toThrow(BuildInputError);
    expect(() => resolveBuildPaths(workspace, join(dir, "foreign", "src", "main.cpp"), "build-absolute")).toThrow(BuildInputError);

    const base = deps();
    const { project, versionId } = await seedJourney(base);
    const compiler = {
      discoverToolchain: base.buildDeps.compiler.discoverToolchain,
      build: async (...args: Parameters<typeof base.buildDeps.compiler.build>) => {
        throw new Error(`compiler must not run: ${args[0].sourceDir}`);
      },
    };
    const invalidVersion = { ...base.persistence.mem.versions.get(versionId)!, contentRef: "firmware/9999/src/main.cpp" };
    base.persistence.mem.versions.set(versionId, invalidVersion);
    await expect(runBuild({ projectId: project.id, versionId }, { ...base.buildDeps, compiler })).rejects.toBeInstanceOf(BuildInputError);
    expect(base.persistence.mem.builds.size).toBe(0);
  });

  it("clears stale output before a failed attempt so old firmware cannot become this build's evidence", async () => {
    const base = deps(createMockCompiler({ lines: [], exitCode: 7 }));
    const { project, versionId } = await seedJourney(base);
    const submitted: { buildId?: string } = {};
    const tasks = {
      submit: async (input: { capability: string; input: string }) => {
        submitted.buildId = (JSON.parse(input.input) as { buildId: string }).buildId;
        return "build-task";
      },
      cancel: async () => false,
      getTask: async () => null,
    };
    const buildDeps = { ...base.buildDeps, tasks };
    const { buildId } = await runBuild({ projectId: project.id, versionId }, buildDeps);
    expect(submitted.buildId).toBe(buildId);
    const record = (await getBuildRecord({ buildId }, buildDeps))!;
    mkdirSync(record.outputDir!, { recursive: true });
    const stale = join(record.outputDir!, "old.bin");
    writeFileSync(stale, "stale", "utf8");
    await expect(executeBuildTask(
      { buildId, projectId: project.id, versionId },
      { taskId: "build-task", mode: "new", signal: new AbortController().signal, emit: () => {}, progress: () => {}, setOutput: async () => {} },
      buildDeps,
    )).rejects.toBeInstanceOf(BuildExecutionError);
    const failed = (await getBuildRecord({ buildId }, buildDeps))!;
    expect(failed.status).toBe("failed");
    expect(failed.outputs).toEqual([]);
    expect(existsSync(stale)).toBe(false);
  });
});
