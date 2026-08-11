import { describe, expect, it } from "vitest";
import {
  AlreadyArchivedError,
  ArchivedProjectError,
  InvalidProjectNameError,
  archiveProject,
  assertNotArchived,
  createProject,
} from "@/src/domain/models/project";

const NOW = "2026-08-11T12:00:00.000Z";
const now = () => new Date(NOW);

describe("Project 领域（domain-contract 6.1 / I-10）", () => {
  it("创建：合法名称生成 id/name/时间戳，未归档", () => {
    const p = createProject("Smart Greenhouse", now);
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.name).toBe("Smart Greenhouse");
    expect(p.createdAt).toBe(NOW);
    expect(p.archivedAt).toBeNull();
    expect(p.archivedReason).toBeNull();
  });

  it("创建：名称去空白后非空（invalid_name）", () => {
    expect(() => createProject("   ", now)).toThrow(InvalidProjectNameError);
    expect(() => createProject("", now)).toThrow(InvalidProjectNameError);
  });

  it("创建：名称按 trim 保存", () => {
    expect(createProject("  My Project  ", now).name).toBe("My Project");
  });

  it("创建：名称过长拒绝（>200）", () => {
    expect(() => createProject("x".repeat(201), now)).toThrow(InvalidProjectNameError);
    expect(createProject("x".repeat(200), now).name.length).toBe(200);
  });

  it("归档：active→archived 置时间戳与原因", () => {
    const p = createProject("A", now);
    const archived = archiveProject(p, "user request", now);
    expect(archived.archivedAt).toBe(NOW);
    expect(archived.archivedReason).toBe("user request");
  });

  it("归档：已归档再归档 → AlreadyArchived（幂等拒绝）", () => {
    const p = archiveProject(createProject("A", now), "r1", now);
    expect(() => archiveProject(p, "r2", now)).toThrow(AlreadyArchivedError);
  });

  it("归档后只读：assertNotArchived 拒绝（I-10 归档语义）", () => {
    const p = archiveProject(createProject("A", now), "r", now);
    expect(() => assertNotArchived(p)).toThrow(ArchivedProjectError);
    expect(() => assertNotArchived(createProject("A", now))).not.toThrow();
  });
});
