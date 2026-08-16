import React, { useEffect } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { CommercialReadinessPrototype } from "./prototype/CommercialReadinessPrototype";

export const HardwareSelectionView: React.FC = () => {
  const { state, selectMcu, generatePins, setSidebar, refreshMcuCandidates } = useApp();
  const { lang, candidates, peripherals, selectedMcu, artifacts } = state;
  const prototypeEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("prototype") === "commercial-readiness";

  // S4：进入 Hardware 视图加载真实候选（knowledge 求值；ISSUE-005 §5/§12）
  useEffect(() => {
    if (!prototypeEnabled) void refreshMcuCandidates();
  }, [prototypeEnabled, refreshMcuCandidates]);

  if (prototypeEnabled) return <CommercialReadinessPrototype />;

  const hwAccepted = artifacts.hardware.version > 0;
  const pinmapStale = artifacts.pinmap.status === "stale";

  return (
    <div className="flex-1 px-6 py-6 max-w-[960px] mx-auto flex flex-col gap-5 pb-20">
      {/* Step Banner */}
      <div className="mac-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
            <span className="material-symbols-outlined text-[20px]">verified</span>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "hwValidatedTitle")}</h2>
            <p className="text-xs text-[var(--text-secondary)]">{t(lang, "hwStepSubtitle")}</p>
          </div>
        </div>

        <button
          onClick={() => {
            generatePins();
            setSidebar("Wiring");
          }}
          disabled={!selectedMcu}
          className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
        >
          <span>{t(lang, "configureWiring")}</span>
          <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
        </button>
      </div>

      {/* MCU 候选矩阵 */}
      <section className="mac-card p-5">
        <div className="mb-3.5">
          <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5">
            <span className="material-symbols-outlined text-sm">developer_board</span>
            <span>{t(lang, "hwMatrixCategory")}</span>
          </div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "selectMcuTitle")}</h2>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "selectMcuSubtitle")}</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {candidates.map((mcu) => {
            const isSelected = selectedMcu === mcu.id;
            let badgeText = t(lang, "recommended");
            if (mcu.badgeKey === "alternative") badgeText = t(lang, "alternative");
            if (mcu.badgeKey === "industrial") badgeText = t(lang, "industrial");
            return (
              <div
                key={mcu.id}
                onClick={() => selectMcu(mcu.id)}
                className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                  isSelected
                    ? "bg-[var(--control-bg)] border-[#007aff]/50 shadow-sm"
                    : "bg-[var(--panel-solid)] border-[var(--panel-border-subtle)] hover:bg-[var(--control-bg)]"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-md ${isSelected ? "bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff]" : "bg-[var(--control-bg)] text-[var(--text-secondary)]"}`}>
                      <span className="material-symbols-outlined text-[18px]">developer_board</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{mcu.title}</h3>
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-medium ${
                          isSelected
                            ? "bg-[#007aff]/10 border border-[#007aff]/30 text-[#007aff] dark:text-[#0a84ff]"
                            : "bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[var(--text-secondary)]"
                        }`}>
                          {badgeText}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">{mcu.core}</p>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      selectMcu(mcu.id);
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      isSelected ? "mac-button-primary" : "mac-button-secondary text-[var(--text-primary)]"
                    }`}
                  >
                    {isSelected ? t(lang, "selectedTarget") : t(lang, "selectCore")}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 my-2 font-mono text-[11px] text-[var(--text-secondary)] bg-[var(--control-bg)] p-2.5 rounded-md border border-[var(--panel-border-subtle)]">
                  <div>
                    <span className="text-[var(--text-muted)]">{t(lang, "wireless")}</span>{" "}
                    <span className="text-[var(--text-primary)]">{mcu.wireless}</span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">{t(lang, "flashSram")}</span>{" "}
                    <span className="text-[var(--text-primary)]">{mcu.flash}</span>
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <span className="text-[var(--text-muted)]">{t(lang, "ioMatrix")}</span>{" "}
                    <span className="text-[var(--text-primary)]">{mcu.gpio}</span>
                  </div>
                </div>

                {/* 约束检查（对照需求） */}
                {mcu.constraints && mcu.constraints.length > 0 && (
                  <div className="mb-1.5 flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-amber-500 uppercase">{t(lang, "hwConstraintNote")}</span>
                    {mcu.constraints.map((c, i) => (
                      <span key={i} className="text-[11px] font-mono text-amber-600 dark:text-amber-400">
                        ⚠️ {c}
                      </span>
                    ))}
                  </div>
                )}
                {mcu.constraints?.length === 0 && (
                  <span className="text-[10px] font-mono text-emerald-500 mb-1.5 block">✓ {t(lang, "hwConstraintOk")}</span>
                )}

                <p className="text-[11px] text-[var(--text-secondary)] italic">
                  {t(lang, "copilotAnalysis")} "{mcu.reason}"
                </p>
              </div>
            );
          })}
        </div>

        {/* MCU 更换 → Stale 提示 */}
        {hwAccepted && (
          <div className="mt-3 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400">
            ⚠️ {t(lang, "mcuChangeStales")}
            {pinmapStale && (
              <span className="block mt-1 font-mono text-[10px]">Pin Map / Wiring / Firmware / Build → {t(lang, "statusStale")}</span>
            )}
          </div>
        )}
      </section>

      {/* 外设预映射 */}
      <section className="mac-card p-5">
        <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5">
          <span className="material-symbols-outlined text-sm">sensors</span>
          <span>{t(lang, "systemTopologyCategory")}</span>
        </div>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{t(lang, "peripheralsTitle")}</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-3.5">{t(lang, "peripheralsSubtitle")}</p>

        <div className="grid grid-cols-1 gap-2.5">
          {peripherals.map((peri) => (
            <div key={peri.id} className="p-3 bg-[var(--control-bg)] rounded-lg border border-[var(--panel-border-subtle)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-1.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded shrink-0">
                  <span className="material-symbols-outlined text-[16px]">{peri.icon}</span>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">{peri.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="px-1.5 py-0.2 bg-[var(--panel-solid)] rounded border border-[var(--panel-border-subtle)] text-[10px] font-mono text-[#007aff] dark:text-[#0a84ff]">
                      {peri.type}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">{peri.pinsNeeded}</span>
                  </div>
                  {peri.warningNote && (
                    <span className="text-[10px] text-amber-500 font-mono block mt-0.5">⚠️ {peri.warningNote}</span>
                  )}
                </div>
              </div>
              <div className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded font-mono text-[11px] font-medium shrink-0">
                {peri.status}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
