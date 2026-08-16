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
import { ReadinessView } from "./components/ReadinessView";
import { CompanionView } from "./components/CompanionView";
import { SettingsView } from "./components/SettingsView";
import { StaleBanner, staleKindsFor } from "./components/ui";
import { StateLab } from "./components/StateLab";
import { AppProvider, useApp } from "./state/AppContext";
import { t } from "./lib/i18n";

function Workspace() {
  const { state, revalidateAll, decideRevalidateProposal } = useApp();
  const { lang, sidebar } = state;
  const commercialPrototypeEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("prototype") === "commercial-readiness";

  const staleKinds = staleKindsFor(state.artifacts, ["pinmap", "wiring", "firmware", "build"]);
  const revalidating = state.revalidate.running;
  const kindLabel = (k: string) => t(lang, `kind${(k[0] ?? "").toUpperCase()}${k.slice(1)}` as never);

  return (
    <div className={`flex ${commercialPrototypeEnabled ? "" : "pt-11"} flex-1`}>
      {!commercialPrototypeEnabled && <SideNavBar />}

      <main className={`flex-1 min-w-0 ${commercialPrototypeEnabled ? "" : "ml-64 mr-copilot-width transition-all"}`}>
        {/* 全局 Stale 提示（工作区任意视图） */}
        {!commercialPrototypeEnabled && staleKinds.length > 0 && (
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

        {/* S5B：Revalidate 产生的提案卡（D1 不自动接受——等待用户决策） */}
        {!commercialPrototypeEnabled && state.revalidate.proposals.length > 0 && (
          <div className="px-6 pt-4 flex flex-col gap-2">
            {state.revalidate.proposals.map((p) => (
              <div
                key={p.proposalId}
                className="mac-card p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="material-symbols-outlined text-amber-500 text-[16px]">engineering</span>
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {t(lang, "proposalTitle")}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {t(lang, "revalidateProposalCard").replace("{kind}", kindLabel(p.kind))}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => decideRevalidateProposal(p.proposalId, "reject")}
                    className="px-3 py-1.5 mac-button-secondary rounded-md text-xs text-rose-500"
                  >
                    {t(lang, "revalidateProposalReject")}
                  </button>
                  <button
                    onClick={() => decideRevalidateProposal(p.proposalId, "accept")}
                    className="px-3 py-1.5 mac-button-primary rounded-md text-xs font-medium shadow-sm"
                  >
                    {t(lang, "revalidateProposalAccept")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {sidebar === "Requirements" && <RequirementsView />}
        {sidebar === "Hardware" && <HardwareSelectionView />}
        {sidebar === "Wiring" && <WiringGuidanceView />}
        {sidebar === "Firmware" && <FirmwareView />}
        {sidebar === "Build" && <BuildView />}
        {sidebar === "Delivery" && <ReadinessView />}
        {sidebar === "Companion" && <CompanionView />}
        {sidebar === "Settings" && <SettingsView />}
      </main>

      {!commercialPrototypeEnabled && <ProjectCopilotPanel />}
    </div>
  );
}

function AppInner() {
  const { state, dispatch, setNav } = useApp();
  const { lang, theme, nav, labOpen } = state;
  const developmentToolsEnabled = import.meta.env.DEV;
  const commercialPrototypeEnabled = developmentToolsEnabled && new URLSearchParams(window.location.search).get("prototype") === "commercial-readiness";

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

  useEffect(() => {
    if (!commercialPrototypeEnabled) return;
    setNav("Draft");
    dispatch({ type: "SIDEBAR", sidebar: "Hardware" });
  }, [commercialPrototypeEnabled, dispatch, setNav]);

  return (
    <div className="min-h-screen bg-[var(--canvas-bg)] text-[var(--text-primary)] font-sans antialiased flex flex-col selection:bg-[#007aff]/30">
      {!commercialPrototypeEnabled && <TopNavBar />}

      {nav === "Home" ? <HomeDashboardView /> : <Workspace />}

      {developmentToolsEnabled && !commercialPrototypeEnabled && (
        <>
          {/* State Lab 浮动入口（Mock 专用；开发构建才可达） */}
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
        </>
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
