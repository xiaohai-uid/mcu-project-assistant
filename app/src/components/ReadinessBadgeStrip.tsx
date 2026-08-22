import React from "react";
import type { ReadinessGateDto } from "@/src/shared-contracts/types";
import { useDeliveryGates } from "../state/deliveryReport";
import { t } from "../lib/i18n";
import { SEMANTIC_TONE } from "../lib/tone";
import type { Language } from "../types";

/**
 * R2（应用架构评审 2026-08-22）+ issues/09：三态就绪徽章。
 * 把 local-ready / simulation-ready / physical-accepted 从 Delivery 视图
 * 提升为全局状态语言——任何视图、项目卡都能以同一套紧凑徽章展示就绪态。
 * 数据一律来自 deliveryReport 共享 seam；数据缺失时静默隐藏（没有证据就不给颜色），不发明状态。
 */

const TRI_STATE_IDS = ["local-ready", "simulation-ready", "physical-accepted"] as const;

// 门状态 → 语义色调（共享表见 lib/tone）
const TONE: Record<ReadinessGateDto["status"], string> = {
  ready: SEMANTIC_TONE.positive,
  pending: SEMANTIC_TONE.pending,
  blocked: SEMANTIC_TONE.negative,
  unavailable: SEMANTIC_TONE.inactive,
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

/** 单门禁徽章：BOM 行 / 报告分区等只需「相关的那一枚门禁」的表面用。 */
export function ReadinessBadge({ gate, lang }: { gate: ReadinessGateDto; lang: Language }) {
  return (
    <span
      data-testid={`readiness-badge-${gate.id}`}
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
  );
}

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
        <ReadinessBadge key={gate.id} gate={gate} lang={lang} />
      ))}
    </div>
  );
}

/** 自取数据的便捷包装：Workspace 全局条、Home 项目卡、artifact 卡直接用它。 */
export function ReadinessGatesStrip({ projectId, lang, className }: {
  projectId: string | null | undefined;
  lang: Language;
  className?: string;
}) {
  const gates = useDeliveryGates(projectId);
  return <ReadinessBadgeStrip gates={gates} lang={lang} className={className} />;
}
