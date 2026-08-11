import React, { useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { InfoBanner, StreamingDots } from "./ui";

export const FirmwareView: React.FC = () => {
  const { state, generateFirmware, acceptFirmwareProposal, rejectFirmwareProposal } = useApp();
  const { lang, firmware, artifacts } = state;
  const [copied, setCopied] = useState(false);

  const fw = firmware;
  const fwStale = artifacts.firmware.status === "stale";
  const relayPin = state.wiring.pinMappings.find((p) => p.component.includes("Pump"))?.pinId ?? "—";

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 px-6 py-6 max-w-[960px] mx-auto flex flex-col gap-5 pb-20">
      {/* Header */}
      <div className="mac-card p-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold">
              <span className="material-symbols-outlined text-sm">terminal</span>
              <span>{t(lang, "firmwareTab")}</span>
            </div>
            {fwStale ? (
              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                {t(lang, "statusStale")}
              </span>
            ) : fw.version > 0 ? (
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium font-mono">
                {t(lang, "firmwareVersion").replace("{version}", String(fw.version))}
              </span>
            ) : null}
          </div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "frameworkLabel")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Relay pin: <span className="font-mono text-[#007aff] dark:text-[#0a84ff]">{relayPin}</span>
          </p>
        </div>

        <button
          onClick={generateFirmware}
          disabled={fw.stage === "generating" || fwStale || fw.stage === "accepted"}
          title={fwStale ? t(lang, "staleBlocked") : undefined}
          className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
        >
          {fw.stage === "generating" ? (
            <>
              <span className="material-symbols-outlined animate-spin text-[15px]">autorenew</span>
              <span>{t(lang, "firmwareGenerating")}</span>
            </>
          ) : (
            <>
              <span>{t(lang, "generateFirmware")}</span>
              <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
            </>
          )}
        </button>
      </div>

      {/* Stale 提示 */}
      {fwStale && (
        <InfoBanner
          icon="history_toggle_off"
          title={t(lang, "staleBannerTitle")}
          desc={t(lang, "staleBannerDesc").replace("{from}", "Wiring / Hardware") + " Firmware → Build"}
          lang={lang}
        />
      )}

      {/* 生成中 */}
      {fw.stage === "generating" && (
        <div className="mac-card p-6 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[#007aff] dark:text-[#0a84ff] text-[24px]">autorenew</span>
          <span className="text-xs text-[var(--text-secondary)]">
            {t(lang, "firmwareGenerating")} <StreamingDots lang={lang} />
          </span>
        </div>
      )}

      {/* 提案 Diff */}
      {fw.stage === "proposal" && fw.proposal && (
        <section className="mac-card p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-amber-500 text-[18px]">engineering</span>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "proposalTitle")}</h2>
              </div>
              <span className="text-[11px] text-amber-500 font-mono">{t(lang, "proposalStatus")}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={rejectFirmwareProposal}
                className="px-3 py-1.5 mac-button-secondary rounded-md text-xs text-rose-500"
              >
                {t(lang, "reject")}
              </button>
              <button
                onClick={acceptFirmwareProposal}
                className="px-3 py-1.5 mac-button-primary rounded-md text-xs font-medium shadow-sm"
              >
                {t(lang, "acceptChange")}
              </button>
            </div>
          </div>

          {/* 风险说明 */}
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-200 text-xs mb-3">
            <div className="font-semibold font-mono text-amber-600 dark:text-amber-400 mb-0.5">⚠️ {t(lang, "bootRiskTitle")}</div>
            <p className="text-[11px] leading-relaxed">{t(lang, "bootRiskDesc")}</p>
          </div>

          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs mb-3">
            <div className="font-semibold font-mono text-emerald-600 dark:text-emerald-400 mb-0.5">
              {t(lang, "proposedRemapTitle").replace("IO12", fw.proposal.oldPin).replace("IO21", fw.proposal.newPin)}
            </div>
            <p className="text-[11px] leading-relaxed">
              {t(lang, "proposedRemapDesc").replace("IO12", fw.proposal.oldPin).replace("IO21", fw.proposal.newPin)}
            </p>
          </div>

          {/* Diff 视图 */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase font-mono">
                {fw.proposal.file} · v{fw.proposal.versionFrom} → v{fw.proposal.versionTo}
              </span>
              <div className="flex gap-2">
                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-mono">
                  - {fw.proposal.oldPin}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-mono">
                  + {fw.proposal.newPin}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <div className="rounded-md overflow-hidden border border-rose-500/20">
                <div className="px-2 py-1 bg-rose-500/10 text-[10px] font-mono text-rose-500">{t(lang, "diffOld")}</div>
                <pre className="p-2.5 text-[10px] font-mono leading-relaxed text-[var(--text-secondary)] overflow-x-auto bg-[var(--control-bg)]">
                  {`#define PUMP_RELAY_PIN  ${fw.proposal.oldPin}`}
                </pre>
              </div>
              <div className="rounded-md overflow-hidden border border-emerald-500/20">
                <div className="px-2 py-1 bg-emerald-500/10 text-[10px] font-mono text-emerald-500">{t(lang, "diffNew")}</div>
                <pre className="p-2.5 text-[10px] font-mono leading-relaxed text-[var(--text-primary)] overflow-x-auto bg-[var(--control-bg)]">
                  {`#define PUMP_RELAY_PIN  ${fw.proposal.newPin}`}
                </pre>
              </div>
            </div>
          </div>

          {/* 影响 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">{t(lang, "proposalImpacts")}</span>
            {fw.proposal.impacts.map((tag, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-[var(--panel-solid)] rounded border border-[var(--panel-border-subtle)] text-[10px] text-[var(--text-secondary)] font-mono">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 已接受 / 已拒绝 */}
      {fw.stage === "accepted" && (
        <InfoBanner icon="check_circle" title={t(lang, "firmwareAccepted")} desc={`${fw.proposal?.oldPin} → ${fw.proposal?.newPin} · Pin Map & Wiring updated.`} tone="amber" lang={lang} />
      )}
      {fw.stage === "rejected" && (
        <InfoBanner
          icon="block"
          title={t(lang, "firmwareRejected")}
          desc="Strapping risk remains: pump relay stays on IO12. Build may succeed, but boot behavior is not guaranteed."
          tone="rose"
          lang={lang}
        />
      )}

      {/* 代码 */}
      {fw.code && fw.stage !== "generating" && (
        <section className="mac-card overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)] font-mono">src/main.cpp</span>
            <button onClick={handleCopy} className="px-2.5 py-1 mac-button-secondary rounded-md text-[11px]">
              {copied ? t(lang, "codeCopied") : t(lang, "copyCode")}
            </button>
          </div>
          <pre className="p-4 text-[11px] font-mono leading-relaxed text-[var(--text-primary)] overflow-x-auto max-h-[420px] overflow-y-auto">
            {fw.code}
          </pre>
        </section>
      )}
    </div>
  );
};
