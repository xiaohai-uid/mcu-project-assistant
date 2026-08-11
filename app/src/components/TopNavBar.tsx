import React from "react";
import type { NavigationTab } from "../types";
import { format, t } from "../lib/i18n";
import { useApp } from "../state/AppContext";

export const TopNavBar: React.FC = () => {
  const { state, setNav, dispatch } = useApp();
  const { lang, nav, runtime, project } = state;
  const deviceConnected = runtime.deviceStage === "connected" || runtime.deviceStage === "flashing";

  return (
    <nav className="fixed top-0 left-0 w-full z-50 h-11 mac-glass flex items-center justify-between px-3.5 select-none">
      {/* 左：品牌 + 连接指示 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 mr-1">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/40"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/40"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/40"></div>
        </div>

        <div onClick={() => setNav("Home")} className="flex items-center gap-2 cursor-pointer group">
          <div className="w-5 h-5 rounded-md bg-[#007aff]/15 text-[#007aff] dark:text-[#0a84ff] flex items-center justify-center font-semibold text-xs">
            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              memory
            </span>
          </div>
          <span className="font-semibold text-xs text-[var(--text-primary)] tracking-tight flex items-center gap-1.5">
            {t(lang, "appTitle")}
          </span>
        </div>

        {nav !== "Home" && (
          <div className="hidden lg:flex items-center gap-2 border-l border-[var(--panel-border)] pl-3 h-4">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
              <span className={`w-1.5 h-1.5 rounded-full ${runtime.online ? "bg-emerald-500" : "bg-rose-500"}`}></span>
              <span>{runtime.online ? t(lang, "bridgeOnline") : t(lang, "bridgeOffline")}</span>
            </div>
            <span className="text-[var(--text-muted)]">•</span>
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-secondary)]">
              <span className={`w-1.5 h-1.5 rounded-full ${deviceConnected ? "bg-emerald-500" : "bg-rose-500"}`}></span>
              <span>
                {deviceConnected
                  ? format(t(lang, "mcuConnected"), { name: project?.target ?? "—" })
                  : t(lang, "mcuDisconnected")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 中：视图分段 */}
      <div className="hidden md:flex items-center bg-[var(--control-bg)] p-0.5 rounded-md border border-[var(--panel-border-subtle)]">
        {(["Draft", "Validated", "Professional View"] as NavigationTab[]).map((tab) => {
          const isActive = nav === tab;
          const label =
            tab === "Draft" ? t(lang, "navDraft")
            : tab === "Validated" ? t(lang, "navValidated")
            : t(lang, "navProView");
          return (
            <button
              key={tab}
              onClick={() => setNav(tab)}
              className={`px-3 py-0.5 text-xs font-medium rounded transition-all ${
                isActive
                  ? "bg-[var(--panel-solid)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* 右：动作 */}
      <div className="flex items-center gap-2">
        {nav !== "Home" && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded text-[11px] font-medium border border-[#007aff]/20">
            <span className="w-1.5 h-1.5 rounded-full bg-[#007aff] dark:bg-[#0a84ff]"></span>
            <span>{t(lang, "copilotActive")}</span>
          </div>
        )}

        <button
          onClick={() => dispatch({ type: "LANG", lang: lang === "en" ? "zh" : "en" })}
          title={lang === "en" ? "Switch to 简体中文" : "切换至 English"}
          className="px-2 py-0.5 rounded text-xs font-semibold font-mono bg-[var(--control-bg)] hover:bg-[var(--control-hover)] text-[var(--text-primary)] border border-[var(--panel-border-subtle)] transition-colors flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">language</span>
          <span>{lang === "en" ? "EN" : "中文"}</span>
        </button>

        <button
          onClick={() => {
            setNav("Draft");
            dispatch({ type: "SIDEBAR", sidebar: "Settings" });
          }}
          title={t(lang, "settingsTab")}
          aria-label={t(lang, "settingsTab")}
          className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg)] transition-colors"
        >
          <span className="material-symbols-outlined text-[17px]">settings</span>
        </button>

        <button
          onClick={() => alert(lang === "en" ? t(lang, "helpBody") : t(lang, "helpBodyZh"))}
          title="Help"
          aria-label="Help"
          className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg)] transition-colors"
        >
          <span className="material-symbols-outlined text-[17px]">help</span>
        </button>

        <div className="w-5 h-5 rounded-full bg-[var(--control-bg)] border border-[var(--panel-border)] overflow-hidden flex-shrink-0" />
      </div>
    </nav>
  );
};
