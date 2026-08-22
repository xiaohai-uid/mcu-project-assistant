// state/deliveryReport — issues/09：交付门禁状态的唯一前端 seam。
// 徽章表面（artifact 卡 / BOM 行 / 报告分区 / Home 卡 / Workspace 条）一律从这里读，
// 任何视图不得自造门禁状态。同一项目任意数量的消费者只保留一次在途请求
// （code-review B8/c3：覆盖面扩大不倍增 /delivery-report 拉取，故无需批量化端点）。
// companion 动作（detect/upload/serial）经 refreshDeliveryGates() 原地传播新状态。
import { useEffect, useReducer } from "react";
import type { DeliveryReportDto, ReadinessGateDto } from "@/src/shared-contracts/types";
import { api as clientApi } from "../api/client";

export interface DeliveryReportSnapshot {
  report: DeliveryReportDto | null;
  loading: boolean;
  error: boolean;
}

interface StoreEntry extends DeliveryReportSnapshot {
  subs: Set<() => void>;
  inflight: Promise<void> | null;
}

const EMPTY: DeliveryReportSnapshot & { refresh: () => Promise<void> } = {
  report: null,
  loading: false,
  error: false,
  refresh: async () => {},
};

const stores = new Map<string, StoreEntry>();

function entryOf(projectId: string): StoreEntry {
  let e = stores.get(projectId);
  if (!e) {
    e = { report: null, loading: false, error: false, subs: new Set(), inflight: null };
    stores.set(projectId, e);
  }
  return e;
}

function notify(e: StoreEntry): void {
  for (const sub of e.subs) sub();
}

async function fetchInto(projectId: string, e: StoreEntry): Promise<void> {
  e.loading = true;
  e.error = false;
  notify(e);
  try {
    e.report = await clientApi.getDeliveryReport(projectId);
    e.error = false;
  } catch {
    e.error = true;
  } finally {
    e.loading = false;
    e.inflight = null;
    notify(e);
  }
}

/**
 * 失效并重取项目交付报告；所有已挂载消费者原地更新。
 * 在途请求去重——并发调用共享同一次网络往返。
 */
export function refreshDeliveryGates(projectId: string): Promise<void> {
  const e = entryOf(projectId);
  if (!e.inflight) e.inflight = fetchInto(projectId, e);
  return e.inflight;
}

/** 订阅共享报告快照。首个消费者触发拉取；后来者复用缓存与在途结果。 */
export function useDeliveryReport(
  projectId: string | null | undefined,
): DeliveryReportSnapshot & { refresh: () => Promise<void> } {
  const [, rerender] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    if (!projectId) return;
    const e = entryOf(projectId);
    const sub = (): void => rerender();
    e.subs.add(sub);
    if (!e.report && !e.inflight && !e.error) void refreshDeliveryGates(projectId);
    rerender(); // 渲染与订阅之间缓存可能已变化，同步一次
    return () => {
      e.subs.delete(sub);
    };
  }, [projectId]);
  if (!projectId) return EMPTY;
  const e = entryOf(projectId);
  return {
    report: e.report,
    loading: e.loading,
    error: e.error,
    refresh: () => refreshDeliveryGates(projectId),
  };
}

/** 门禁数组便捷视图：无报告或失败时为空（徽章整体隐藏，不发明状态）。 */
export function useDeliveryGates(projectId: string | null | undefined): ReadinessGateDto[] {
  const snap = useDeliveryReport(projectId);
  return snap.report?.gates ?? [];
}

/** 测试隔离辅助：清空模块级缓存（仅测试使用）。 */
export function __resetDeliveryReportCache(): void {
  stores.clear();
}
