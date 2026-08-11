import React, { useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { ConfirmDialog, EmptyState } from "./ui";

export const CompanionView: React.FC = () => {
  const { state, detectBoard, flashDevice, simulateMoisture, togglePump } = useApp();
  const { lang, companion, runtime, project, artifacts } = state;
  const [confirmFlash, setConfirmFlash] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  const deviceOk = runtime.deviceStage === "connected";
  const firmwareOk = artifacts.firmware.version > 0;
  const flashing = runtime.deviceStage === "flashing";

  return (
    <div className="flex-1 px-6 py-6 max-w-[1100px] mx-auto flex flex-col gap-5 pb-20">
      <header className="mac-card p-4 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold">
              <span className="material-symbols-outlined text-sm">hub</span>
              <span>{t(lang, "companionCategory")}</span>
            </div>
            <span className={`px-2 py-0.5 rounded border text-[11px] font-mono font-medium flex items-center gap-1.5 ${
              deviceOk
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : "bg-[var(--control-bg)] border-[var(--panel-border-subtle)] text-[var(--text-secondary)]"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${deviceOk ? "bg-emerald-500" : "bg-[var(--text-muted)]"}`}></span>
              {deviceOk ? t(lang, "telemetryStream") : t(lang, "deviceNotConnected")}
            </span>
          </div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "companionTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "companionSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-[var(--control-bg)] px-2.5 py-1 rounded border border-[var(--panel-border-subtle)] text-xs font-mono text-[#007aff] dark:text-[#0a84ff]">
            <span>{project?.port ?? "COM6"} @ 115200 baud</span>
          </div>
          {!deviceOk ? (
            <button onClick={detectBoard} className="px-3 py-1.5 mac-button-primary rounded-md text-xs flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[15px]">usb</span>
              {t(lang, "detectBoard")}
            </button>
          ) : (
            <button
              onClick={() => setConfirmFlash(true)}
              disabled={!firmwareOk}
              className="px-3 py-1.5 mac-button-primary rounded-md text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[15px]">bolt</span>
              {t(lang, "flashToDevice")}
            </button>
          )}
        </div>
      </header>

      {/* 空态：未连接 */}
      {!deviceOk && (
        <EmptyState
          icon="usb"
          title={t(lang, "deviceNotConnected")}
          desc={t(lang, "deviceNotConnectedDesc")}
          lang={lang}
          action={
            <button onClick={detectBoard} className="px-4 py-1.5 mac-button-primary rounded-md text-xs">
              {t(lang, "detectBoard")}
            </button>
          }
        />
      )}

      {/* 烧录进度 */}
      {flashing && (
        <div className="mac-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <span className="material-symbols-outlined animate-pulse text-[#0a84ff] text-[17px]">bolt</span>
              {t(lang, "flashing")}
            </span>
            <span className="font-mono text-[11px] text-[#0a84ff]">{companion.flashProgress}%</span>
          </div>
          <div className="w-full bg-[var(--panel-border-subtle)] h-1.5 rounded-full overflow-hidden">
            <div className="h-full bg-[#0a84ff] transition-all duration-300" style={{ width: `${companion.flashProgress}%` }}></div>
          </div>
        </div>
      )}

      {/* 遥测网格 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 土壤湿度 */}
        <div className="mac-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <div className="p-1.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded">
                  <span className="material-symbols-outlined text-[16px]">water_drop</span>
                </div>
                <span>{t(lang, "soilMoistureTitle")}</span>
              </h3>
              <span className="font-mono text-[11px] text-[#007aff] dark:text-[#0a84ff] font-semibold px-1.5 py-0.5 bg-[#007aff]/10 rounded border border-[#007aff]/20">
                {companion.moisture}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={companion.moisture}
              onChange={(e) => simulateMoisture(Number(e.target.value))}
              className="w-full accent-[#007aff]"
            />
            <span className="text-[10px] text-[var(--text-muted)]">{t(lang, "simulateMoisture")}</span>
          </div>
        </div>

        {/* 水泵 */}
        <div className="mac-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <div className="p-1.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded">
                  <span className="material-symbols-outlined text-[16px]">valve</span>
                </div>
                <span>{t(lang, "pumpRelayTitle")}</span>
              </h3>
              <span className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${
                companion.pumpActive
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                  : "bg-[var(--control-bg)] border-[var(--panel-border-subtle)] text-[var(--text-secondary)]"
              }`}>
                {companion.pumpActive ? t(lang, "pumpActive") : t(lang, "pumpIdle")}
              </span>
            </div>
            <button
              onClick={togglePump}
              className="w-full py-1.5 rounded-md text-[11px] font-medium border border-[var(--panel-border-subtle)] bg-[var(--control-bg)] hover:bg-[var(--control-hover)] transition-colors"
            >
              {companion.pumpActive ? t(lang, "overrideOff") : t(lang, "overrideOn")}
            </button>
          </div>
        </div>

        {/* 温度 */}
        <div className="mac-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <div className="p-1.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded">
                  <span className="material-symbols-outlined text-[16px]">thermostat</span>
                </div>
                <span>{t(lang, "tempTitle")}</span>
              </h3>
              <span className="font-mono text-[11px] text-[#007aff] dark:text-[#0a84ff] font-semibold px-1.5 py-0.5 bg-[#007aff]/10 rounded border border-[#007aff]/20">
                {companion.temperature.toFixed(1)}°C
              </span>
            </div>
            <button
              onClick={() => {
                setCalibrating(true);
                setTimeout(() => setCalibrating(false), 800);
              }}
              className="w-full py-1.5 rounded-md text-[11px] font-medium border border-[var(--panel-border-subtle)] bg-[var(--control-bg)] hover:bg-[var(--control-hover)] transition-colors"
            >
              {calibrating ? `${t(lang, "calibration")}…` : t(lang, "calibrate")}
            </button>
          </div>
        </div>
      </div>

      {/* 串口证据流 */}
      {deviceOk && companion.serialLines.length > 0 && (
        <div className="mac-card overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] text-xs font-semibold text-[var(--text-primary)] font-mono">
            debug-evidence.log
          </div>
          <div className="p-4 h-[160px] overflow-y-auto font-mono text-[11px] leading-relaxed bg-[var(--control-bg)]">
            {companion.serialLines.map((line, i) => (
              <span key={i} className="text-[var(--text-secondary)]">
                {line}
                {"\n"}
              </span>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmFlash}
        title={t(lang, "flashConfirmTitle")}
        desc={t(lang, "flashConfirmDesc").replace("{device}", `${project?.target ?? "ESP32-S3"} (${project?.port ?? "COM6"})`)}
        confirmLabel={t(lang, "flashConfirmYes")}
        cancelLabel={t(lang, "flashConfirmNo")}
        onConfirm={() => {
          setConfirmFlash(false);
          flashDevice();
        }}
        onCancel={() => setConfirmFlash(false)}
        lang={lang}
      />
    </div>
  );
};
