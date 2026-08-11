# ISSUE-001 — S1 Create Project end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** None — can start immediately
**Priority:** P0-blocking

## 1. User-visible outcome

用户在 Home 创建项目后进入工作区；刷新页面后项目仍然存在；归档项目后从活跃列表移除（归档确认对话框 + Impact 展示）。

## 2. Frozen upstream references

- UI：Home Dashboard（创建/模板卡、删除确认）、ui-state-model.md（G1 Idle / G2 Empty）、ui-acceptance-report.md
- Interaction Contract：A1 Create Project / A3 Archive Project
- Application Capability：create_project / archive_project（application-contract 2.1）
- Domain Invariant：I-10（归档语义，不静默级联物理删除）；Project 生命周期（domain-contract 6.1）
- Product Decision：D6（删除=归档）
- ADR：0003（架构风格）、0004（本地持久化 SQLite）、0013（TS 运行时）
- Implementation Spec：§4 Scope、§5 目录/工作区、§8 表审查、§9 PersistencePort、§10.1 HTTP、§15 S1

## 3. In scope

- 仓库最小骨架：根 package.json（npm scripts：dev/typecheck/lint/test/e2e:golden）、tsconfig、eslint 最小配置、vitest 配置、目录骨架（app/application/domain/ports/adapters/infrastructure/shared-contracts/tests）
- 最小 HTTP 服务器（Express）：POST/GET /projects、GET /projects/:id、POST /projects/:id/archive、GET /health；错误信封（§10.2）；Idempotency-Key
- 最小 Project 领域类型（id/name/createdAt/archivedAt/archivedReason）+ 合法迁移（active→archived）
- PersistencePort 最小集：withTransaction + UoW（saveProject/archiveProject/getProject/listProjects）；SQLite 适配器（better-sqlite3 + WAL + foreign_keys）；**只建 projects 表 + schema_migrations**
- UI：冻结 Mock 的 createProject/openProject/archive 切换到 HTTP 客户端（Progressive Swap 第一刀）
- 最小 workspace：<workspace>/<slug>/project.json 镜像

## 4. Out of scope

- 其余 8 张表（artifacts/versions/proposals/build_records/validation_records/stale_marks/tasks/preferences）——S2 起随 Slice 建
- Artifact/Proposal/Build/Stale/Device 任何逻辑与路由
- 其余 HTTP 路由（/commands、/device、SSE、/builds 等）
- Cloud Adapter、Auth、Mock fallback 双路径

## 5. Mock being replaced

```
mockCreateProject()（AppContext CREATE_PROJECT，内存态）
→ real create_project capability（POST /projects → SQLite projects 表）
mock archive（删除确认后仅从数组移除）
→ real archive_project（archived_at + Impact 摘要）
```

## 6. End-to-end flow

```
UI Home "创建空白项目" → POST /projects {name}
→ Application create_project → Domain Project（合法迁移校验）
→ PersistencePort.withTransaction(uow.saveProject) → SQLite projects 表 + project.json 镜像
→ 201 {project} → UI 进入 Workspace（Requirements 空态）
→ 刷新页面 → GET /projects → 项目仍存在
→ "删除" → 确认对话框 → POST /projects/:id/archive {confirmationToken}
→ archived_at 置值 → 列表移除（历史保留）
```

## 7. Minimum domain changes

- 仅 Project 类型与迁移（active→archived）；不建其他 7 对象

## 8. Minimum persistence changes

- 表：projects（id/name/created_at/archived_at/archived_reason）+ schema_migrations
- 索引：无额外（主键即查询路径）
- Workspace：<slug>/project.json 镜像

## 9. Ports / Adapters

- PersistencePort（UoW 最小集：saveProject/archiveProject/getProject/listProjects）→ SQLite 适配器
- 仅此一个 Port 的真实实现；其余 Port 本票不建（接口留到使用它们的 Slice）

## 10. Error states

- 400 invalid_name；404 not_found；403 confirmation_missing（archive）；409 归档后编辑被拒（只读）

## 11. Tests first

- Domain：Project 迁移（active→archived；归档后禁编辑）
- Application：create_project/archive_project（幂等、确认令牌）
- Persistence：projects 表约束、事务回滚（UoW 失败不留行）、WAL 开启
- Contract：POST/GET /projects、archive、错误信封、Idempotency-Key
- Browser/E2E：见 §12

## 12. Browser acceptance

```
打开 Home → 点"创建空白项目" → 进入工作区（Requirements 空态）
→ 刷新页面 → 回 Home → 项目卡仍在
→ 点"删除" → 确认对话框 → 确认 → 项目移出列表
→ 刷新 → 仍不在列表（归档语义，无历史丢失提示）
```

## 13. Definition of Done

- `npm run typecheck` / `npm run lint` / `npm test` 全绿（含本票新增测试）
- 浏览器验收步骤全过；Mock createProject/archive 生产路径已删除（Mock 仅可留测试 fixture）
- 无 try-real/catch-mock 双路径；无未使用路由

## 14. Forbidden shortcuts

- 禁止硬编码项目（如内存 map 顶替 SQLite）
- 禁止 UI 直接访问 SQLite/领域
- 禁止一次性建全部表/全部路由/全部 Ports（大爆炸 S1）
- 禁止引入 generic repository framework / CommandBus
- 禁止本票顺手实现 Artifact/Proposal/Build 逻辑（未来 Slice）
- 若缺脚本：本票先增加最小脚本（typecheck/lint/test/e2e:golden），不得发明不存在的命令

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S1 范围）：
- `src/domain/models/project.ts` — Project 聚合（create/archive 不变量、I-10 归档语义）
- `src/ports/persistence.ts` — PersistencePort（UnitOfWork，同步方法=对 better-sqlite3 诚实；无 God Interface）
- `src/adapters/persistence/sqlite/` — connection（WAL+foreign_keys）、migrations（仅 projects 表+schema_migrations）、project-store
- `src/application/capabilities/projects.ts` — createProject/getProject/listProjects/archiveProject（显式函数，无 Command 框架）
- `src/adapters/http/app.ts` — 最小 surface：POST/GET /projects、GET /projects/:id、archive-token、archive、health；错误信封；Idempotency-Key（内存，transport 层）
- `src/adapters/http/error.ts` — ApiError + withErrorHandler（复用旧模式）
- `src/infrastructure/` — config/server/workspace（project.json 镜像，best-effort）
- `app/` — 冻结 Mock UI 迁移（vite root 修正为 ESM-safe）；`api/client.ts`；AppContext create/open/archive → 真实 API（Progressive Swap 第一刀，无 fallback）
- `tests/` — domain 7 / application 7 / persistence 6 / contract 9 / e2e 1 = 30

**Migration**：001_create_projects（幂等；schema 随 Slice 增长，未提前建表）

**Tests**：`npm test` 30/30 绿；`npm run typecheck` 0 错；`npm run lint` 0 错；`npm run e2e:golden` 绿

**Browser evidence**：真实 Chrome 走查——创建→工作区→刷新持久→再次打开同一项目→归档（确认+Impact+移出活跃列表+记录保留）→停服错误呈现（无 Mock 回退）→恢复

**Commit**：`62c6ca5 feat: implement project creation vertical slice`（46 files，+13511；未含 AGENTS/CLAUDE 既有改动与 docs/.scratch 交付物）

**Remaining mock**：app/src/mock/engine.ts 仍被工作区 mock Journey（Requirements 等视图）使用——属后续 Slice（S3 起）的 Progressive Swap 范围；**生产 Create Project 路径已完全真实**，无 try/catch fallback

**Deviations**：
1. Idempotency-Key 为内存实现（transport 层；重启即失，S1 记录在案，持久化幂等存储随需要引入）
2. archive confirmationToken 为一次性短时效（60s）服务端签发令牌（D6 确认语义的最小实现；S9 Flash 复用同一机制）
3. `npm run lint` 的 eslint 版本固定为 9.x（@eslint/js@9 与 eslint 10 peer 冲突解决）
4. Vite dev root 修正（ESM 下 __dirname 未定义 → fileURLToPath）
