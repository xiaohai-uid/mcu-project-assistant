// unit/application/analyze-requirement — 需求分析能力（application-contract 2.2/2.3；ISSUE-003 §11）
// 流式事件序；多轮澄清 roundId；取消；重试幂等（新分析）；provider 降级；分析期间零 artifact 写入（I-12/D7）。
import { describe, expect, it } from "vitest";
import type { Project } from "@/src/domain/models/project";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import type { TaskContext, TaskExecutionPort, TaskRecord } from "@/src/ports/task-execution";
import type { AIProviderPort, StructuredRequest } from "@/src/ports/ai-provider";
import { ProviderUnavailableError } from "@/src/ports/ai-provider";
import { analyzeRequirement, submitClarification, cancelAnalysis, getTask } from "@/src/application/capabilities/analysis";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

// ---------- fakes ----------

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
  tasks: Map<string, TaskRecord>;
}

function fakePersistence(): PersistencePort & { mem: FakeMem } {
  const mem: FakeMem = { projects: new Map(), artifacts: new Map(), versions: new Map(), tasks: new Map() };
  const port: PersistencePort = {
    withTransaction: async <T>(fn: (uow: UnitOfWork) => T): Promise<T> => {
      const uow: UnitOfWork = {
        createProject: (p) => void mem.projects.set(p.id, p),
        archiveProject: (id, at, reason) => {
          const p = mem.projects.get(id);
          if (p) mem.projects.set(id, { ...p, archivedAt: at, archivedReason: reason });
        },
        getProject: (id) => mem.projects.get(id) ?? null,
        listProjects: () => [...mem.projects.values()],
        createArtifact: (a) => void mem.artifacts.set(a.id, a),
        setCurrentVersion: (artifactId, versionId) => {
          const a = mem.artifacts.get(artifactId);
          if (a) mem.artifacts.set(artifactId, { ...a, currentVersionId: versionId });
        },
        createVersion: (v) => void mem.versions.set(v.id, v),
        setVersionStatus: (id, status) => {
          const v = mem.versions.get(id);
          if (v) mem.versions.set(id, { ...v, status });
        },
        saveTask: (t) => void mem.tasks.set(t.id, t),
        updateTask: (t) => void mem.tasks.set(t.id, t),
        createProposal: () => {},
        resolveProposal: () => {},
        claimNextTask: () => {
          const t = [...mem.tasks.values()].find((x) => x.status === "queued");
          if (t) mem.tasks.set(t.id, { ...t, status: "running", startedAt: NOW });
          return t ? (mem.tasks.get(t.id) as TaskRecord) : null;
        },
      };
      return fn(uow);
    },
    getProject: async (id) => mem.projects.get(id) ?? null,
    listProjects: async () => [...mem.projects.values()],
    getArtifact: async (id) => mem.artifacts.get(id) ?? null,
    getArtifactByKind: async () => null,
    listArtifacts: async () => [],
    getVersion: async () => null,
    listVersions: async () => [],
    getTask: async (id) => mem.tasks.get(id) ?? null,
    latestTaskOutput: async () => null,
    getProposal: async () => null,
    listProposals: async () => [],
  };
  return { ...port, mem };
}

function fakeTasks(): TaskExecutionPort & { tasks: Map<string, TaskRecord> } {
  const tasks = new Map<string, TaskRecord>();
  const controllers = new Map<string, AbortController>();
  let seq = 0;
  return {
    tasks,
    async submit(input, fn) {
      const id = `task-${++seq}`;
      const record: TaskRecord = {
        id,
        capability: input.capability,
        input: input.input,
        status: "queued",
        createdAt: NOW,
        startedAt: null,
        completedAt: null,
        error: null,
        output: null,
      };
      tasks.set(id, record);
      // 立即执行（fake 同步语义，取消信号可中止）
      const ctrl = new AbortController();
      controllers.set(id, ctrl);
      const ctx: TaskContext = { taskId: id, signal: ctrl.signal, emit: () => {}, setOutput: async () => {} };
      tasks.set(id, { ...record, status: "running", startedAt: NOW });
      fn(ctx).then(
        () => {
          controllers.delete(id);
          tasks.set(id, { ...tasks.get(id)!, status: "completed", completedAt: NOW });
        },
        () => {
          controllers.delete(id);
          tasks.set(id, { ...tasks.get(id)!, status: "failed", completedAt: NOW, error: "run failed" });
        },
      );
      return id;
    },
    async cancel(taskId) {
      const t = tasks.get(taskId);
      const ctrl = controllers.get(taskId);
      if (!t || !ctrl || t.status !== "running") return false;
      ctrl.abort();
      tasks.set(taskId, { ...t, status: "cancelled", completedAt: NOW });
      return true;
    },
    async getTask(id) {
      return tasks.get(id) ?? null;
    },
  };
}

function fakeAi(): AIProviderPort & {
  chunks: string[];
  caps: Array<Record<string, unknown>>;
  fail: boolean;          // status() 不可用 → 同步 503
  failStream: boolean;    // status() 可用但流式中途失败 → 任务 failed + provider.unavailable 事件
  clarifyRounds: number;
} {
  return {
    chunks: ["Parsing…", "Detected analog sensing."],
    caps: [
      { id: "req-1", title: "Soil moisture", status: "complete" },
      { id: "req-3", title: "Display", status: "pending" },
    ],
    fail: false,
    failStream: false,
    clarifyRounds: 1,
    async status() {
      return this.fail ? "unavailable" : "available";
    },
    async streamText(req) {
      if (this.failStream) throw new ProviderUnavailableError("provider unavailable (mid-stream)");
      for (const c of this.chunks) {
        if (req.signal.aborted) throw new Error("aborted");
        req.onChunk(c);
      }
    },
    async generateStructured<T>(req: StructuredRequest): Promise<{ data: T }> {
      if (this.fail) throw new Error("provider unavailable");
      if (req.signal.aborted) throw new Error("aborted");
      const round = (req.context as { roundId?: number })?.roundId ?? 0;
      const done = round >= this.clarifyRounds;
      const data = {
        capabilities: this.caps.map((c) =>
          c.id === "req-3" && done ? { ...c, status: "complete" } : c
        ),
        clarification: done ? null : { question: "Which display size?", detail: '0.96" or 1.3"' },
      };
      return { data: data as T };
    },
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

async function seedProject(port: PersistencePort): Promise<Project> {
  return createProjectCapability({ name: "Greenhouse", now }, { persistence: port });
}

function deps(over: Partial<Parameters<typeof analyzeRequirement>[1]> = {}) {
  const persistence = fakePersistence();
  const tasks = fakeTasks();
  const ai = fakeAi();
  const events = fakeEvents();
  return {
    persistence,
    tasks,
    ai,
    events,
    now,
    ...over,
  } as Parameters<typeof analyzeRequirement>[1] & {
    persistence: ReturnType<typeof fakePersistence>;
    tasks: ReturnType<typeof fakeTasks>;
    ai: ReturnType<typeof fakeAi>;
    events: ReturnType<typeof fakeEvents>;
  };
}

describe("analyze_requirement（application-contract 2.2；I-12/D7）", () => {
  it("流式事件序：started → progress(streaming) → 能力卡 → clarification.requested(roundId=1)", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse monitor", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 20));

    const types = d.events.published.map((e) => e.type);
    expect(types[0]).toBe("requirement.analysis.started");
    expect(types).toContain("requirement.analysis.progress");
    expect(types).toContain("requirement.analysis.clarification.requested");
    expect(types).not.toContain("requirement.analysis.completed");
    const clar = d.events.published.find((e) => e.type === "requirement.analysis.clarification.requested");
    if (clar?.type === "requirement.analysis.clarification.requested") {
      expect(clar.roundId).toBe(1);
      expect(clar.analysisId).toBe(taskId);
    }
  });

  it("多轮澄清：回答 round1 → 再次 clarification round2 → 回答 → completed（D7 多轮）", async () => {
    const d = deps();
    d.ai.clarifyRounds = 2; // 两次澄清后才完成
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 10));

    await submitClarification({ taskId, roundId: 1, answer: "0.96 inch" }, d);
    await new Promise((r) => setTimeout(r, 10));
    const rounds = d.events.published.filter((e) => e.type === "requirement.analysis.clarification.requested");
    expect(rounds).toHaveLength(2);
    if (rounds[1]?.type === "requirement.analysis.clarification.requested") {
      expect(rounds[1].roundId).toBe(2);
    }
    await submitClarification({ taskId, roundId: 2, answer: "ok" }, d);
    await new Promise((r) => setTimeout(r, 10));
    const done = d.events.published.find((e) => e.type === "requirement.analysis.completed");
    expect(done).toBeDefined();
    if (done?.type === "requirement.analysis.completed") {
      expect(done.capabilities.every((c) => c.status === "complete")).toBe(true);
    }
  });

  it("分析期间零 artifact 写入（S3A 不写版本；I-12）", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 10));
    await submitClarification({ taskId, roundId: 1, answer: "0.96" }, d);
    await new Promise((r) => setTimeout(r, 10));
    expect(d.persistence.mem.artifacts.size).toBe(0);
    expect(d.persistence.mem.versions.size).toBe(0);
  });

  it("取消：终止流式输出，丢弃中间结果，不写 artifact（Cancellation）", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await cancelAnalysis({ taskId }, d);
    await new Promise((r) => setTimeout(r, 20));

    const types = d.events.published.map((e) => e.type);
    expect(types).toContain("requirement.analysis.cancelled");
    expect(types).not.toContain("requirement.analysis.completed");
    expect(d.persistence.mem.artifacts.size).toBe(0);
    expect(d.persistence.mem.versions.size).toBe(0);
  });

  it("Provider 不可用（预检）：立即拒绝（503 语义；ADR-0010），零任务", async () => {
    const d = deps();
    d.ai.fail = true;
    const project = await seedProject(d.persistence);
    await expect(
      analyzeRequirement({ projectId: project.id, description: "greenhouse", now }, d),
    ).rejects.toThrow(/unavailable/i);
    expect(d.persistence.mem.tasks.size).toBe(0);
  });

  it("Provider 运行中失败（mid-stream）：任务 failed + provider.unavailable + analysis.failed 事件（合法降级）", async () => {
    const d = deps();
    d.ai.failStream = true; // status() 可用，流式中途故障
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(d.events.published.some((e) => e.type === "provider.unavailable")).toBe(true);
    expect(d.events.published.some((e) => e.type === "requirement.analysis.failed")).toBe(true);
    const task = await getTask({ taskId }, d);
    expect(task?.status).toBe("failed");
  });

  it("重试：每次分析是新任务（幂等否；新 taskId），同描述可再发", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const a = await analyzeRequirement({ projectId: project.id, description: "x", now }, d);
    const b = await analyzeRequirement({ projectId: project.id, description: "x", now }, d);
    expect(a.taskId).not.toBe(b.taskId);
  });

  it("空描述 → 拒绝（400 语义）", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    await expect(
      analyzeRequirement({ projectId: project.id, description: "   ", now }, d),
    ).rejects.toThrow(/description/i);
  });

  it("项目不存在 → not found 语义", async () => {
    const d = deps();
    await expect(
      analyzeRequirement({ projectId: "missing", description: "x", now }, d),
    ).rejects.toThrow(/not found/i);
  });
});

describe("submit_clarification（application-contract 2.3）", () => {
  it("roundId 不符 → invalid_round（409 语义）", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 10));
    await expect(
      submitClarification({ taskId, roundId: 99, answer: "x" }, d),
    ).rejects.toThrow(/round/i);
  });

  it("skip：显式跳过（记录默认规格选择）→ 继续分析", async () => {
    const d = deps();
    const project = await seedProject(d.persistence);
    const { taskId } = await analyzeRequirement(
      { projectId: project.id, description: "greenhouse", now },
      d,
    );
    await new Promise((r) => setTimeout(r, 10));
    await submitClarification({ taskId, roundId: 1, skip: true }, d);
    await new Promise((r) => setTimeout(r, 10));
    const done = d.events.published.find((e) => e.type === "requirement.analysis.completed");
    expect(done).toBeDefined();
  });
});
