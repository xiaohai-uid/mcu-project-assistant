// R4（应用架构评审 2026-08-22）：AI 权限三级表。
// 应用架构层的显式信任边界：AI 能自动做什么 / 必须提案什么 / 绝对不能碰什么。
// 本表是唯一事实源：HTTP 命令面用它做 fail-closed 强制校验，
// 设置页用它渲染用户可见的信任界面，测试用它断言边界不被悄悄突破。

import type { AiPermissionTier } from "@/src/shared-contracts/types";

export type { AiPermissionTier };

export interface AiPermissionEntry {
  capability: string;
  tier: AiPermissionTier;
  note: string;
}

/**
 * 命令面注册表（POST /projects/:id/commands 的 capability 分发）。
 * 约束：新增命令 capability 必须在此登记；未登记的 capability 运行时拒绝。
 */
export const AI_PERMISSION_TABLE: readonly AiPermissionEntry[] = [
  { capability: "recommend_mcu", tier: "auto-readonly", note: "Read-only candidate matrix; produces no artifact changes." },
  { capability: "analyze_requirement", tier: "proposal-required", note: "Produces a formalized proposal; user accepts/rejects item by item." },
  { capability: "select_mcu", tier: "proposal-required", note: "Hardware artifact changes go through proposals only." },
  { capability: "generate_pin_map", tier: "proposal-required", note: "Pin map changes go through proposals (conflict warnings included)." },
  { capability: "generate_firmware", tier: "proposal-required", note: "Firmware changes go through proposal + diff + impact notes." },
  { capability: "revalidate_artifact", tier: "proposal-required", note: "Revalidation results are never auto-accepted (D1); proposal only." },
];

/**
 * 绝对禁止 AI 经命令面触达的操作：物理世界与不可逆操作。
 * 这些操作各有独立的人工确认门禁（flash-token / archive-token）；
 * 登记为 forbidden 意味着任何人将来把这类操作挂进命令面时会被测试当场拦下。
 */
export const AI_FORBIDDEN_OPERATIONS: readonly AiPermissionEntry[] = [
  { capability: "flash_device", tier: "forbidden", note: "Flashing requires explicit human confirmation via one-shot device-bound token." },
  { capability: "archive_project", tier: "forbidden", note: "Archiving is irreversible; requires human confirmation token." },
  { capability: "modify_accepted_version", tier: "forbidden", note: "Accepted artifact versions are immutable (I-2); only new proposals allowed." },
];

const TIERS: ReadonlyMap<string, AiPermissionTier> = new Map(
  [...AI_PERMISSION_TABLE, ...AI_FORBIDDEN_OPERATIONS].map((entry) => [entry.capability, entry.tier]),
);

/** 未登记的 capability 返回 null（调用方必须 fail closed）。 */
export function aiPermissionFor(capability: string): AiPermissionTier | null {
  return TIERS.get(capability) ?? null;
}
