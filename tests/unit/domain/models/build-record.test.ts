// unit/domain/models/build-record — BuildRecord 状态机（ISSUE-009 §11）
// running→succeeded|failed|cancelled（单向终态；终态幂等）；D2：Build 是证据记录，不产生 Firmware 版本。
import { describe, expect, it } from "vitest";
import { createBuildRecord, finalizeBuildRecord } from "@/src/domain/models/build-record";

describe("BuildRecord 状态机（D2；I-6 失败也落记录）", () => {
  it("创建 = running（含结构化 options/工具链元数据）", () => {
    const r = createBuildRecord({
      id: "b1",
      artifactVersionId: "v1",
      taskId: "t1",
      target: "esp32-s3",
      toolchain: "esp32-arduino",
      toolchainVersion: "1.0.4",
      options: { srcDir: "src" },
      startedAt: "2026-08-11T12:00:00Z",
    });
    expect(r.status).toBe("running");
    expect(r.options).toEqual({ srcDir: "src" });
    expect(r.exitCode).toBeNull();
    expect(r.completedAt).toBeNull();
  });

  it("running → succeeded（exitCode 0 + 完成时间 + 日志 ref）", () => {
    const r = createBuildRecord({ id: "b1", artifactVersionId: "v1", taskId: "t1", target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: null, options: {}, startedAt: "t0" });
    const done = finalizeBuildRecord(r, { status: "succeeded", completedAt: "t1", stdoutRef: ".build/b1.log", exitCode: 0 });
    expect(done.status).toBe("succeeded");
    expect(done.stdoutRef).toBe(".build/b1.log");
  });

  it("running → failed（exitCode ≠ 0 也落记录——I-6）", () => {
    const r = createBuildRecord({ id: "b1", artifactVersionId: "v1", taskId: "t1", target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: null, options: {}, startedAt: "t0" });
    const done = finalizeBuildRecord(r, { status: "failed", completedAt: "t1", stdoutRef: null, exitCode: 2 });
    expect(done.status).toBe("failed");
    expect(done.exitCode).toBe(2);
  });

  it("终态幂等：已 succeeded 再 finalize 不改变（同决策重复 no-op）", () => {
    const r = createBuildRecord({ id: "b1", artifactVersionId: "v1", taskId: "t1", target: "esp32-s3", toolchain: "esp32-arduino", toolchainVersion: null, options: {}, startedAt: "t0" });
    const done = finalizeBuildRecord(r, { status: "succeeded", completedAt: "t1", stdoutRef: null, exitCode: 0 });
    const again = finalizeBuildRecord(done, { status: "failed", completedAt: "t2", stdoutRef: null, exitCode: 1 });
    expect(again.status).toBe("succeeded");
    expect(again.completedAt).toBe("t1");
  });
});
