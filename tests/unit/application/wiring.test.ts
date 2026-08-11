// unit/application/wiring — generate_pin_map / validate_wiring（application-contract 2.8/2.9；ISSUE-006 §11）
// Golden Journey：IO12 strapping 冲突 → issues；校验 warn（未运行≠通过，I-7）。
import { describe, expect, it } from "vitest";
import type { Artifact, ArtifactVersion } from "@/src/domain/models/artifact";
import type { Project } from "@/src/domain/models/project";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";
import type { EventPort, LogicalEvent } from "@/src/ports/events";
import type { PersistencePort, UnitOfWork } from "@/src/ports/persistence";
import { generatePinMap, validateWiring, latestValidation, NoHardwareSelectedError } from "@/src/application/capabilities/wiring";
import { createProject as createProjectCapability } from "@/src/application/capabilities/projects";
import { createArtifact as domainCreateArtifact } from "@/src/domain/models/artifact";
import { selectMcu } from "@/src/application/capabilities/mcu";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

interface FakeMem {
  projects: Map<string, Project>;
  artifacts: Map<string, Artifact>;
  versions: Map<string, ArtifactVersion>;
}

function fakePersistence(): PersistencePort & { mem: FakeMem } {
  const mem: FakeMem = { projects: new Map(), artifacts: new Map(), versions: new Map() };
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
        createVersion: (v) => {
          const dup = [...mem.versions.values()].some(
            (x) => x.artifactId === v.artifactId && x.versionNo === v.versionNo,
          );
          if (dup) throw new Error("UNIQUE constraint failed");
          mem.versions.set(v.id, v);
        },
        setVersionStatus: (id, status) => {
          const v = mem.versions.get(id);
          if (v) mem.versions.set(id, { ...v, status });
        },
        saveTask: () => {},
        updateTask: () => {},
        claimNextTask: () => null,
        createProposal: () => {},
        resolveProposal: () => {},
        createValidationRecord: (v) => {
          const key = `validation:${v.artifactVersionId}`;
          (mem as FakeMem & { validations: Map<string, unknown> }).validations.set(key, v);
        },
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
    getProposal: async () => null,
    listProposals: async () => [],
    latestValidation: async (versionId) =>
      ((mem as FakeMem & { validations: Map<string, unknown> }).validations.get(`validation:${versionId}`) as
        import("@/src/shared-contracts/types").ValidationRecordDto | undefined) ?? null,
  };
  (mem as FakeMem & { validations: Map<string, unknown> }).validations = new Map();
  return { ...port, mem };
}

function fakeContent(): ArtifactContentPort {
  const map = new Map<string, string>();
  return {
    store: async (ref, content) => {
      const key = `${ref.kind}/${String(ref.versionNo).padStart(4, "0")}.json`;
      map.set(key, content);
      return { contentRef: key, contentHash: `sha256:${content.length}` };
    },
    load: async (contentRef) => map.get(contentRef) ?? "",
    hash: async (c) => `sha256:${c.length}`,
  };
}

function fakeEvents(): EventPort & { published: LogicalEvent[] } {
  const published: LogicalEvent[] = [];
  return { publish: (e) => void published.push(e), published };
}

function deps() {
  const persistence = fakePersistence();
  const content = fakeContent();
  const events = fakeEvents();
  return { persistence, content, events, now };
}

/** 预置：项目 + requirements v1（能力）+ hardware v1（MCU） */
async function seedJourney(d: ReturnType<typeof deps>): Promise<Project> {
  const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
  // requirements artifact + v1
  const req = domainCreateArtifact({ projectId: project.id, kind: "requirements", now });
  await d.persistence.withTransaction((uow) => uow.createArtifact(req));
  await d.content.store(
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
      id: "req-v1",
      artifactId: req.id,
      versionNo: 1,
      contentRef: "requirements/0001.json",
      contentHash: "h",
      status: "accepted",
      sourceKind: "proposal",
      sourceProposalId: null,
      createdAt: NOW,
      createdBy: "owner",
    });
    uow.setCurrentVersion(req.id, "req-v1");
  });
  // hardware v1：ESP32-S3
  await selectMcu(
    { projectId: project.id, mcuId: "ESP32-S3" },
    { persistence: d.persistence, content: d.content, events: d.events },
  );
  return project;
}

describe("generate_pin_map（application-contract 2.8；Golden Journey）", () => {
  it("无 MCU → NoHardwareSelected（409 语义）", async () => {
    const d = deps();
    const project = await createProjectCapability({ name: "G", now }, { persistence: d.persistence });
    await expect(generatePinMap({ projectId: project.id }, d)).rejects.toThrow(NoHardwareSelectedError);
  });

  it("分配：土壤→IO4、继电器→IO12（strapping 冲突）、OLED→I2C 共享总线", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const result = await generatePinMap({ projectId: project.id }, d);

    const soil = result.pinMap.find((p) => p.component.includes("Soil"));
    const relay = result.pinMap.find((p) => p.component.includes("Pump"));
    expect(soil?.pinId).toBe("IO4");
    expect(soil?.type).toBe("Analog");
    expect(relay?.pinId).toBe("IO12"); // Golden Journey strapping 冲突触发点
    expect(relay?.type).toBe("Digital");
    // OLED 走 I2C 共享总线（IO8/IO9）
    expect(result.pinMap.some((p) => p.component.includes("OLED") && p.type === "I2C")).toBe(true);

    // issues：IO12 strapping warning（冲突卡数据源）
    const io12 = result.issues.find((i) => i.pinId === "IO12");
    expect(io12).toBeDefined();
    expect(io12?.severity).toBe("warning");
    expect(io12?.detail).toMatch(/flash/i);

    // Pin Map artifact v1
    expect(result.version.versionNo).toBe(1);
    expect(result.artifact.currentVersionId).toBe(result.version.id);
  });

  it("确定性：同输入同输出", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const r1 = await generatePinMap({ projectId: project.id }, d);
    const r2 = await generatePinMap({ projectId: project.id }, d);
    expect(JSON.stringify(r1.pinMap)).toBe(JSON.stringify(r2.pinMap));
  });
});

describe("validate_wiring（application-contract 2.9；I-7）", () => {
  it("IO12 strapping → warn（问题保留展示；未运行≠通过）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const { version } = await generatePinMap({ projectId: project.id }, d);
    const record = await validateWiring({ versionId: version.id }, d);
    expect(record.kind).toBe("electrical_rules");
    expect(record.result).toBe("warn"); // 有 warning → warn（非 pass）
    expect(record.diagnostics.some((x) => x.code === "STRAPPING_PIN_USAGE")).toBe(true);
  });

  it("latestValidation：新版本需新验证（I-7 验证历史按版本）", async () => {
    const d = deps();
    const project = await seedJourney(d);
    const { version } = await generatePinMap({ projectId: project.id }, d);
    const before = await latestValidation({ versionId: version.id }, d);
    expect(before).toBeNull(); // 未运行 ≠ 通过
    await validateWiring({ versionId: version.id }, d);
    const after = await latestValidation({ versionId: version.id }, d);
    expect(after?.result).toBe("warn");
  });

  it("干净引脚（IO12 换 IO21）→ pass", async () => {
    const d = deps();
    const project = await seedJourney(d);
    await generatePinMap({ projectId: project.id }, d);
    // 手动编辑：继电器 IO12 → IO21（S2 手动路径等价）
    const { commitManualEdit } = await import("@/src/application/capabilities/artifacts");
    const hw = await d.persistence.getArtifactByKind(project.id, "pinmap");
    const v2 = await commitManualEdit(
      {
        artifactId: hw!.id,
        content: JSON.stringify({
          pinMap: [
            { component: "Capacitive Soil Sensor", pinId: "IO4", type: "Analog" },
            { component: "5V Pump Relay Driver", pinId: "IO21", type: "Digital" },
            { component: "OLED Display", pinId: "IO8", type: "I2C" },
          ],
          issues: [],
        }),
      },
      { persistence: d.persistence, content: d.content, events: d.events },
    );
    const record = await validateWiring({ versionId: v2.id }, d);
    expect(record.result).toBe("pass");
  });
});
