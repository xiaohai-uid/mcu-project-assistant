import React, { useCallback, useEffect, useState } from "react";
import type { CommercialReadinessReportDto, ReadinessGateDto } from "@/src/shared-contracts/types";
import { api as clientApi } from "../api/client";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { InfoBanner } from "./ui";

const gateTitleKey: Record<ReadinessGateDto["id"], "deliveryGateLocal" | "deliveryGateSimulation" | "deliveryGatePhysical" | "deliveryGatePaid"> = {
  "local-ready": "deliveryGateLocal",
  "simulation-ready": "deliveryGateSimulation",
  "physical-accepted": "deliveryGatePhysical",
  "paid-release-ready": "deliveryGatePaid",
};

const statusTone: Record<ReadinessGateDto["status"], string> = {
  ready: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  pending: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  blocked: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
  unavailable: "bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400",
};

function statusLabel(lang: "en" | "zh", status: ReadinessGateDto["status"]): string {
  return t(lang, {
    ready: "deliveryReady",
    pending: "deliveryPending",
    blocked: "deliveryBlocked",
    unavailable: "deliveryUnavailable",
  }[status] as "deliveryReady" | "deliveryPending" | "deliveryBlocked" | "deliveryUnavailable");
}

export const ReadinessView: React.FC = () => {
  const { state } = useApp();
  const { lang, project } = state;
  const [report, setReport] = useState<CommercialReadinessReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!project?.id) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      setReport(await clientApi.getReadinessReport(project.id, signal));
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const conclusionTone = report?.conclusion.status === "ready"
    ? "border-emerald-500/25 bg-emerald-500/5"
    : report?.conclusion.status === "blocked"
      ? "border-rose-500/25 bg-rose-500/5"
      : "border-amber-500/25 bg-amber-500/5";

  return (
    <div className="flex-1 px-6 py-6 max-w-[1100px] mx-auto flex flex-col gap-5 pb-20">
      <header className="flex items-center justify-between gap-3 mac-card p-4">
        <div>
          <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5">
            <span className="material-symbols-outlined text-sm">fact_check</span>
            <span>DELIVERY ROUTE / A</span>
          </div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "deliveryTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "deliverySubtitle")}</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading || !project} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs disabled:opacity-40">
          {loading ? "…" : t(lang, "deliveryRefresh")}
        </button>
      </header>

      {error && <InfoBanner icon="error" title={t(lang, "deliveryReportError")} desc="The saved evidence could not be read from the local workspace." lang={lang} tone="amber" />}
      {!project && <InfoBanner icon="folder_open" title="No project selected" desc="Create or open a project to inspect its delivery evidence." lang={lang} tone="blue" />}
      {loading && !report && <div className="mac-card p-6 text-xs text-[var(--text-secondary)]">Loading saved delivery evidence…</div>}

      {report && (
        <>
          <section className={`mac-card border p-5 ${conclusionTone}`}>
            <div className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-secondary)]">{t(lang, "deliveryConclusion")}</div>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mt-2">
              <div>
                <div className="text-2xl font-semibold text-[var(--text-primary)]">
                  {statusLabel(lang, report.conclusion.status)}
                </div>
                <p className="text-sm text-[var(--text-primary)] mt-1 max-w-2xl">{report.conclusion.text}</p>
              </div>
              <div className="text-xs md:text-right text-[var(--text-secondary)]">
                <div className="font-mono text-[10px] uppercase">{t(lang, "deliveryNextAction")}</div>
                <div className="mt-1 max-w-xs">{report.conclusion.nextAction ?? t(lang, "deliveryNoAction")}</div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {report.gates.map((gate) => (
              <article key={gate.id} className="mac-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)]">{gate.id}</div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)] mt-1">{t(lang, gateTitleKey[gate.id])}</h2>
                  </div>
                  <span className={`px-2 py-1 rounded border text-[10px] font-mono font-semibold ${statusTone[gate.status]}`}>{statusLabel(lang, gate.status)}</span>
                </div>
                {gate.reason && <p className="text-xs text-[var(--text-secondary)] mt-3">{gate.reason}</p>}
                {gate.nextAction && <p className="text-xs text-[var(--text-primary)] mt-2"><span className="font-semibold">{t(lang, "deliveryNextAction")}:</span> {gate.nextAction}</p>}
                <div className="mt-4 pt-3 border-t border-[var(--panel-border-subtle)]">
                  <div className="text-[10px] font-mono uppercase text-[var(--text-muted)] mb-2">{t(lang, "deliveryEvidence")}</div>
                  {gate.evidence.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-muted)]">{t(lang, "deliveryNoEvidence")}</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {gate.evidence.map((item) => (
                        <div key={`${item.kind}:${item.ref}`} className="rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] px-3 py-2">
                          <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                            <span>{item.kind}</span>
                            <time dateTime={item.observedAt}>{item.observedAt}</time>
                          </div>
                          <div className="text-[11px] font-mono text-[var(--text-primary)] mt-1 break-all">{item.ref}</div>
                          <div className="text-[11px] text-[var(--text-secondary)] mt-1">{item.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
};
