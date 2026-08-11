import React from "react";
import type { ArtifactKind, SidebarTab } from "../types";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";

const TAB_ARTIFACT: Partial<Record<SidebarTab, ArtifactKind>> = {
  Requirements: "requirements",
  Hardware: "hardware",
  Wiring: "wiring",
  Firmware: "firmware",
  Build: "build",
};

export const SideNavBar: React.FC = () => {
  const { state, setSidebar, flashDevice } = useApp();
  const { lang, sidebar, project, artifacts, runtime, firmware, build } = state;

  const mainTabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: "Requirements", label: t(lang, "reqTab"), icon: "assignment" },
    { id: "Hardware", label: t(lang, "hwTab"), icon: "memory" },
    { id: "Wiring", label: t(lang, "wiringTab"), icon: "schema" },
    { id: "Firmware", label: t(lang, "firmwareTab"), icon: "terminal" },
    { id: "Build", label: t(lang, "buildTab"), icon: "rocket_launch" },
  ];

  const footerTabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: "Companion", label: t(lang, "companionTab"), icon: "sensors" },
    { id: "Settings", label: t(lang, "settingsTab"), icon: "settings" },
  ];

  const deviceOk = runtime.deviceStage === "connected";
  const firmwareOk = artifacts.firmware.version > 0 && artifacts.firmware.status !== "stale";
  const canFlash = deviceOk && firmwareOk && build.stage !== "building";

  const tabDot = (id: SidebarTab): string | null => {
    const kind = TAB_ARTIFACT[id];
    if (!kind) return null;
    const st = artifacts[kind];
    if (st.status === "stale") return "bg-amber-500";
    if (st.status === "error") return "bg-rose-500";
    if (st.status === "warning") return "bg-amber-400";
    if (st.status === "validated" || st.status === "accepted") return "bg-emerald-500";
    return null;
  };

  const renderTab = (tab: { id: SidebarTab; label: string; icon: string }, key: string) => {
    const isActive = sidebar === tab.id;
    const dot = tabDot(tab.id);
    return (
      <button
        key={key}
        onClick={() => setSidebar(tab.id)}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all w-full text-left ${
          isActive
            ? "bg-[#007aff]/10 dark:bg-[#0a84ff]/15 text-[#007aff] dark:text-[#0a84ff] font-semibold"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--control-bg)]"
        }`}
      >
        <span className={`material-symbols-outlined text-[17px] ${isActive ? "text-[#007aff] dark:text-[#0a84ff]" : "text-[var(--text-secondary)]"}`}>
          {tab.icon}
        </span>
        <span className="flex-1">{tab.label}</span>
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} title={tab.label} />}
      </button>
    );
  };

  return (
    <nav className="fixed left-0 top-11 h-[calc(100vh-44px)] w-64 mac-sidebar flex flex-col z-40 pb-3 select-none">
      {/* 项目上下文头 */}
      <div className="p-3 border-b border-[var(--panel-border-subtle)]">
        <div className="p-2.5 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-md bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[17px]">developer_board</span>
          </div>
          <div className="overflow-hidden">
            <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {project?.name ?? "—"}
            </div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)] truncate flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${runtime.deviceStage === "connected" ? "bg-emerald-500" : "bg-[var(--text-muted)]"}`}></span>
              <span>{project ? `${project.target} · ${project.port}` : "No project"}</span>
            </div>
          </div>
        </div>

        <button
          onClick={flashDevice}
          disabled={!canFlash}
          title={!deviceOk ? t(lang, "deviceNotConnected") : undefined}
          className="w-full mac-button-primary text-xs font-medium py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[15px]">bolt</span>
          <span>{t(lang, "flashMcu")}</span>
        </button>
      </div>

      {/* 主导航 */}
      <div className="flex-grow px-2 py-2 flex flex-col gap-0.5 overflow-y-auto">
        <div className="px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          {t(lang, "pipelineHeader")}
        </div>
        {mainTabs.map((tab) => renderTab(tab, tab.id))}
      </div>

      {/* 工具与配置 */}
      <div className="mt-auto px-2 pt-2 border-t border-[var(--panel-border-subtle)] flex flex-col gap-0.5">
        <div className="px-2 py-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          {t(lang, "toolsHeader")}
        </div>
        {footerTabs.map((tab) => renderTab(tab, tab.id))}
      </div>

      {/* 固件构建进行中指示 */}
      {build.stage === "building" && (
        <div className="px-3 py-1.5 text-[10px] font-mono text-[#007aff] dark:text-[#0a84ff] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px] animate-spin">autorenew</span>
          {t(lang, "building")}
        </div>
      )}
      {firmware.stage === "proposal" && (
        <div className="px-3 py-1.5 text-[10px] font-mono text-amber-500 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px]">rule</span>
          {t(lang, "pendingReview")}
        </div>
      )}
    </nav>
  );
};
