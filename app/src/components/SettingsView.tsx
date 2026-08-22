import React, { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import type { Language } from "../types";
import { useApp } from "../state/AppContext";
import { StateLab } from "./StateLab";
import { api } from "../api/client";
import type { AiPermissionsDto } from "@/src/shared-contracts/types";

const TIER_TONE: Record<AiPermissionsDto["permissions"][number]["tier"], string> = {
  "auto-readonly": "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  "proposal-required": "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
  forbidden: "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400",
};

const TIER_LABEL: Record<AiPermissionsDto["permissions"][number]["tier"], "tierAutoReadonly" | "tierProposalRequired" | "tierForbidden"> = {
  "auto-readonly": "tierAutoReadonly",
  "proposal-required": "tierProposalRequired",
  forbidden: "tierForbidden",
};

/** R4：AI 权限三级表的用户可见渲染——信任界面即测试断言的同源数据。 */
const AiTrustBoundaryCard: React.FC<{ lang: Language }> = ({ lang }) => {
  const [data, setData] = useState<AiPermissionsDto | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.getAiPermissions(controller.signal).then(setData).catch(() => setData(null));
    return () => controller.abort();
  }, []);
  if (!data) return null;
  const rows = [...data.permissions, ...data.forbidden];
  return (
    <div className="mac-card overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)]">
        <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-sm">verified_user</span>
          <span>{t(lang, "aiTrustTitle")}</span>
        </h3>
        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">{t(lang, "aiTrustDesc")}</p>
      </div>
      <div className="flex flex-col">
        {rows.map((entry) => (
          <div key={entry.capability} className="px-3.5 py-2 flex items-center gap-2.5 border-b border-[var(--panel-border-subtle)] last:border-b-0">
            <span className={`shrink-0 inline-flex items-center border rounded px-1.5 py-0.5 text-[10px] font-medium ${TIER_TONE[entry.tier]}`}>
              {t(lang, TIER_LABEL[entry.tier])}
            </span>
            <code className="text-[11px] font-mono text-[var(--text-primary)] shrink-0">{entry.capability}</code>
            <span className="text-[11px] text-[var(--text-secondary)] truncate">{entry.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

type SettingsTab = "General" | "Appearance" | "Language" | "AI Provider" | "Local Companion" | "Advanced";

export const SettingsView: React.FC = () => {
  const { state, dispatch, selectMcu, detectBoard } = useApp();
  const { lang, theme, runtime, selectedMcu, project } = state;
  const developmentToolsEnabled = import.meta.env.DEV;
  const [activeTab, setActiveTab] = useState<SettingsTab>("General");
  const [providerTest, setProviderTest] = useState<"idle" | "ok" | "fail">("idle");

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: "General", label: t(lang, "generalTab"), icon: "settings" },
    { id: "Appearance", label: t(lang, "appearanceTab"), icon: "palette" },
    { id: "Language", label: t(lang, "languageTab"), icon: "language" },
    { id: "AI Provider", label: t(lang, "aiProviderTab"), icon: "auto_awesome" },
    { id: "Local Companion", label: t(lang, "companionTabSettings"), icon: "hub" },
    ...(developmentToolsEnabled ? [{ id: "Advanced" as const, label: t(lang, "advancedTab"), icon: "tune" }] : []),
  ];

  return (
    <div className="flex-1 px-6 py-6 max-w-[900px] mx-auto flex flex-col gap-5 pb-20">
      <header className="mac-card p-4">
        <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5">
          <span className="material-symbols-outlined text-sm">tune</span>
          <span>{t(lang, "configCategory")}</span>
        </div>
        <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "settingsTitle")}</h1>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{t(lang, "settingsSubtitle")}</p>
      </header>

      <div className="mac-card overflow-hidden flex flex-col md:flex-row min-h-[420px]">
        {/* 标签 */}
        <div className="w-full md:w-52 bg-[var(--control-bg)] border-b md:border-b-0 md:border-r border-[var(--panel-border-subtle)] p-2 flex flex-row md:flex-col gap-1 overflow-x-auto select-none">
          {tabs.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] font-semibold"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-hover)]"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>

        {/* 内容 */}
        <div className="flex-1 p-5 flex flex-col gap-4">
          {activeTab === "General" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "mcuSectionTitle")}</label>
                <span className="text-[11px] text-[var(--text-secondary)]">{t(lang, "activeMcuLabel")}: <strong className="font-mono text-[#007aff] dark:text-[#0a84ff]">{selectedMcu || "—"}</strong></span>
                <div className="flex gap-1.5 mt-1.5">
                  {["ESP32-S3", "RP2040", "STM32F401"].map((m) => (
                    <button
                      key={m}
                      onClick={() => selectMcu(m)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                        selectedMcu === m
                          ? "border-[#007aff]/50 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff]"
                          : "border-[var(--panel-border-subtle)] bg-[var(--control-bg)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "serialPortLabel")}</label>
                <span className="font-mono text-[11px] text-[var(--text-secondary)]">{project?.port ?? "—"} @ 115200</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className={`w-1.5 h-1.5 rounded-full ${runtime.online === true ? "bg-emerald-500" : runtime.online === false ? "bg-rose-500" : "bg-slate-400"}`}></span>
                {runtime.online === true ? t(lang, "activeConnected") : runtime.online === false ? t(lang, "bridgeOffline") : "Unknown"}
              </div>
            </>
          )}

          {activeTab === "Appearance" && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "themeLabel")}</label>
              <div className="flex gap-2">
                {(["system", "light", "dark"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => dispatch({ type: "THEME", theme: m })}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      theme === m
                        ? "border-[#007aff]/50 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] font-semibold"
                        : "border-[var(--panel-border-subtle)] bg-[var(--control-bg)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {m === "system" ? t(lang, "themeSystem") : m === "light" ? t(lang, "themeLight") : t(lang, "themeDark")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "Language" && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "languageLabel")}</label>
              <div className="flex gap-2">
                {(["en", "zh"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => dispatch({ type: "LANG", lang: m })}
                    className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      lang === m
                        ? "border-[#007aff]/50 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] font-semibold"
                        : "border-[var(--panel-border-subtle)] bg-[var(--control-bg)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {m === "en" ? t(lang, "langEn") : t(lang, "langZh")}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "AI Provider" && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "copilotSectionTitle")}</label>
                <span className="text-[11px] text-[var(--text-secondary)]">{t(lang, "geminiKeyDesc")}</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[var(--text-muted)]">{t(lang, "providerEndpoint")}</label>
                <span className="font-mono text-[11px] text-[var(--text-primary)]">Server-managed provider endpoint</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[var(--text-muted)]">{t(lang, "providerModel")}</label>
                <span className="font-mono text-[11px] text-[var(--text-primary)]">Server-managed provider model</span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[var(--text-muted)]">{t(lang, "providerKey")}</label>
                <input
                  type="password"
                  placeholder="Configured server-side; never stored in the UI"
                  className="px-3 py-1.5 rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-xs font-mono text-[var(--text-primary)] focus:outline-none focus:border-[#007aff]"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setProviderTest(runtime.providerAvailable === true ? "ok" : "fail")}
                  className="px-3 py-1.5 mac-button-secondary rounded-md text-xs"
                >
                  {t(lang, "providerTest")}
                </button>
                {providerTest === "ok" && <span className="text-[11px] font-mono text-emerald-500">{t(lang, "providerTestOk")}</span>}
                {providerTest === "fail" && <span className="text-[11px] font-mono text-rose-500">{t(lang, "providerTestFail")}</span>}
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">{t(lang, "providerByo")}</span>
            </div>
          )}

          {activeTab === "Local Companion" && (
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "companionTabSettings")}</label>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className={`w-1.5 h-1.5 rounded-full ${runtime.deviceStage === "connected" ? "bg-emerald-500" : "bg-[var(--text-muted)]"}`}></span>
                {runtime.deviceStage === "connected" ? `${t(lang, "deviceConnected")} · ${project?.target ?? "—"} (${project?.port ?? "—"})${runtime.deviceTruth ? ` · ${runtime.deviceTruth.executionReality} / ${runtime.deviceTruth.physicalVerified ? "physical verified" : "physical not verified"}` : " · execution source unavailable"}` : t(lang, "deviceNotConnected")}
              </div>
              {runtime.deviceStage !== "connected" && (
                <button onClick={detectBoard} className="px-3 py-1.5 mac-button-primary rounded-md text-xs w-fit">
                  {t(lang, "detectBoard")}
                </button>
              )}
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className={`w-1.5 h-1.5 rounded-full ${runtime.toolchainAvailable === true ? "bg-emerald-500" : runtime.toolchainAvailable === false ? "bg-rose-500" : "bg-slate-400"}`}></span>
                {runtime.toolchainAvailable === true ? "PlatformIO / ESP-IDF" : runtime.toolchainAvailable === false ? t(lang, "toolchainUnavailable") : "Unknown"}
              </div>
            </div>
          )}

          {developmentToolsEnabled && activeTab === "Advanced" && (
            <StateLab />
          )}
        </div>
      </div>

      {/* R4：AI 信任边界（独立于标签页的全局信任面） */}
      <AiTrustBoundaryCard lang={lang} />
    </div>
  );
};
