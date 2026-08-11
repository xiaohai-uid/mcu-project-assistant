import React from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { StreamingDots } from "./ui";

export const ProjectCopilotPanel: React.FC = () => {
  const { state, dispatch, sendCopilotMessage, setSidebar } = useApp();
  const { lang, copilotMessages, artifacts, firmware, selectedMcu, project, runtime } = state;
  const [inputText, setInputText] = React.useState("");

  const handleSend = () => {
    if (!inputText.trim() || !runtime.providerAvailable) return;
    sendCopilotMessage(inputText.trim());
    setInputText("");
  };

  const fwProposalPending = firmware.stage === "proposal";
  const resolvedProposals = [
    ...state.discovery.proposals.filter((p) => p.decision !== "pending"),
    ...(firmware.stage === "accepted" || firmware.stage === "rejected" ? [firmware.proposal!] : []),
  ].filter(Boolean);

  return (
    <aside className="fixed right-0 top-11 h-[calc(100vh-44px)] w-copilot-width mac-sidebar border-l border-[var(--panel-border)] z-40 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-[var(--panel-border-subtle)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] flex items-center justify-center">
              <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
            </div>
            <div>
              <h2 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                {t(lang, "copilotName")}
              </h2>
              <p className="text-[10px] text-[var(--text-secondary)]">{t(lang, "copilotRole")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-[var(--control-bg)] p-0.5 rounded border border-[var(--panel-border-subtle)]">
            {(["Chat", "Context", "History"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => dispatch({ type: "COPILOT_TAB", tab })}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  state.copilotTab === tab
                    ? "bg-[var(--panel-solid)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab === "Chat" ? t(lang, "tabChat") : tab === "Context" ? t(lang, "tabContext") : t(lang, "tabHistory")}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">{t(lang, "copilotHint")}</p>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
        {state.copilotTab === "Chat" && (
          <>
            {copilotMessages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-xs text-[var(--text-primary)] mb-1">{t(lang, "copilotEmpty")}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">{t(lang, "copilotEmptyDesc")}</p>
              </div>
            )}
            {copilotMessages.map((msg) => (
              <div key={msg.id} className={`flex flex-col gap-1 ${msg.sender === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[92%] px-3 py-2 rounded-xl text-[11px] leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-[#007aff] text-white rounded-br-sm"
                      : msg.sender === "system"
                      ? "bg-[var(--control-bg)] text-[var(--text-secondary)] border border-[var(--panel-border-subtle)] rounded-bl-sm"
                      : "bg-[var(--panel-solid)] text-[var(--text-primary)] border border-[var(--panel-border-subtle)] rounded-bl-sm"
                  }`}
                >
                  {msg.title && <div className="font-semibold mb-0.5">{msg.title}</div>}
                  {msg.text}
                  {msg.streaming && <StreamingDots lang={lang} />}
                </div>

                {msg.warningNote && (
                  <div className="max-w-[92%] px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠️ {msg.warningNote}
                  </div>
                )}

                {msg.codeSnippet && (
                  <div className="max-w-[92%] w-full rounded-md overflow-hidden border border-[var(--panel-border-subtle)]">
                    <div className="px-2 py-1 bg-[var(--control-bg)] text-[9px] font-mono text-[var(--text-secondary)]">
                      {msg.codeSnippet.filename} · {msg.codeSnippet.oldPin} → {msg.codeSnippet.newPin}
                    </div>
                    <pre className="p-2 text-[9px] font-mono overflow-x-auto bg-[var(--panel-solid)] text-[var(--text-primary)]">
                      {msg.codeSnippet.code}
                    </pre>
                  </div>
                )}

                {msg.proposalCard && (
                  <div className="max-w-[92%] w-full rounded-md border border-[#007aff]/30 bg-[#007aff]/5 p-2.5">
                    <div className="text-[10px] font-semibold text-[#007aff] dark:text-[#0a84ff] mb-1">{msg.proposalCard.issueTitle}</div>
                    <p className="text-[10px] text-[var(--text-secondary)] mb-1.5">{msg.proposalCard.description}</p>
                    <p className="text-[10px] font-mono text-[var(--text-primary)] mb-2">{msg.proposalCard.suggestedFix}</p>
                    {fwProposalPending && (
                      <button
                        onClick={() => setSidebar("Firmware")}
                        className="w-full py-1 rounded-md mac-button-primary text-[10px] font-medium"
                      >
                        {t(lang, "reviewProposal")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {state.copilotTab === "Context" && (
          <div className="flex flex-col gap-2.5">
            <div className="p-3 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)]">
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase mb-2">{t(lang, "activeContextTitle")}</div>
              <div className="flex flex-col gap-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Project</span><span className="font-mono text-[var(--text-primary)]">{project?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-secondary)]">MCU</span><span className="font-mono text-[var(--text-primary)]">{selectedMcu || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Firmware</span><span className="font-mono text-[var(--text-primary)]">v{firmware.version || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Device</span><span className="font-mono text-[var(--text-primary)]">{runtime.deviceStage}</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-secondary)]">Provider</span><span className="font-mono text-[var(--text-primary)]">{runtime.providerAvailable ? "ok" : "down"}</span></div>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)]">
              <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase mb-2">Artifacts</div>
              <div className="flex flex-wrap gap-1">
                {(Object.entries(artifacts) as [string, { status: string; version: number }][]).map(([k, a]) => (
                  <span
                    key={k}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-mono ${
                      a.status === "stale"
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                        : a.status === "validated" || a.status === "accepted"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                        : a.status === "error"
                        ? "border-rose-500/30 bg-rose-500/10 text-rose-500"
                        : "border-[var(--panel-border-subtle)] bg-[var(--panel-solid)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {k}{a.version > 0 ? ` v${a.version}` : ""}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-secondary)] mt-2 leading-relaxed">{t(lang, "copilotContextDesc")}</p>
            </div>
          </div>
        )}

        {state.copilotTab === "History" && (
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase mb-1">{t(lang, "proposalHistoryTitle")}</div>
            {resolvedProposals.length === 0 && (
              <p className="text-[11px] text-[var(--text-secondary)]">{t(lang, "copilotEmpty")}</p>
            )}
            {resolvedProposals.map((p: any) => (
              <div key={p.id} className="p-2.5 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-[var(--text-primary)]">{p.title ?? `#${p.number}`}</span>
                  <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                    p.decision === "accepted" || p.status === "accepted" || (p.status === "pending" && firmware.stage === "accepted")
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-[var(--control-bg)] text-[var(--text-secondary)]"
                  }`}>
                    {p.decision === "rejected" || (firmware.stage === "rejected" && p.id?.startsWith("fw"))
                      ? t(lang, "rejected")
                      : t(lang, "accepted")}
                  </span>
                </div>
                {p.impacts && (
                  <span className="text-[9px] font-mono text-[var(--text-secondary)]">
                    {t(lang, "impactAreas")} {p.impacts.join(", ")}
                  </span>
                )}
              </div>
            ))}
            {firmware.stage === "accepted" && firmware.proposal && (
              <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <span className="text-[10px] font-mono text-emerald-500">
                  {t(lang, "strappingConflictResolved")} ({firmware.proposal.oldPin} → {firmware.proposal.newPin})
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入 */}
      <div className="p-3 border-t border-[var(--panel-border-subtle)]">
        {fwProposalPending && (
          <button
            onClick={() => setSidebar("Firmware")}
            className="w-full mb-2 py-1.5 rounded-md mac-button-primary text-[11px] font-medium"
          >
            {t(lang, "applyChanges")}
          </button>
        )}
        <div className="flex gap-1.5">
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={t(lang, "askCopilotPlaceholder")}
            disabled={!runtime.providerAvailable}
            className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#007aff] disabled:opacity-40"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || !runtime.providerAvailable}
            className="p-1.5 rounded-md mac-button-primary disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">send</span>
          </button>
        </div>
        {!runtime.providerAvailable && (
          <p className="text-[10px] text-rose-500 mt-1.5">{t(lang, "providerUnavailable")}</p>
        )}
      </div>
    </aside>
  );
};
