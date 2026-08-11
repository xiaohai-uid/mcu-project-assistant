// domain/services/dependency-evaluation.ts — 依赖求值服务（stale-semantics §3/§4；ISSUE-007 §3/§7）
// StaleLevel = f(Change Classification, Dependency Relation, Known Validation)——禁止按 Artifact type 硬编码级别。
// DEPENDENCY_EDGES 为代码常量（六条边 seed；spec §8 降表为常量）；StaleMark 只存当前态（无历史子系统）。

export type StaleLevel = "L1" | "L2" | "L3";
export type ChangeClassification = "metadata-only" | "semantic-possibly-valid" | "hard-constraint-break";

export interface DependencyEdge {
  from: string;
  to: string;
}

/** 六条边 seed（Requirements→Hardware→PinMap→Wiring→Firmware→Build/Validation） */
export const DEPENDENCY_EDGES: DependencyEdge[] = [
  { from: "requirements", to: "hardware" },
  { from: "hardware", to: "pinmap" },
  { from: "pinmap", to: "wiring" },
  { from: "wiring", to: "firmware" },
  { from: "firmware", to: "build" },
  { from: "pinmap", to: "validation" },
];

export function downstreamOf(from: string): string[] {
  return DEPENDENCY_EDGES.filter((e) => e.from === from).map((e) => e.to);
}

/** 传递闭包（BFS 沿边扩散；去重保序——先直接下游再链式下游；I-4 失效沿依赖链传播） */
export function transitiveDownstreamOf(from: string): string[] {
  const visited = new Set<string>();
  const queue = [...downstreamOf(from)];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    queue.push(...downstreamOf(cur));
  }
  return [...visited];
}

export interface StaleEvaluation {
  target: string;
  level: StaleLevel;
  reason: string;
  source: string;
  affectedVersionId: string | null;
  requiresRevalidation: boolean;
}

/**
 * 变化分类（输入①）：按内容语义比较——metadata 字段变化 → metadata-only；
 * 引脚/MCU 等硬约束变化 → hard-constraint-break；其余语义变化 → semantic-possibly-valid。
 * 判别规则：下游计算是否可能因该变化产生不同结果？（stale-semantics §2）
 */
export function classifyChange(kind: string, fromContent: string, toContent: string): ChangeClassification {
  let from: Record<string, unknown>;
  let to: Record<string, unknown>;
  try {
    from = JSON.parse(fromContent) as Record<string, unknown>;
    to = JSON.parse(toContent) as Record<string, unknown>;
  } catch {
    return "semantic-possibly-valid";
  }

  // 硬约束字段（变化 → 下游结果必变）
  const HARD_FIELDS: Record<string, string[]> = {
    hardware: ["selectedMcuId"],
    pinmap: ["pinMap"],
    wiring: ["pinMappings"],
  };
  const hardFields = HARD_FIELDS[kind] ?? [];
  for (const field of hardFields) {
    const a = JSON.stringify(from[field]);
    const b = JSON.stringify(to[field]);
    if (a !== b) return "hard-constraint-break";
  }

  // 语义内容字段（固件代码、需求能力集）
  const SEMANTIC_FIELDS: Record<string, string[]> = {
    firmware: ["code", "dependencies"],
    requirements: ["capabilities", "acceptedProposalIds"],
  };
  const semanticFields = SEMANTIC_FIELDS[kind] ?? [];
  for (const field of semanticFields) {
    const a = JSON.stringify(from[field]);
    const b = JSON.stringify(to[field]);
    if (a !== b) return "semantic-possibly-valid";
  }

  // 其余字段变化（备注/元数据）→ metadata-only
  if (JSON.stringify(from) !== JSON.stringify(to)) return "metadata-only";
  return "metadata-only";
}

/**
 * 级别判定（D5 判定表）：分类 + 依赖关系 → 级别。
 * 下游无内容（从未生成）→ 不打标（无失效对象）。
 */
export function evaluateStale(input: {
  classification: ChangeClassification;
  edge: DependencyEdge;
  downstreamKind: string;
  downstreamHasContent: boolean;
}): StaleEvaluation | null {
  if (!input.downstreamHasContent) return null; // 从未生成的下游无失效对象（不删除、不打标）

  const level: StaleLevel =
    input.classification === "hard-constraint-break"
      ? "L3"
      : input.classification === "semantic-possibly-valid"
        ? "L2"
        : "L1";

  const reasonMap: Record<ChangeClassification, string> = {
    "hard-constraint-break": `Hard constraint changed in ${input.edge.from} — ${input.downstreamKind} requires revalidation`,
    "semantic-possibly-valid": `Semantic change in ${input.edge.from} — ${input.downstreamKind} requires revalidation`,
    "metadata-only": `Metadata change in ${input.edge.from} — ${input.downstreamKind} marked informational`,
  };

  return {
    target: input.downstreamKind,
    level,
    reason: reasonMap[input.classification],
    source: input.edge.from,
    affectedVersionId: null,
    requiresRevalidation: level !== "L1",
  };
}
