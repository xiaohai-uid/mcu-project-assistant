import React, { useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { ConfirmDialog, InfoBanner } from "./ui";

export const BuildView: React.FC = () => {
  const {
    state,
    startBuild,
    cancelBuild,
    retryBuild,
    runDiagnosis,
    applyFix,
    sendSerial,
    flashWithConfirmation,
    checkToolchain,
  } = useApp();
  const { lang, build, runtime, artifacts, firmware } = state;
  const [commandInput, setCommandInput] = useState("");
  const [confirmFlash, setConfirmFlash] = useState(false);

  const firmwareOk = artifacts.firmware.version > 0 && artifacts.firmware.status !== "stale";
  const deviceOk = runtime.deviceStage === "connected";
  const toolchainOk = runtime.toolchainAvailable;
  const building = build.stage === "building";

  const logColor = (kind: string) =>
    kind === "err"
      ? "text-rose-400"
      : kind === "ok"
      ? "text-emerald-400"
      : kind === "warn"
      ? "text-amber-400"
      : kind === "cmd"
      ? "text-[#0a84ff]"
      : kind === "flash"
      ? "text-[#0a84ff]"
      : "text-[var(--text-secondary)]";

  const handleSend = () => {
    if (!commandInput.trim()) return;
    sendSerial(commandInput.trim());
    setCommandInput("");
  };

  return (
    <div className="flex-1 px-6 py-6 max-w-[1100px] mx-auto flex flex-col gap-5 pb-20">
      <header className="flex justify-between items-center mac-card p-4">
        <div>
          <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5">
            <span className="material-symbols-outlined text-sm">terminal</span>
            <span>{t(lang, "buildPipelineCategory")}</span>
          </div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "buildTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "buildSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          {build.stage === "building" && (
            <button onClick={cancelBuild} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs text-rose-500">
              {t(lang, "cancel")}
            </button>
          )}
          <button
            onClick={building ? cancelBuild : startBuild}
            disabled={!toolchainOk || !firmwareOk || artifacts.firmware.status === "stale" || build.stage === "failed"}
            title={!firmwareOk ? t(lang, "staleBlocked") : undefined}
            className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {building ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[15px]">autorenew</span>
                <span>{t(lang, "building")}</span>
              </>
            ) : (
              <>
                <span>{deviceOk ? t(lang, "compileFlashBtn") : t(lang, "compileBtn")}</span>
                <span className="material-symbols-outlined text-[15px]">bolt</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 工具链缺失（S7：真实 discoverToolchain；重检测入口） */}
      {!toolchainOk && (
        <div className="flex items-center justify-between gap-3">
          <InfoBanner
            icon="build"
            title={t(lang, "toolchainUnavailable")}
            desc={t(lang, "toolchainUnavailableDesc")}
            lang={lang}
            tone="amber"
          />
          <button
            onClick={() => void checkToolchain()}
            className="shrink-0 px-3 py-1.5 mac-button-secondary rounded-md text-xs"
          >
            {t(lang, "toolchainRescan")}
          </button>
        </div>
      )}

      {/* 设备未连接 */}
      {!deviceOk && (
        <InfoBanner
          icon="usb"
          title={t(lang, "deviceNotConnected")}
          desc={t(lang, "deviceNotConnectedDesc")}
          lang={lang}
          tone="amber"
        />
      )}

      {/* 固件 Stale 拦截 */}
      {!firmwareOk && artifacts.firmware.version > 0 && (
        <InfoBanner icon="history_toggle_off" title={t(lang, "staleBlocked")} desc={t(lang, "staleBannerDesc").replace("{from}", "Wiring")} lang={lang} tone="amber" />
      )}

      {/* Build 日志 */}
      <div className="mac-card overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text-primary)] font-mono">build.log</span>
          {build.stage === "succeeded" && (
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-mono font-semibold">
              {t(lang, "buildSuccess")}
            </span>
          )}
          {build.stage === "failed" && (
            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[10px] font-mono font-semibold">
              {t(lang, "buildFailed")}
            </span>
          )}
          {build.stage === "cancelled" && (
            <span className="px-2 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[var(--text-secondary)] text-[10px] font-mono font-semibold">
              {t(lang, "buildCancelled")}
            </span>
          )}
        </div>
        <div className="p-4 h-[280px] overflow-y-auto font-mono text-[11px] leading-relaxed flex flex-col gap-0.5 bg-[var(--control-bg)]">
          {build.logs.length === 0 && (
            <span className="text-[var(--text-muted)]">{t(lang, "emptyPrompt")}</span>
          )}
          {build.logs.map((line, i) => (
            <span key={i} className={logColor(line.kind)}>
              {line.text}
            </span>
          ))}
          {building && <span className="text-[var(--text-secondary)]">{t(lang, "building")}…</span>}
        </div>
      </div>

      {/* 失败 → AI 诊断 */}
      {build.stage === "failed" && (
        <div className="mac-card p-5">
          {!build.diagnosis ? (
            <div className="flex items-center justify-between">
              <div className="text-xs text-[var(--text-secondary)]">{t(lang, "buildFailed")}</div>
              <button onClick={runDiagnosis} className="px-3 py-1.5 mac-button-primary rounded-md text-xs flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[15px]">psychology</span>
                {t(lang, "diagnoseBtn")}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-[18px]">psychology</span>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "diagnosisTitle")}</h3>
              </div>
              <div className="p-3 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-xs mb-3">
                <div className="text-[var(--text-secondary)] font-mono text-[10px] uppercase mb-1">{t(lang, "diagnosisCause")}</div>
                <p className="text-[var(--text-primary)]">{build.diagnosis.cause}</p>
                <div className="text-[var(--text-secondary)] font-mono text-[10px] uppercase mt-2 mb-1">{t(lang, "diagnosisFix")}</div>
                <p className="text-[var(--text-primary)]">{build.diagnosis.fix}</p>
              </div>
              {build.diagnosis.proposal && !build.fixApplied && (
                <div className="rounded-lg overflow-hidden border border-[var(--panel-border-subtle)] mb-3">
                  <div className="px-2.5 py-1.5 bg-[var(--control-bg)] text-[10px] font-mono text-[var(--text-secondary)] flex items-center justify-between">
                    <span>{build.diagnosis.proposal.file}</span>
                    <span className="text-[#007aff] dark:text-[#0a84ff]">AI Proposal</span>
                  </div>
                  <pre className="p-3 text-[11px] font-mono leading-relaxed text-[var(--text-primary)] overflow-x-auto bg-[var(--panel-solid)]">
                    {build.diagnosis.proposal.diff}
                  </pre>
                  <div className="px-2.5 py-2 bg-[var(--control-bg)] flex justify-end">
                    <button onClick={applyFix} className="px-3 py-1.5 mac-button-primary rounded-md text-xs">
                      {t(lang, "applyFix")}
                    </button>
                  </div>
                </div>
              )}
              {build.fixApplied && (
                <InfoBanner icon="verified_user" title={t(lang, "applyFix")} desc={`${build.diagnosis.proposal?.file} updated. Rebuild to verify.`} tone="blue" lang={lang} />
              )}
              <div className="flex gap-2">
                <button onClick={retryBuild} className="px-4 py-1.5 mac-button-secondary rounded-md text-xs">
                  {t(lang, "rebuild")}
                </button>
                <button onClick={() => { startBuild(); }} className="px-4 py-1.5 mac-button-primary rounded-md text-xs">
                  {t(lang, "retry")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 串口监视器 */}
      <div className="mac-card overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text-primary)] font-mono">serial @ 115200 baud</span>
          {deviceOk && (
            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-mono">
              {runtime.deviceTruth ? `${runtime.deviceTruth.executionReality} · ${runtime.deviceTruth.physicalVerified ? "physical verified" : "physical not verified"}` : "truth unavailable"}
            </span>
          )}
        </div>
        <div className="p-4 h-[160px] overflow-y-auto font-mono text-[11px] leading-relaxed bg-[var(--control-bg)]">
          {state.companion.serialLines.length === 0 && (
            <span className="text-[var(--text-muted)]">—</span>
          )}
          {state.companion.serialLines.map((line, i) => (
            <span key={i} className={line.startsWith(">") ? "text-[#0a84ff]" : "text-[var(--text-secondary)]"}>
              {line}
              {"\n"}
            </span>
          ))}
        </div>
        <div className="px-3.5 py-2.5 border-t border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex gap-2">
          <input
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={t(lang, "sendSerialPlaceholder")}
            disabled={!deviceOk}
            className="flex-1 px-3 py-1.5 rounded-md bg-[var(--panel-solid)] border border-[var(--panel-border-subtle)] text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#007aff] disabled:opacity-40"
          />
          <button onClick={handleSend} disabled={!deviceOk} className="px-3 py-1.5 mac-button-primary rounded-md text-xs disabled:opacity-40">
            {t(lang, "sendBtn")}
          </button>
        </div>
      </div>

      {/* Flash 确认（高风险） */}
      <ConfirmDialog
        open={confirmFlash}
        title={t(lang, "flashConfirmTitle")}
        desc={t(lang, "flashConfirmDesc").replace("{device}", `${state.project?.target ?? "ESP32-S3"} (${state.project?.port ?? "COM6"})`)}
        confirmLabel={t(lang, "flashConfirmYes")}
        cancelLabel={t(lang, "flashConfirmNo")}
        onConfirm={() => {
          setConfirmFlash(false);
          // S9：确认对话框 = 用户动作 → 签发一次性令牌 → 真实烧录（无令牌不执行）
          flashWithConfirmation();
        }}
        onCancel={() => setConfirmFlash(false)}
        lang={lang}
      />
      {deviceOk && firmwareOk && build.stage === "succeeded" && (
        <button onClick={() => setConfirmFlash(true)} className="w-full py-2 mac-button-primary rounded-md text-xs font-medium flex items-center justify-center gap-1.5">
          <span className="material-symbols-outlined text-[15px]">bolt</span>
          {t(lang, "flashDevice")}
        </button>
      )}
      {firmware.version === 0 && (
        <span className="text-[10px] text-[var(--text-muted)] text-center block">{t(lang, "emptyPrompt")}</span>
      )}
    </div>
  );
};
