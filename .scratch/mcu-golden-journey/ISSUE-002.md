# ISSUE-002 — S2 Manual Artifact Version end-to-end

**Status:** resolved（2026-08-11，交付记录见下）
**Blocked by:** ISSUE-001（Create Project e2e）
**Priority:** P0-blocking

## 1. User-visible outcome

用户在 Wiring 视图手动修改引脚（或其他可编辑内容）后提交，生成新的 ArtifactVersion；版本徽标 +1；刷新后版本历史可见；**无需 Proposal**（Decision 4 人工豁免）。

## 2. Frozen upstream references

- UI：引脚表行内编辑（PinEditor）、版本徽标、ui-state-model.md（W9/W10、O5 Artifact 状态）
- Interaction Contract：D4 Edit Pin（手动编辑免提案）
- Application Capability：commit_manual_edit（application-contract 2.1b）
- Domain Invariant：I-2（版本不可变）、I-11（手动编辑免提案，仅所有者路径；仍触发依赖求值——依赖求值本票只留接口占位，S5B 实现）
- Product Decision：D4、D2（版本=内容身份）
- ADR：0004（SQLite）、0006（ArtifactContentPort）、0013（TS）
- Implementation Spec：§5 目录/工作区、§7 版本提交语义（Manual Edit 事务 T1）、§8 表、§10.1（POST /artifacts/:aid/versions）、§15 S2

## 2b. 注意（跨票约束）

- 依赖求值（stale_marks）在 S5B 实现；本票版本提交后只发 `artifact.version.created` 事件（事件发布留占位），不实现 Stale 标记——**禁止本票提前实现 Stale 逻辑**

## 3. In scope

- Artifact（5 kind 枚举）与 ArtifactVersion 领域类型（不可变：contentRef/contentHash 创建后禁改）
- ArtifactContentPort：store/load/hash（SHA-256）→ **Workspace Files 适配器**（版本目录原子写：临时目录→rename）
- PersistencePort 扩展：UoW 增 createArtifact/setCurrentVersion/createVersion/setVersionStatus/getVersion/listVersions/getArtifactByKind；SQLite 增 artifacts + artifact_versions 表
- commit_manual_edit capability：POST /artifacts/:aid/versions（事务 T1：写内容→插版本→更新 current 指针→发事件）
- UI：Wiring 行内编辑提交走真实 capability；版本历史视图（GET /artifacts/:aid/versions）在引脚表旁展示
- 事件：artifact.version.created（逻辑事件；SSE 端点本票建最小 /events 订阅——若过重可延后 S3A，见 Out of scope）

## 4. Out of scope

- Proposal / AI 路径（S3B）——本票只有手动路径
- Stale 求值与 stale_marks 表（S5B）
- 其余 kind 的内容语义（requirement/hardware/firmware 的具体 payload 形状随各自 Slice）
- 其余 Ports（AI/Task/Compiler/Device）
- 依赖求值实现、Revalidate

## 5. Mock being replaced

```
mockEditPin / mockCommit（AppContext PIN_EDITED + 版本 +1，内存态）
→ real commit_manual_edit（POST /artifacts/:aid/versions → SQLite 版本行 + Workspace 内容文件）
mock 版本徽标（firmware.version 等内存字段）
→ real listVersions（GET /artifacts/:aid/versions）
```

## 6. End-to-end flow

```
UI 引脚行内编辑 → POST /artifacts/:aid/versions {content}
→ Application commit_manual_edit（校验所有者路径）
→ Domain：ArtifactVersion 创建（source_kind='manual'，status='accepted'，version_no 单调）
→ PersistencePort.withTransaction：
    a. ArtifactContentPort.store（版本目录原子写 + SHA-256）
    b. uow.createVersion + uow.setCurrentVersion
→ 201 {version} → UI 版本徽标 v+1
→ 刷新 → GET /artifacts/:aid/versions → 历史可见（含 v1、v2）
→ artifact.version.created 事件（订阅端收到）
```

## 7. Minimum domain changes

- Artifact + ArtifactVersion 类型、状态机（draft→accepted 等合法迁移；内容字段禁改不变量）
- 仅此；Proposal/BuildRecord 等对象不建

## 8. Minimum persistence changes

- 表：artifacts（project_id/kind UNIQUE(project_id,kind)/current_version_id）、artifact_versions（artifact_id/version_no UNIQUE/content_ref/content_hash/status/source_kind/source_proposal_id NULL/created_at/created_by）
- 索引：idx_versions_artifact(artifact_id, version_no)
- Workspace：按 kind 内容目录（本票以 pin_map 演示；目录结构见 Spec §8.2）

## 9. Ports / Adapters

- ArtifactContentPort → Workspace Files（本票首个真实实现）
- PersistencePort 扩展（UoW 上述方法）→ SQLite
- EventPort 占位（publish 记录到内存/日志；SSE 端点如实现则最小化——见 §3）

## 10. Error states

- 404 not_found（artifact）；400 invalid_content；409（版本内容不可变被违反——防篡改测试）；不可变规则：对 content 字段的 UPDATE 必须被拒绝

## 11. Tests first

- Domain：版本不可变（创建后 contentRef/contentHash 修改被拒）、version_no 单调、手动路径免提案
- Application：commit_manual_edit（所有者校验、幂等键）
- Persistence：UNIQUE(artifact_id, version_no)、事务 T1 原子性（内容写失败→无版本行）、WAL
- Adapter：WorkspaceFiles store/load/hash、原子写（临时目录清理）
- Contract：POST /artifacts/:aid/versions、GET 版本列表、错误信封
- Browser/E2E：见 §12

## 12. Browser acceptance

```
打开项目 → Wiring 视图 → 点引脚号 → 编辑为 IO21 → OK
→ 版本徽标 v1 → v2
→ 刷新页面 → Wiring 视图 → 版本历史下拉/列表可见 v1、v2
→ 打开 v1 → 内容为旧值（不可变历史可见）
```

## 13. Definition of Done

- typecheck/lint/test 全绿（含不可变与事务测试）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock editPin/commit 生产路径删除
- 无 fallback 双路径；无 Stale 逻辑混入（S5B 边界）

## 14. Forbidden shortcuts

- 禁止将内容存 SQLite JSON（必须走 ArtifactContentPort/Workspace 文件）
- 禁止可变版本（原地 UPDATE content）
- 禁止本票实现 Proposal/Stale/依赖求值（未来 Slice）
- 禁止 UI 直接写库；禁止 mock fallback

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（均为 S2 范围）：
- `src/domain/models/artifact.ts` — Artifact 聚合（5 kind 校验、懒创建语义）+ ArtifactVersion（不可变冻结 I-2、version_no 正数、draft→accepted 合法迁移）
- `src/ports/artifact-content.ts` — ArtifactContentPort（ADR-0006：store/load/hash）
- `src/adapters/artifact-content/workspace-files.ts` — Workspace Files 适配器（版本目录原子写：临时文件→rename；SHA-256；布局 `<ws>/<projectId>/<kind>/NNNN.json`）
- `src/ports/events.ts` + `src/adapters/events/noop.ts` — EventPort 占位（publish 记录日志；SSE 端点延后 S3A，ISSUE-002 §3 明示允许）
- `src/application/capabilities/artifacts.ts` — ensureArtifact（懒创建幂等）+ commitManualEdit（事务 T1：写内容→插版本→更新 current→发事件；I-11 免 Proposal；内容失败→无版本行；UNIQUE 冲突重试有界 3 次）
- PersistencePort 扩展（UoW createArtifact/setCurrentVersion/createVersion/setVersionStatus + 只读 getArtifact/getArtifactByKind/listArtifacts/getVersion/listVersions）
- 迁移 002：artifacts + artifact_versions（kind CHECK 5、UNIQUE(project_id,kind)、UNIQUE(artifact_id,version_no)、I-2 不可变触发器）
- HTTP：POST/GET /projects/:pid/artifacts、POST/GET /artifacts/:aid/versions、GET /versions/:vid（错误信封；Idempotency-Key 重放）
- UI（Progressive Swap）：Wiring 行内编辑 → 真实 commit_manual_edit（版本徽标取服务端 versionNo）；版本历史面板（真实 listVersions + 打开旧版本内容）

**Tests**：domain 8 / application 9 / persistence 9 / adapter 5 / contract 9 / e2e 1 = 41（S2 新增）；`npm test` 71/71 全绿；typecheck/lint 0

**Browser evidence**（真实 Chrome）：创建项目→Mock Journey→Wiring→编辑 IO12→IO21→OK→徽标 v1→再编辑 IO5→徽标 v2→刷新→历史 v1/v2 仍在→打开 v1→旧内容（IO21，不可变）。截图 `.scratch/mcu-golden-journey/evidence/s2-version-history.png`；DB 实测仅 4 表（projects/artifacts/artifact_versions/schema_migrations）；workspace 实测 `<projectId>/pinmap/0001.json`+`0002.json`（内容本体在文件，非 SQLite JSON）

**Deviations**：
1. workspace 内容目录用 `<projectId>/` 而非 spec 示例的 slug 目录（内容引用稳定、不随改名失效；镜像 project.json 仍在 slug 目录）
2. SSE /events 端点延后 S3A（ISSUE-002 §3 明示：若过重可延后）；EventPort 以 noop 适配器占位
3. `POST /projects/:pid/artifacts`（ensure）为 201 幂等返回同一实例；spec §10.1 表格未列该路由，为 commit_manual_edit 前置聚合容器的必要最小入口（与 ISSUE-002 §8 懒创建语义一致）
4. UNIQUE(artifact_id, version_no) 冲突在应用层有界重试（单用户本地并发窗口极小；兜底仍由 DB 约束保证）
