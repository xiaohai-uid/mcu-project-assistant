import React from "react";
import { format, t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { EmptyState, ErrorBanner, InfoBanner, StreamingDots } from "./ui";

export const RequirementsView: React.FC = () => {
  const {
    state,
    dispatch,
    startDiscovery,
    cancelDiscovery,
    answerClarification,
    skipClarification,
    setProposalDecision,
    proceedToHardware,
  } = useApp();
  const { lang, discovery, discoveryPrompt, runtime, artifacts } = state;
  const d = discovery;

  const acceptedCount = d.proposals.filter((p) => p.decision === "accepted").length;
  const analyzing = d.stage === "analyzing" || d.stage === "clarifying";
  const phaseLabel = d.analysisPhase
    ? d.analysisPhase.phase === "processing"
      ? (lang === "zh" ? "正在处理 AI 结果…" : "Processing AI result…")
      : d.analysisPhase.operation === "generate_structured"
        ? (lang === "zh" ? "等待结构化 AI 结果…" : "Waiting for structured AI result…")
        : d.analysisPhase.phase === "provider_streaming"
          ? (lang === "zh" ? "正在接收 AI 响应…" : "Receiving AI response…")
          : (lang === "zh" ? "等待 AI 服务响应…" : "Waiting for AI provider…")
    : (lang === "zh" ? "分析任务运行中…" : "Analysis is running…");

  const proposalTone = (decision: string) =>
    decision === "accepted"
      ? "bg-[var(--control-bg)] border-[#007aff]/30"
      : decision === "rejected"
      ? "bg-[var(--control-bg)] border-[var(--panel-border-subtle)] opacity-60"
      : "bg-[var(--panel-solid)] border-[var(--panel-border-subtle)]";

  return (
    <div className="flex-1 px-6 py-6 max-w-[960px] mx-auto flex flex-col gap-5 pb-20">
      {/* 全局提示条 */}
      {runtime.online === false && (
        <InfoBanner icon="cloud_off" title={t(lang, "offlineNotice")} lang={lang} tone="amber" />
      )}
      {runtime.providerAvailable === false && (
        <InfoBanner
          icon="cloud_off"
          title={t(lang, "providerUnavailable")}
          desc={t(lang, "providerUnavailableDesc")}
          lang={lang}
          tone="rose"
        />
      )}

      {/* 1. Discovery 输入卡 */}
      <section className="mac-card p-5">
        <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-1">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          <span>{t(lang, "reqCategory")}</span>
        </div>
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1 tracking-tight">{t(lang, "reqTitle")}</h1>
        <p className="text-xs text-[var(--text-secondary)] mb-3.5 leading-relaxed">{t(lang, "reqSubtitle")}</p>

        <div className="relative">
          <textarea
            value={discoveryPrompt}
            onChange={(e) => dispatch({ type: "SET_PROMPT", prompt: e.target.value })}
            rows={4}
            placeholder={t(lang, "reqPlaceholder")}
            disabled={analyzing}
            className="w-full bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] rounded-lg p-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#007aff] resize-none leading-relaxed transition-colors disabled:opacity-60"
          />
        </div>

        <div className="mt-3 flex justify-between items-center">
          <button
            onClick={() => dispatch({ type: "SET_PROMPT", prompt: "" })}
            disabled={analyzing}
            className="px-3 py-1.5 mac-button-secondary rounded-md text-xs transition-colors disabled:opacity-40"
          >
            {t(lang, "clearText")}
          </button>
          <div className="flex items-center gap-2">
            {analyzing && (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]" role="status">
                <span className="material-symbols-outlined text-[14px]">hourglass_top</span>
                <span>{phaseLabel}</span>
              </div>
            )}
            {analyzing && (
              <button onClick={cancelDiscovery} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs text-rose-500">
                {t(lang, "cancel")}
              </button>
            )}
            <button
              onClick={startDiscovery}
              disabled={
                analyzing ||
                !discoveryPrompt.trim() ||
                runtime.online !== true ||
                runtime.providerAvailable === false ||
                artifacts.requirements.status === "accepted"
              }
              className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {analyzing ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[15px]">autorenew</span>
                  <span>{t(lang, "parsingReq")}</span>
                </>
              ) : (
                <>
                  <span>{t(lang, "startDiscovery")}</span>
                  <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 流式输出 */}
        {analyzing && d.streamedText && (
          <div className="mt-3 p-3 rounded-lg bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] font-mono text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
            {d.streamedText}
            <StreamingDots lang={lang} />
          </div>
        )}
      </section>

      {/* 失败态 */}
      {d.stage === "error" && (
        <ErrorBanner
          title={t(lang, "discoveryErrorTitle")}
          desc={d.error?.message ?? undefined}
          onRetry={startDiscovery}
          retryLabel={t(lang, "retry")}
          lang={lang}
        />
      )}
      {d.stage === "cancelled" && (
        <InfoBanner icon="cancel" title={t(lang, "cancelled")} desc="No artifacts were modified." lang={lang} />
      )}

      {/* 2. 能力卡 */}
      {d.capabilities.length > 0 && d.stage !== "error" && (
        <section className="mac-card p-5 flex flex-col gap-4">
          <header className="flex justify-between items-start border-b border-[var(--panel-border-subtle)] pb-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "capabilitiesTitle")}</h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                  <span className="material-symbols-outlined text-[13px]">check_circle</span>
                  {t(lang, "aiSynthesized")}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {d.capabilities.some((c) => c.status !== "complete")
                  ? format(t(lang, "partialSuccess"), {
                      ok: String(d.capabilities.filter((c) => c.status === "complete").length),
                      total: String(d.capabilities.length),
                    })
                  : "Technical specifications parsed directly from prompt description."}
              </p>
            </div>
            <div className="flex items-center gap-1.5 bg-[var(--control-bg)] px-2.5 py-1 rounded-md border border-[var(--panel-border-subtle)] text-xs text-[var(--text-primary)]">
              <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-[16px]">psychology</span>
              <span>
                <strong className="text-[#007aff] dark:text-[#0a84ff] font-mono">{d.capabilities.length}</strong>{" "}
                {format(t(lang, "capabilitiesCount"), { count: String(d.capabilities.length) })}
              </span>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {d.capabilities.map((req) => (
              <div key={req.id} className="p-3.5 bg-[var(--control-bg)] rounded-lg border border-[var(--panel-border-subtle)] flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff]">
                        <span className="material-symbols-outlined text-[16px]">{req.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{req.title}</h3>
                        <p className="text-[11px] text-[var(--text-secondary)] font-mono">{req.type}</p>
                      </div>
                    </div>
                    {req.isWarning ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-300 text-[10px] font-medium">
                        {t(lang, "clarificationPending")}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
                        {t(lang, "extracted")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 mb-2.5 leading-relaxed">{req.details}</p>
                </div>
                <div className="w-full bg-[var(--panel-border-subtle)] h-1 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${req.isWarning ? "bg-amber-500" : "bg-[#007aff] dark:bg-[#0a84ff]"}`}
                    style={{ width: `${req.progress}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 澄清卡 */}
      {d.stage === "clarifying" && d.clarification && (
        <section className="mac-card p-5">
          <div className="flex items-center gap-1.5 text-amber-500 text-xs font-semibold mb-1">
            <span className="material-symbols-outlined text-sm">help</span>
            <span>{t(lang, "clarificationTitle")}</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">{t(lang, "clarificationDesc")}</p>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-[var(--text-primary)] mb-3">
            <strong>{d.clarification.question}</strong>
            {d.clarification.detail && <p className="text-[11px] text-[var(--text-secondary)] mt-1">{d.clarification.detail}</p>}
          </div>
          <div className="flex gap-2">
            <input
              value={d.clarification.answer}
              onChange={(e) =>
                state.discovery.clarification && dispatch({ type: "DISC_CLARIFICATION", c: { ...d.clarification!, answer: e.target.value } })
              }
              placeholder={'0.96" SSD1306'}
              className="flex-1 px-3 py-1.5 rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#007aff]"
            />
            <button onClick={() => answerClarification(d.clarification!.answer)} className="px-3 py-1.5 mac-button-primary rounded-md text-xs">
              {t(lang, "clarificationSubmit")}
            </button>
            <button onClick={skipClarification} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs">
              {t(lang, "clarificationSkip")}
            </button>
          </div>
        </section>
      )}

      {/* 3. 提案审阅 */}
      {d.proposals.length > 0 && d.stage !== "error" && (
        <section className="mac-card p-5 flex flex-col gap-4">
          <header className="border-b border-[var(--panel-border-subtle)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">{t(lang, "specReviewTitle")}</h2>
            <p className="text-xs text-[var(--text-secondary)]">{t(lang, "specReviewSubtitle")}</p>
          </header>

          <div className="flex flex-col gap-3">
            {d.proposals.map((item) => (
              <div key={item.id} className={`p-3.5 rounded-lg border transition-all ${proposalTone(item.decision)}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#007aff] dark:text-[#0a84ff] px-1.5 py-0.5 bg-[#007aff]/10 border border-[#007aff]/20 rounded">
                      #{item.number}
                    </span>
                    <h3 className="text-xs font-semibold text-[var(--text-primary)]">{item.title}</h3>
                  </div>

                  {/* 三态决策：Accept / Reject / Undo */}
                  <div className="flex items-center gap-1.5">
                    {item.decision === "accepted" && (
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
                        {t(lang, "accepted")}
                      </span>
                    )}
                    {item.decision === "rejected" && (
                      <span className="px-2 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[var(--text-secondary)] text-[10px] font-medium">
                        {t(lang, "rejected")}
                      </span>
                    )}
                    {item.decision === "pending" && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
                        {t(lang, "pendingReview")}
                      </span>
                    )}
                    <button
                      onClick={() => setProposalDecision(item.id, item.decision === "accepted" ? "rejected" : "accepted")}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        item.decision === "accepted"
                          ? "mac-button-secondary text-[var(--text-secondary)]"
                          : "mac-button-primary"
                      }`}
                    >
                      {item.decision === "accepted" ? t(lang, "reject") : t(lang, "acceptChange")}
                    </button>
                  </div>
                </div>

                {/* Diff 对比 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 my-2 text-xs">
                  <div className="p-2.5 bg-rose-500/5 rounded-md border border-rose-500/20">
                    <span className="text-[10px] font-semibold text-rose-500 dark:text-rose-400 uppercase block mb-1">
                      {t(lang, "initialConcept")}
                    </span>
                    <p className="text-[var(--text-secondary)] italic text-xs leading-relaxed">{item.initialIdea}</p>
                  </div>
                  <div className="p-2.5 bg-[#007aff]/5 rounded-md border border-[#007aff]/20">
                    <span className="text-[10px] font-semibold text-[#007aff] dark:text-[#0a84ff] uppercase block mb-1">
                      {t(lang, "formalSpec")}
                    </span>
                    <p className="text-[var(--text-primary)] text-xs leading-relaxed">{item.formalizedRequirement}</p>
                  </div>
                </div>

                {/* 影响领域 */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">{t(lang, "impactAreas")}</span>
                  {item.impacts.map((tag, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-[var(--panel-solid)] rounded border border-[var(--panel-border-subtle)] text-[10px] text-[var(--text-secondary)] font-mono">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* AI 不静默覆盖原则提示 */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#007aff]/5 border border-[#007aff]/15 text-[11px] text-[var(--text-secondary)]">
            <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-[15px]">verified_user</span>
            {t(lang, "aiNeverOverwrites")}
          </div>

          {/* 底部动作 */}
          <div className="mt-1 p-3 bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] rounded-lg flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)] block">{t(lang, "readyTopology")}</span>
              <span className="text-xs text-[var(--text-secondary)]">{t(lang, "readyTopologyDesc")}</span>
            </div>
            <button
              onClick={proceedToHardware}
              disabled={acceptedCount === 0}
              className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <span>{t(lang, "proceedToHw")}</span>
              <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
            </button>
          </div>
        </section>
      )}

      {/* 空态（未开始） */}
      {d.capabilities.length === 0 && d.stage === "idle" && (
        <EmptyState
          icon="psychology"
          title={t(lang, "emptyRequirements")}
          desc={t(lang, "emptyRequirementsDesc")}
          lang={lang}
        />
      )}
    </div>
  );
};
