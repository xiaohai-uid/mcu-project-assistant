import { useEffect } from "react";
import { TopNavBar } from "./components/TopNavBar";
import { SideNavBar } from "./components/SideNavBar";
import { ProjectCopilotPanel } from "./components/ProjectCopilotPanel";
import { HomeDashboardView } from "./components/HomeDashboardView";
import { RequirementsView } from "./components/RequirementsView";
import { HardwareSelectionView } from "./components/HardwareSelectionView";
import { WiringGuidanceView } from "./components/WiringGuidanceView";
import { FirmwareView } from "./components/FirmwareView";
import { BuildView } from "./components/BuildView";
import { CompanionView } from "./components/CompanionView";
import { SettingsView } from "./components/SettingsView";
import { StaleBanner, staleKindsFor } from "./components/ui";
import { StateLab } from "./components/StateLab";
import { AppProvider, useApp } from "./state/AppContext";
import { t } from "./lib/i18n";

function Workspace() {
  const { state, revalidateAll } = useApp();
  const { lang, sidebar } = state;

  const staleKinds = staleKindsFor(state.artifacts, ["pinmap", "wiring", "firmware", "build"]);
  const revalidating = staleKinds.length > 0 && state.build.stage === "building";
  const kindLabel = (k: string) => t(lang, `kind${(k[0] ?? "").toUpperCase()}${k.slice(1)}` as never);

  return (
    <div className="flex pt-11 flex-1">
      <SideNavBar />

      <main className="flex-1 ml-64 mr-copilot-width transition-all">
        {/* 全局 Stale 提示（工作区任意视图） */}
        {staleKinds.length > 0 && (
          <div className="px-6 pt-4">
            <StaleBanner
              from={kindLabel("hardware")}
              staleKinds={staleKinds.map(kindLabel)}
              lang={lang}
              onRevalidate={revalidateAll}
              revalidating={revalidating}
            />
          </div>
        )}

        {sidebar === "Requirements" && <RequirementsView />}
        {sidebar === "Hardware" && <HardwareSelectionView />}
        {sidebar === "Wiring" && <WiringGuidanceView />}
        {sidebar === "Firmware" && <FirmwareView />}
        {sidebar === "Build" && <BuildView />}
        {sidebar === "Companion" && <CompanionView />}
        {sidebar === "Settings" && <SettingsView />}
      </main>

      <ProjectCopilotPanel />
    </div>
  );
}

function AppInner() {
  const { state, dispatch, setNav } = useApp();
  const { lang, theme, nav, labOpen } = state;

  // 主题应用（System / Light / Dark）
  useEffect(() => {
    localStorage.setItem("mcu_app_theme", theme);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (theme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(prefersDark ? "dark" : "light");
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  // 语言持久化
  useEffect(() => {
    localStorage.setItem("mcu_app_lang", lang);
  }, [lang]);

  return (
    <div className="min-h-screen bg-[var(--canvas-bg)] text-[var(--text-primary)] font-sans antialiased flex flex-col selection:bg-[#007aff]/30">
      <TopNavBar />

      {nav === "Home" ? <HomeDashboardView /> : <Workspace />}

      {/* State Lab 浮动入口（Mock 专用） */}
      <button
        onClick={() => dispatch({ type: "LAB_OPEN", open: !labOpen })}
        title={labOpen ? t(lang, "labOff") : t(lang, "labOn")}
        className={`fixed bottom-4 left-4 z-[90] w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-all ${
          labOpen
            ? "bg-[#007aff] text-white"
            : "bg-[var(--panel-solid)] border border-[var(--panel-border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">science</span>
      </button>

      {labOpen && (
        <div className="fixed bottom-16 left-4 z-[90] w-[360px] mac-card shadow-xl max-h-[70vh] overflow-y-auto">
          <StateLab />
        </div>
      )}

      {/* 未登录 Home 的快捷入口提示 */}
      {nav === "Home" && (
        <button
          onClick={() => setNav("Draft")}
          className="fixed bottom-4 right-4 z-[90] px-3 py-1.5 rounded-md mac-button-primary text-xs font-medium shadow-md"
        >
          {t(lang, "openWorkspace")}
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
