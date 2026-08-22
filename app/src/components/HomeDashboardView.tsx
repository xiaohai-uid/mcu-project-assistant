import React, { useCallback, useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { EmptyState, InfoBanner } from "./ui";
import { TEMPLATES } from "../mock/engine";
import { api, type ProjectDto } from "../api/client";
import { ReadinessGatesStrip } from "./ReadinessBadgeStrip";

// R3（应用架构评审 2026-08-22）：项目卡只展示真实存在的字段（ProjectDto），
// 就绪态来自交付门禁报告；不再伪造 version/status/target/size 占位数据。

export const HomeDashboardView: React.FC = () => {
  const { state, createProject, openProject, archiveProject } = useApp();
  const { lang } = state;
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const ok = await createProject();
      if (ok) {
        void refresh();
      } else {
        setCreateError("创建失败：请检查本地工作区服务是否在运行（Create failed: local workspace server unreachable）");
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    setArchiving(true);
    const ok = await archiveProject(id);
    setArchiving(false);
    setConfirmDelete(null);
    if (ok) void refresh();
  };

  return (
    <main className="pt-[52px] pb-12 px-6 md:px-8 max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* 左列：动作与模板 */}
      <aside className="lg:col-span-3 flex flex-col gap-5">
        <div
          onClick={() => void handleCreate()}
          className="mac-card p-5 flex flex-col items-center justify-center text-center gap-3 cursor-pointer hover:bg-[var(--control-hover)] transition-colors group"
        >
          <div className="w-10 h-10 rounded-lg bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] flex items-center justify-center">
            <span className="material-symbols-outlined text-[20px]">{creating ? "autorenew" : "add"}</span>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-[var(--text-primary)] mb-0.5">{t(lang, "createNewProjectTitle")}</h2>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{t(lang, "createNewProjectDesc")}</p>
          </div>
          <button className="mt-1 w-full mac-button-primary text-xs font-medium py-1.5 px-3 rounded-md transition-colors shadow-sm">
            {creating ? t(lang, "parsingReq") : t(lang, "initBlankBtn")}
          </button>
        </div>

        {createError && (
          <InfoBanner icon="error" title={t(lang, "discoveryErrorTitle")} desc={createError} lang={lang} tone="rose" />
        )}

        <div className="mac-card overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#007aff] dark:text-[#0a84ff] text-sm">widgets</span>
              <span>{t(lang, "starterTemplatesTitle")}</span>
            </h3>
          </div>
          <div className="flex flex-col">
            {TEMPLATES.map((tmpl, index) => (
              <div
                key={tmpl.id}
                onClick={() => void handleCreate()}
                className={`p-3.5 hover:bg-[var(--control-hover)] cursor-pointer transition-colors flex gap-3 items-start ${
                  index < TEMPLATES.length - 1 ? "border-b border-[var(--panel-border-subtle)]" : ""
                }`}
              >
                <div className="p-1.5 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded shrink-0">
                  <span className="material-symbols-outlined text-[16px]">{tmpl.icon}</span>
                </div>
                <div>
                  <h4 className="text-xs text-[var(--text-primary)] font-semibold mb-0.5">{tmpl.title}</h4>
                  <p className="text-[11px] text-[var(--text-secondary)] mb-1.5 leading-relaxed">{tmpl.description}</p>
                  <span className="inline-block px-1.5 py-0.2 bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[#007aff] dark:text-[#0a84ff] rounded text-[10px] font-mono">
                    {tmpl.badge}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* 右列：最近项目（真实 API 列表，Progressive Swap） */}
      <section className="lg:col-span-9 flex flex-col gap-4">
        <header className="flex items-center justify-between mb-0.5">
          <div>
            <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "recentProjectsTitle")}</h1>
            <p className="text-xs text-[var(--text-secondary)]">{t(lang, "recentProjectsDesc")}</p>
          </div>
        </header>

        {loadError && (
          <InfoBanner icon="cloud_off" title={t(lang, "providerUnavailable")} desc={loadError} lang={lang} tone="rose" />
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="mac-card p-4 animate-pulse bg-[var(--control-bg)] h-40" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="folder_open"
            title={t(lang, "noProjects")}
            desc={t(lang, "noProjectsDesc")}
            lang={lang}
            action={
              <button
                onClick={() => void handleCreate()}
                className="px-4 py-1.5 mac-button-primary rounded-md text-xs font-medium"
              >
                {t(lang, "initBlankBtn")}
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((proj) => {
              return (
                <div key={proj.id} className="mac-card p-4 flex flex-col h-full hover:border-[var(--text-secondary)]/30 transition-all group">
                  <div className="flex justify-between items-start mb-3 gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded-md flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[17px]">developer_board</span>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-[var(--text-primary)] truncate">{proj.name}</h3>
                        <p className="font-mono text-[11px] text-[var(--text-secondary)]">{new Date(proj.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    {proj.archivedAt && (
                      <span className="shrink-0 px-2 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[10px] font-mono text-[var(--text-secondary)]">
                        {t(lang, "projectArchived")}
                      </span>
                    )}
                  </div>

                  {/* R2：每卡三态就绪徽章（真实门禁数据，无数据则不显示） */}
                  <div className="flex-1 flex items-start">
                    <ReadinessGatesStrip projectId={proj.id} lang={lang} />
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[var(--panel-border-subtle)] flex justify-end gap-2">
                    <button
                      onClick={() => setConfirmDelete(proj.id)}
                      className="px-2.5 py-1 mac-button-secondary rounded-md text-xs font-mono text-rose-500 transition-colors"
                    >
                      {t(lang, "deleteProject")}
                    </button>
                    <button
                      onClick={() => void openProject(proj.id)}
                      className="px-3 py-1 mac-button-primary rounded-md text-xs font-medium transition-colors flex items-center gap-1 shadow-sm"
                    >
                      <span className="material-symbols-outlined text-[14px]">folder_open</span>
                      <span>{t(lang, "openWorkspace")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 归档确认（D6：Impact 展示 + 一次性令牌经应用层校验） */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mac-card w-[360px] p-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{t(lang, "deleteConfirm")}</h3>
            <p className="text-[11px] text-[var(--text-secondary)] mb-4">
              {t(lang, "deleteProject")} · Impact: {1} project
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs">
                {t(lang, "cancel")}
              </button>
              <button
                onClick={() => void handleArchive(confirmDelete)}
                disabled={archiving}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 transition-colors disabled:opacity-50"
              >
                {archiving ? t(lang, "retrying") : t(lang, "deleteProject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
