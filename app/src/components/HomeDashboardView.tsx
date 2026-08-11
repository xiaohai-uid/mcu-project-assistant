import React, { useCallback, useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { EmptyState, InfoBanner } from "./ui";
import { TEMPLATES } from "../mock/engine";
import { api, type ProjectDto } from "../api/client";

interface ProjectCard {
  id: string;
  title: string;
  version: string;
  status: "Stale" | "Validated" | "Draft";
  target: string;
  rtosOrFramework: string;
  frameworkType: "RTOS" | "Framework";
  lastEdit: string;
  size: string;
  icon: string;
}

function toCard(p: ProjectDto): ProjectCard {
  return {
    id: p.id,
    title: p.name,
    version: "v0.1.0-draft",
    status: "Draft",
    target: "—",
    rtosOrFramework: "—",
    frameworkType: "Framework",
    lastEdit: new Date(p.createdAt).toLocaleString(),
    size: "—",
    icon: "developer_board",
  };
}

export const HomeDashboardView: React.FC = () => {
  const { state, createProject, openProject, archiveProject } = useApp();
  const { lang } = state;
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list.map(toCard));
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
              const statusKey =
                proj.status === "Validated" ? "statusValidated" : proj.status === "Stale" ? "statusStale" : "statusDraft";
              const statusColor =
                proj.status === "Validated" ? "bg-emerald-500" : proj.status === "Stale" ? "bg-rose-500" : "bg-[var(--text-muted)]";
              return (
                <div key={proj.id} className="mac-card p-4 flex flex-col h-full hover:border-[var(--text-secondary)]/30 transition-all group">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-[#007aff]/10 text-[#007aff] dark:text-[#0a84ff] rounded-md flex items-center justify-center">
                        <span className="material-symbols-outlined text-[17px]">{proj.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">{proj.title}</h3>
                        <p className="font-mono text-[11px] text-[var(--text-secondary)]">{proj.version}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[11px] font-mono">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`}></span>
                      <span className="font-mono text-[11px] text-[var(--text-primary)]">{t(lang, statusKey as never)}</span>
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="grid grid-cols-2 gap-y-1 font-mono text-[11px] text-[var(--text-secondary)] bg-[var(--control-bg)] p-2 rounded-md border border-[var(--panel-border-subtle)]">
                      <div>
                        {t(lang, "projectTarget")}: <span className="text-[var(--text-primary)] font-semibold">{proj.target}</span>
                      </div>
                      <div>
                        {t(lang, "projectFramework")}: <span className="text-[var(--text-primary)] font-semibold">{proj.rtosOrFramework}</span>
                      </div>
                      <div>
                        {t(lang, "projectLastEdit")}: <span className="text-[var(--text-primary)]">{proj.lastEdit}</span>
                      </div>
                      <div>
                        {t(lang, "projectSize")}: <span className="text-[var(--text-primary)]">{proj.size}</span>
                      </div>
                    </div>
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
