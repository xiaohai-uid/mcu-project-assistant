// unit/domain/services/dependency-evaluation — D5 判定表（stale-semantics §4；ISSUE-007 §11）
// 级别由 Change Classification + Dependency Relation 求值——禁止按 Artifact type 硬编码。
import { describe, expect, it } from "vitest";
import {
  classifyChange,
  evaluateStale,
  DEPENDENCY_EDGES,
  downstreamOf,
  transitiveDownstreamOf,
  type ChangeClassification,
} from "@/src/domain/services/dependency-evaluation";

describe("classifyChange（变化分类；输入①）", () => {
  it("MCU 变化（hardware 内容 selectedMcuId 变）→ hard-constraint-break", () => {
    const from = JSON.stringify({ selectedMcuId: "ESP32-S3" });
    const to = JSON.stringify({ selectedMcuId: "RP2040" });
    expect(classifyChange("hardware", from, to)).toBe("hard-constraint-break");
  });

  it("引脚分配变化（pinmap pinId 变）→ hard-constraint-break", () => {
    const from = JSON.stringify({ pinMap: [{ component: "Relay", pinId: "IO12" }] });
    const to = JSON.stringify({ pinMap: [{ component: "Relay", pinId: "IO21" }] });
    expect(classifyChange("pinmap", from, to)).toBe("hard-constraint-break");
  });

  it("需求能力变化 → semantic-possibly-valid（非 hard-break）", () => {
    const from = JSON.stringify({ capabilities: [{ id: "req-1" }] });
    const to = JSON.stringify({ capabilities: [{ id: "req-1" }, { id: "req-2" }] });
    expect(classifyChange("requirements", from, to)).toBe("semantic-possibly-valid");
  });

  it("固件内容变化 → semantic-possibly-valid（firmware changed ≠ 恒 Blocking——D5 禁类型硬编码）", () => {
    const from = JSON.stringify({ code: "void setup(){}" });
    const to = JSON.stringify({ code: "void setup(){pinMode(21,OUTPUT);}" });
    expect(classifyChange("firmware", from, to)).toBe("semantic-possibly-valid");
  });

  it("metadata-only（仅时间戳/版本号）→ metadata-only → L1", () => {
    const from = JSON.stringify({ pinMap: [{ component: "A", pinId: "IO4" }], note: "x" });
    const to = JSON.stringify({ pinMap: [{ component: "A", pinId: "IO4" }], note: "y" });
    expect(classifyChange("pinmap", from, to)).toBe("metadata-only");
  });
});

describe("evaluateStale（D5 判定表；输入②依赖关系）", () => {
  it("hard-constraint-break → L3 Blocking（MCU 变化下游）", () => {
    const eval1 = evaluateStale({
      classification: "hard-constraint-break",
      edge: { from: "hardware", to: "pinmap" },
      downstreamKind: "pinmap",
      downstreamHasContent: true,
    });
    expect(eval1?.level).toBe("L3");
    expect(eval1?.requiresRevalidation).toBe(true);
    expect(eval1?.reason).toMatch(/MCU|hard constraint/i);
  });

  it("semantic-possibly-valid → L2 Validation Required", () => {
    const eval2 = evaluateStale({
      classification: "semantic-possibly-valid",
      edge: { from: "firmware", to: "build" },
      downstreamKind: "build",
      downstreamHasContent: true,
    });
    expect(eval2?.level).toBe("L2");
    expect(eval2?.requiresRevalidation).toBe(true);
  });

  it("metadata-only → L1 Informational", () => {
    const eval3 = evaluateStale({
      classification: "metadata-only",
      edge: { from: "hardware", to: "pinmap" },
      downstreamKind: "pinmap",
      downstreamHasContent: true,
    });
    expect(eval3?.level).toBe("L1");
    expect(eval3?.requiresRevalidation).toBe(false);
  });

  it("同输入同输出（确定性）", () => {
    const input = {
      classification: "hard-constraint-break" as ChangeClassification,
      edge: { from: "hardware" as const, to: "pinmap" as const },
      downstreamKind: "pinmap" as const,
      downstreamHasContent: true,
    };
    expect(JSON.stringify(evaluateStale(input))).toBe(JSON.stringify(evaluateStale(input)));
  });

  it("下游无内容（从未生成）→ 不打标（无失效对象）", () => {
    const eval4 = evaluateStale({
      classification: "hard-constraint-break",
      edge: { from: "hardware", to: "firmware" },
      downstreamKind: "firmware",
      downstreamHasContent: false,
    });
    expect(eval4).toBeNull();
  });
});

describe("DEPENDENCY_EDGES（六边固定图；代码常量非表）", () => {
  it("六条边 seed（requirements→hardware→pinmap→wiring→firmware→build + →validation）", () => {
    const pairs = DEPENDENCY_EDGES.map((e) => `${e.from}→${e.to}`).sort();
    expect(pairs).toContain("requirements→hardware");
    expect(pairs).toContain("hardware→pinmap");
    expect(pairs).toContain("pinmap→wiring");
    expect(pairs).toContain("wiring→firmware");
    expect(pairs).toContain("firmware→build");
    expect(pairs).toContain("pinmap→validation");
  });

  it("downstreamOf：直接下游（一条边）", () => {
    expect(downstreamOf("hardware")).toEqual(["pinmap"]);
  });

  it("transitiveDownstreamOf：传递闭包（I-4 失效沿链传播；BFS 保序去重）", () => {
    expect(transitiveDownstreamOf("hardware").sort()).toEqual(["build", "firmware", "pinmap", "validation", "wiring"].sort());
    expect(transitiveDownstreamOf("pinmap").sort()).toEqual(["build", "firmware", "validation", "wiring"].sort());
    expect(transitiveDownstreamOf("wiring")).toEqual(["firmware", "build"]);
    expect(transitiveDownstreamOf("firmware")).toEqual(["build"]);
  });
});
