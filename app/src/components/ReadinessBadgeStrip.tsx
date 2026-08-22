import React, { useEffect, useState } from "react";
import type { ReadinessGateDto } from "@/src/shared-contracts/types";
import { api as clientApi } from "../api/client";
import { t } from "../lib/i18n";
import type { Language } from "../types";

/**
 * R2（应用架构评审 2026-08-22）：三态就绪徽章。
 * 把 local-ready / simulation-ready / physical-accepted 从 Delivery 视图
 * 提升为全局状态语言——任何视图、项目卡都能以同一套紧凑徽章展示就绪态。
 * 数据缺失时静默隐藏（没有证据就不给颜色），不发明状态。
 */

const TRI_STATE_IDS = ["local-ready", "simulation-ready", "physical-accepted"] as const;

const TONE: Record<ReadinessGateDto["status"], string> = {
  ready: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  blocked: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  unavailable: "bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400",
};

const GATE_LABEL_KEY: Record<(typeof TRI_STATE_IDS)[number], "deliveryGateLocal" | "deliveryGateSimulation" | "deliveryGatePhysical"> = {
  "local-ready": "deliveryGateLocal",
  "simulation-ready": "deliveryGateSimulation",
  "physical-accepted": "deliveryGatePhysical",
};

const STATUS_LABEL_KEY: Record<ReadinessGateDto["status"], "deliveryReady" | "deliveryPending" | "deliveryBlocked" | "deliveryUnavailable"> = {
  ready: "deliveryReady",
  pending: "deliveryPending",
  blocked: "deliveryBlocked",
  unavailable: "deliveryUnavailable",
};

export function ReadinessBadgeStrip({ gates, lang, className = "" }: {
  gates: readonly ReadinessGateDto[];
  lang: Language;
  className?: string;
}) {
  const triState = TRI_STATE_IDS
    .map((id) => gates.find((gate) => gate.id === id))
    .filter((gate): gate is ReadinessGateDto => Boolean(gate));
  if (triState.length === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`} data-testid="readiness-badge-strip">
      {triState.map((gate) => (
        <span
          key={gate.id}
          title={gate.reason ?? undefined}
          className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${TONE[gate.status]}`}
        >
          <span className="material-symbols-outlined text-[11px]">
            {gate.status === "ready" ? "check_circle" : gate.status === "blocked" ? "block" : "schedule"}
          </span>
          {t(lang, GATE_LABEL_KEY[gate.id as (typeof TRI_STATE_IDS)[number]])}
          {" · "}
          {t(lang, STATUS_LABEL_KEY[gate.status])}
        </span>
      ))}
    </div>
  );
}

/** 拉取项目交付门禁；失败或无项目时返回空数组（徽章整体隐藏）。 */
export function useDeliveryGates(projectId: string | null | undefined): ReadinessGateDto[] {
  const [gates, setGates] = useState<ReadinessGateDto[]>([]);
  useEffect(() => {
    if (!projectId) {
      setGates([]);
      return;
    }
    const controller = new AbortController();
    clientApi
      .getDeliveryReport(projectId, controller.signal)
      .then((report) => setGates(report.gates ?? []))
      .catch(() => setGates([]));
    return () => controller.abort();
  }, [projectId]);
  return gates;
}

/** 自取数据的便捷包装：Workspace 全局条、Home 项目卡直接用它。 */
export function ReadinessGatesStrip({ projectId, lang, className }: {
  projectId: string | null | undefined;
  lang: Language;
  className?: string;
}) {
  const gates = useDeliveryGates(projectId);
  return <ReadinessBadgeStrip gates={gates} lang={lang} className={className} />;
}
