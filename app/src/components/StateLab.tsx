// ============================================================
// State Lab — Mock 状态触发面板（仅开发验证用，UI Frozen 后移除或隐藏）
// 触发：Empty / Offline / Provider / Toolchain / Device / BuildFail /
//       DiscoveryFail / SlowMode / ForceStale / Partial
// ============================================================
import { useApp } from "../state/AppContext";
import { t } from "../lib/i18n";

interface ScenarioDef {
  id: string;
  key: string; // i18n key
  active?: boolean;
}

export function StateLab() {
  const { state, runScenario } = useApp();
  const lang = state.lang;
  const r = state.runtime;

  const scenarios: ScenarioDef[] = [
    { id: "reset", key: "labResetJourney" },
    { id: "offline", key: "labScenarioOffline", active: !r.online },
    { id: "online", key: "labScenarioOnline", active: r.online },
    { id: "provider", key: "labScenarioProvider", active: !r.providerAvailable },
    { id: "providerOk", key: "labScenarioProviderOk", active: r.providerAvailable },
    { id: "toolchain", key: "labScenarioToolchain", active: !r.toolchainAvailable },
    { id: "toolchainOk", key: "labScenarioToolchainOk", active: r.toolchainAvailable },
    { id: "deviceDown", key: "labScenarioDevice", active: r.deviceStage === "disconnected" },
    { id: "deviceUp", key: "labScenarioDeviceOk", active: r.deviceStage !== "disconnected" },
    { id: "buildFail", key: "labScenarioBuildFail", active: state.build.nextFails },
    { id: "buildOk", key: "labScenarioBuildOk", active: !state.build.nextFails },
    { id: "discFail", key: "labScenarioDiscoveryFail", active: state.discovery.nextFails },
    { id: "discOk", key: "labScenarioDiscoveryOk", active: !state.discovery.nextFails },
    { id: "slow", key: "labScenarioSlow", active: r.slowMode },
    { id: "stale", key: "labScenarioStale" },
    { id: "partial", key: "labScenarioPartial", active: state.discovery.partialNext },
    { id: "partialOk", key: "labScenarioPartialOk", active: !state.discovery.partialNext },
  ];

  return (
    <div className="p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold">
        <span className="material-symbols-outlined text-sm">science</span>
        <span>{t(lang, "labTitle")}</span>
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{t(lang, "labDesc")}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {scenarios.map((sc) => (
          <button
            key={sc.id}
            onClick={() => runScenario(sc.id)}
            className={`px-2 py-1.5 rounded-md text-[11px] font-medium border transition-colors text-left ${
              sc.active
                ? "border-[#007aff]/50 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff]"
                : "border-[var(--panel-border-subtle)] bg-[var(--control-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t(lang, sc.key as never)}
          </button>
        ))}
      </div>
    </div>
  );
}
