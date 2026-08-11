import React, { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { api as clientApi } from "../api/client";
import { InfoBanner, PinEditor, StreamingDots } from "./ui";

export const WiringGuidanceView: React.FC = () => {
  const { state, verifyRules, generateFirmware, editPin, setSidebar, refreshPinmapVersions } = useApp();
  const { lang, wiring, artifacts, pinmapVersions, project } = state;
  const [zoomLevel, setZoomLevel] = useState(100);
  const [selectedPin, setSelectedPin] = useState<string | null>("IO4");
  const [editing, setEditing] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [openedVersion, setOpenedVersion] = useState<{ versionNo: number; content: string } | null>(null);

  // S2：进入 Wiring 视图时加载 pinmap 版本历史（真实 capability；ISSUE-002 §5/§12）
  useEffect(() => {
    if (project) void refreshPinmapVersions();
  }, [project, refreshPinmapVersions]);

  const openVersion = async (versionId: string, versionNo: number) => {
    try {
      const detail = await clientApi.getVersion(versionId);
      setOpenedVersion({ versionNo, content: detail.content ?? "{}" });
    } catch {
      setOpenedVersion({ versionNo, content: "{}" });
    }
  };

  const w = wiring;
  const pinmapStale = artifacts.pinmap.status === "stale";
  const wiringStale = artifacts.wiring.status === "stale";
  const hasIssues = w.issues.length > 0;
  const relayResolved = !w.issues.some((i) => i.pinId === "IO12");

  const onVerify = () => {
    setVerifying(true);
    verifyRules();
    setTimeout(() => setVerifying(false), 900);
  };

  const onProceed = () => {
    generateFirmware();
    setSidebar("Firmware");
  };

  return (
    <div className="flex-1 px-6 py-6 max-w-[1100px] mx-auto flex flex-col gap-5 pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mac-card p-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold">
              <span className="material-symbols-outlined text-sm">schema</span>
              <span>{t(lang, "pinoutCategory")}</span>
            </div>
            {wiringStale ? (
              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] font-medium">
                {t(lang, "statusStale")}
              </span>
            ) : w.verified ? (
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                {t(lang, "rulesVerified")}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[var(--text-secondary)] text-[11px] font-medium">
                {t(lang, "rulesNotVerified")}
              </span>
            )}
            {artifacts.pinmap.version > 0 && (
              <span className="px-2 py-0.5 rounded bg-[#007aff]/10 border border-[#007aff]/20 text-[#007aff] dark:text-[#0a84ff] text-[11px] font-mono font-semibold">
                v{artifacts.pinmap.version}
              </span>
            )}
          </div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "wiringTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "wiringSubtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* S10：PDF 导出不在 M1 能力范围（implementation-spec §19 Out of Scope）——禁用而非 mock 假成功 */}
          <button
            disabled
            title={t(lang, "exportPdfUnavailable")}
            className="px-3 py-1.5 mac-button-secondary rounded-md text-xs text-[var(--text-primary)] flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[15px]">picture_as_pdf</span>
            <span>{t(lang, "exportPdf")}</span>
          </button>
          <button
            onClick={onProceed}
            disabled={w.stage === "generating" || pinmapStale}
            title={pinmapStale ? t(lang, "staleBlocked") : undefined}
            className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <span>{t(lang, "generateFirmware")}</span>
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
          </button>
        </div>
      </header>

      {/* Stale 提示 */}
      {pinmapStale && (
        <InfoBanner
          icon="history_toggle_off"
          title={t(lang, "staleBannerTitle")}
          desc={t(lang, "staleBannerDesc").replace("{from}", "Hardware") + " Wiring → Firmware → Build"}
          lang={lang}
        />
      )}

      {/* 分配中 */}
      {w.stage === "generating" && (
        <div className="mac-card p-6 flex flex-col items-center gap-2">
          <span className="material-symbols-outlined animate-spin text-[#007aff] dark:text-[#0a84ff] text-[24px]">autorenew</span>
          <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
            {t(lang, "mappingGenerating")} <StreamingDots lang={lang} />
          </span>
        </div>
      )}

      {w.stage !== "generating" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* 图 */}
          <div className="lg:col-span-7 mac-card p-4 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-base">schema</span>
                <span>{t(lang, "diagramTitle")}</span>
              </h2>
              <div className="flex items-center gap-1 bg-[var(--control-bg)] p-0.5 rounded border border-[var(--panel-border-subtle)]">
                <button onClick={() => setZoomLevel((z) => Math.max(70, z - 10))} className="p-1 hover:bg-[var(--control-hover)] rounded text-[var(--text-secondary)]">
                  <span className="material-symbols-outlined text-[14px]">zoom_out</span>
                </button>
                <span className="font-mono text-[11px] px-1.5 text-[#007aff] dark:text-[#0a84ff]">{zoomLevel}%</span>
                <button onClick={() => setZoomLevel((z) => Math.min(150, z + 10))} className="p-1 hover:bg-[var(--control-hover)] rounded text-[var(--text-secondary)]">
                  <span className="material-symbols-outlined text-[14px]">zoom_in</span>
                </button>
              </div>
            </div>

            {w.pinMappings.length === 0 ? (
              <div className="w-full h-[340px] bg-[var(--control-bg)] rounded-lg border border-[var(--panel-border-subtle)] flex items-center justify-center text-xs text-[var(--text-muted)]">
                {t(lang, "emptyPrompt")}
              </div>
            ) : (
              <div className="w-full h-[340px] bg-[var(--control-bg)] rounded-lg border border-[var(--panel-border-subtle)] p-4 flex flex-col items-center justify-center relative overflow-hidden select-none">
                <div className="transition-transform duration-200 flex items-center justify-center gap-6 w-full h-full" style={{ transform: `scale(${zoomLevel / 100})` }}>
                  <div className="w-40 h-64 bg-[var(--panel-solid)] border border-emerald-500/40 rounded-lg p-2.5 flex flex-col justify-between relative shadow-sm">
                    <div className="flex justify-between items-center text-[9px] font-mono text-emerald-500">
                      <span>ESP32-S3</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    </div>
                    <div className="absolute left-[-10px] top-6 bottom-6 flex flex-col justify-between">
                      {["3V3", "GND", "IO4", "IO5", "IO8", "IO9", "IO12"].map((p) => (
                        <div
                          key={p}
                          onClick={() => setSelectedPin(p)}
                          className={`w-5 h-2.5 rounded text-[8px] font-mono flex items-center justify-center cursor-pointer transition-colors ${
                            selectedPin === p
                              ? "bg-amber-400 text-slate-950 font-bold"
                              : p === "IO12" && !relayResolved
                              ? "bg-rose-500/20 border border-rose-500/40 text-rose-500"
                              : "bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {p}
                        </div>
                      ))}
                    </div>
                    <div className="mx-auto my-auto w-24 h-32 bg-[var(--control-bg)] rounded border border-[var(--panel-border-subtle)] flex items-center justify-center text-[var(--text-secondary)] text-[9px] font-mono text-center p-1.5">
                      ESPRESSIF<br />ESP32-S3-WROOM-1<br />240MHz
                    </div>
                    <div className="absolute right-[-10px] top-6 bottom-6 flex flex-col justify-between">
                      {["IO21", "IO18", "IO19", "IO20", "TXD", "RXD", "GND"].map((p) => (
                        <div
                          key={p}
                          onClick={() => setSelectedPin(p)}
                          className={`w-5 h-2.5 rounded text-[8px] font-mono flex items-center justify-center cursor-pointer transition-colors ${
                            selectedPin === p ? "bg-amber-400 text-slate-950 font-bold" : "bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {p}
                        </div>
                      ))}
                    </div>
                    <div className="text-center text-[8px] font-mono text-emerald-500">USB-C</div>
                  </div>

                  <div className="flex flex-col justify-between h-64 py-1">
                    {w.pinMappings.map((pm) => {
                      const border =
                        pm.component.includes("Pump") && !relayResolved
                          ? "border-rose-500/40"
                          : pm.type === "I2C"
                          ? "border-violet-500/30"
                          : "border-[#007aff]/30";
                      return (
                        <div key={pm.component} className={`p-2 bg-[var(--panel-solid)] border rounded-md text-xs w-44 font-mono shadow-sm ${border}`}>
                          <div className="font-bold mb-0.5 text-[10px]">{pm.component.toUpperCase().slice(0, 18)}</div>
                          <div className="text-[var(--text-secondary)] text-[9px]">→ {pm.pinId}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            <p className="text-[11px] text-[var(--text-secondary)] mt-2.5 text-center">{t(lang, "diagramHint")}</p>
          </div>

          {/* 引脚表 */}
          <div className="lg:col-span-5 mac-card p-4 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)] mb-2.5">{t(lang, "pinMatrixTitle")}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--panel-border-subtle)] text-[var(--text-muted)] font-mono text-[10px]">
                      <th className="pb-1.5">{t(lang, "colComponent")}</th>
                      <th className="pb-1.5">{t(lang, "colPinId")}</th>
                      <th className="pb-1.5">{t(lang, "colType")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--panel-border-subtle)]">
                    {w.pinMappings.map((map) => {
                      const conflicted = map.pinId === "IO12" && !relayResolved;
                      return (
                        <tr key={map.component} className={`hover:bg-[var(--control-bg)] transition-colors ${conflicted ? "bg-rose-500/5" : ""}`}>
                          <td className="py-2 font-medium text-[var(--text-primary)]">{map.component}</td>
                          <td className="py-2 font-mono font-semibold text-[#007aff] dark:text-[#0a84ff]">
                            {editing === map.component ? (
                              <PinEditor
                                value={map.pinId}
                                onSave={(v) => {
                                  editPin(map.component, v);
                                  setEditing(null);
                                }}
                                onCancel={() => setEditing(null)}
                                lang={lang}
                              />
                            ) : (
                              <span
                                onClick={() => setEditing(map.component)}
                                className={`cursor-pointer hover:underline ${conflicted ? "text-rose-500" : ""}`}
                                title={t(lang, "editPin")}
                              >
                                {map.pinId}
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${
                              map.type === "Analog"
                                ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
                                : map.type === "I2C"
                                ? "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400"
                                : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                            }`}>
                              {map.type}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* S2：版本历史（真实 listVersions；点击打开不可变旧内容） */}
              <div className="mt-4">
                <div className="text-[11px] font-semibold text-[var(--text-primary)] mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-[#007aff] dark:text-[#0a84ff]">history</span>
                  <span>{t(lang, "versionHistoryTitle")}</span>
                </div>
                {pinmapVersions.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)]">{t(lang, "versionHistoryEmpty")}</p>
                ) : (
                  <ul className="divide-y divide-[var(--panel-border-subtle)] border border-[var(--panel-border-subtle)] rounded-md">
                    {pinmapVersions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between px-2 py-1.5 text-[11px]">
                        <span className="font-mono font-semibold text-[#007aff] dark:text-[#0a84ff]">v{v.versionNo}</span>
                        <span className="text-[var(--text-secondary)]">
                          {v.sourceKind === "manual" ? "manual" : "ai"} · {t(lang, "versionCreated")} {new Date(v.createdAt).toLocaleString()}
                        </span>
                        <button
                          onClick={() => void openVersion(v.id, v.versionNo)}
                          className="px-1.5 py-0.5 rounded text-[10px] mac-button-secondary"
                        >
                          {t(lang, "versionOpen")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {openedVersion && (
                  <div className="mt-2 p-2 bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] rounded-md">
                    <div className="text-[10px] font-mono text-[var(--text-secondary)] mb-1">
                      v{openedVersion.versionNo} · {t(lang, "versionOpen")}
                    </div>
                    <pre className="text-[10px] font-mono text-[var(--text-primary)] whitespace-pre-wrap max-h-40 overflow-auto">
                      {openedVersion.content}
                    </pre>
                  </div>
                )}
              </div>

              {/* 冲突卡 */}
              {hasIssues && (
                <div className="mt-4 p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-md text-rose-700 dark:text-rose-300 text-xs">
                  <div className="font-semibold font-mono flex items-center gap-1 text-rose-600 dark:text-rose-400 mb-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    <span>{t(lang, "pinIssueTitle")}</span>
                  </div>
                  {w.issues.map((issue) => (
                    <p key={issue.pinId + issue.title} className="text-[11px] leading-relaxed">
                      <strong>{issue.pinId}</strong> — {issue.title}: {issue.detail}
                    </p>
                  ))}
                  <p className="text-[10px] mt-1.5 text-[var(--text-secondary)]">{t(lang, "conflictFixedByProposal")}</p>
                </div>
              )}

              {/* Strapping 提示 */}
              <div className="mt-4 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-md text-amber-700 dark:text-amber-200 text-xs">
                <div className="font-semibold font-mono flex items-center gap-1 text-amber-600 dark:text-amber-400 mb-0.5">
                  <span className="material-symbols-outlined text-[14px]">warning</span>
                  <span>{t(lang, "strappingCautionTitle")}</span>
                </div>
                <p className="text-[11px] leading-relaxed">{t(lang, "strappingCautionDesc")}</p>
              </div>
            </div>

            <button
              onClick={onVerify}
              disabled={w.pinMappings.length === 0 || verifying || wiringStale}
              className="mt-4 w-full py-1.5 mac-button-secondary rounded-md text-xs font-semibold text-[#007aff] dark:text-[#0a84ff] flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {verifying ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[15px]">autorenew</span>
                  <span>{t(lang, "verifyingRules")}</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[15px]">rule</span>
                  <span>{t(lang, "verifyRules")}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
