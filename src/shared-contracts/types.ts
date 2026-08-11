// shared-contracts/types.ts — UI ↔ 核心共享类型（单一事实源，ADR-0013）
// S1 仅 Project；随 Slice 增长（禁止提前加入未来类型）

export interface ProjectDto {
  id: string;
  name: string;
  createdAt: string; // ISO8601 UTC
  archivedAt: string | null;
  archivedReason: string | null;
}
