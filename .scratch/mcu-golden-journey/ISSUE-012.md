# ISSUE-012 — S10 Golden Journey Hardening + Legacy Cleanup

**Status:** resolved
**Blocked by:** ISSUE-011（Flash Confirmation + Serial e2e）
**Priority:** P0-hardening
**Resolved:** 2026-08-12 · commit `24aa555` · DETERMINISTIC acceptance

## 15. Delivery Record

- **旧目录删除（引用核查先行）**：`git rm` gateway/（136）+ shared/（30）+ worker/（78）+ catalog/ + docker/ + trial-output/ + docker-compose.yml + trial_run.py + verify-token.js + design-preview.html/design-tokens.json/ui-preview.* + ARCHITECTURE/DESIGN/DEPLOYMENT.md + pytest.ini + cd.yml；`rm -rf services/`（仅剩被忽略的 __pycache__）。删除前 grep 核查：无 import/fs/脚本引用（src/app/tests 全无）。共 282 个文件删除。
- **CI 更新**：`.github/workflows/ci.yml` 重写为模块化单体门禁（typecheck / lint / unit+contract / e2e:golden / build）；删除 V2 docker CD（无容器部署目标）。
- **Mock 生产路径清除**：`app/mock/engine.ts` 精简为仅 UI 常量（TEMPLATES/DEFAULT_PROMPT/sleep）——历史脚本（INITIAL_PROJECTS/DISCOVERY_PROPOSALS/autoAssignPins/buildFirmwareCode/makeFirmwareProposal/BUILD_*/runBuildScript 等）删除；AppContext 不再用 mock 候选/外设占位（真实 /recommend-mcu 在视图挂载时填充）；TopNavBar "mock" 徽章移除；导出 PDF `alert(mock)` → 禁用（M1 范围外，无假成功）；i18n 中 mock 标记文案清理（exportPdf/calibration/deleteConfirm）。
- **文档**：CONTEXT.md 重写为新词汇表（删除 DesignDraft/Pipeline/Stage/Orchestrator；新增 Artifact/ArtifactVersion/Proposal/StaleMark/BuildRecord/ValidationRecord/Capability/DeviceSession/DebugEvidence/Preferences）；README.md 新建（架构/运行/测试/验收标注）；.env.example 更新为本地单进程配置；implementation-spec 头部标注 S10 完成。
- **冒烟**：`npm run build` OK（typecheck + vite）；新端口启动 → /api/v1/health 200、POST /device/detect 返回设备、/projects 200；浏览器刷新干净（无 mock 徽章、无 console 错误、项目/artifacts/偏好持久化）。
- **回归**：304 unit+contract + 18 e2e golden 全绿；ui-acceptance-report §8 27 项基线由 S1-S9 各切片浏览器验收覆盖（S9 走查 detect/flash confirm/progress/serial/GET_STATUS/disconnect）。
- **声明**：本票未首次实现任何业务能力（仅清理 + 文档）。
- **验收标注**：DETERMINISTIC（无真实硬件/arduino-cli；build/flash 经 mock compiler/companion-local 适配器 + 真实 Port 契约与 workspace 证据断言）。

## 1. User-visible outcome

Golden Journey 全链在真实后端走通（无任何 Mock 生产路径）；全部 UI Lab 分支（cancel/retry/offline/provider unavailable/toolchain unavailable/stale/revalidate/archive/outdated proposal/build fail）回归通过；仓库只有一条生产主路径（旧 gateway/services/worker/shared 删除）；打包/启动冒烟通过。

## 2. Frozen upstream references

- UI：ui-acceptance-report.md §8（27 项走查断言 = 回归基线）
- Implementation Spec：§4 Scope、§15 S10、§16 Progressive Swap 完成态、§5.2 旧目录处置
- v2-contract-mapping：DELETE 集合
- ADR：0011（迁移策略）、0012（资产移植）、0013（TS）
- migration-strategy.md：M-9 退役门

## 3. In scope

- 全 Mock 生产路径清查与删除（Progressive Swap 完成态；Mock 仅保留测试 fixture/开发适配器）
- Golden Journey E2E 全分支（tests/e2e/golden-journey/）：build success/fail/diagnosis/fix/rebuild/cancel/retry/stale/revalidate/provider unavailable/toolchain unavailable/outdated proposal/archive
- 回归：ui-acceptance-report §8 的 27 项断言 → 自动化/浏览器核对
- 旧主路径删除：gateway/ services/ worker/ shared/（提取完成部分已确认）、trial_run.py、verify-token.js、旧设计预览产物——**删除前 detect_changes/引用核查，无引用残留**
- 文档更新：CONTEXT.md 新词汇表（删除 DesignDraft/Pipeline/Stage/Orchestrator 词条）、docs/rebuild/ 状态标注、README（新架构/运行方式）
- 打包/启动冒烟：npm run build + 启动 + /health + 浏览器走查
- 门禁脚本收尾（typecheck/lint/test/e2e:golden 在 CI 形态可用）

## 4. Out of scope

- 任何新业务能力（本票不首次实现功能——若发现某能力到 S10 才首次实现，说明前面 Slice 拆错，**标记 needs-human 并回退**）
- Cloud Adapter/RabbitMQ/Auth/Web Search（后续里程碑）
- V2 数据迁移（无用户数据；如未来需要按 migration-strategy M-8 单独立项）

## 5. Mock being replaced

```
全部残留 Mock 生产路径（AppContext 内存态/脚本引擎）
→ 真实 Capability（S1-S9 已完成项的最终核查与删除）
```

## 6. End-to-end flow

```
（回归主线）创建 → 发现 → 澄清 → 提案 → MCU → 引脚冲突 → 校验 → 固件 Diff → 构建成功
→ 失败支线：失败 → 诊断 → 修复 → 重建
→ Stale 支线：换 MCU → 级联 Stale → Revalidate → 恢复
→ 设备支线：检测 → 烧录确认 → 串口
→ 状态支线：cancel/retry/offline/provider/toolchain/archive/outdated proposal
（全程真实后端，无 Mock 路径）
```

## 7. Minimum domain changes

- 无（仅清理与文档）

## 8. Minimum persistence changes

- 无新表/列；仅确认 schema 增长序列与 9 表终态一致

## 9. Ports / Adapters

- 无新增；确认全部 Port 有真实实现或明确为测试 mock（device mock 仅测试）

## 10. Error states

- 回归全部错误/降级路径（§17 错误模型 13 码）

## 11. Tests first

- E2E 全分支（上文清单）；回归断言（27 项基线）
- 引用核查测试：旧目录删除后 import/引用无残留（detect_changes / grep 断言）
- 打包冒烟：build + health

## 12. Browser acceptance

```
（全链走查，无 Lab 的 Mock 数据源）：
创建 → … → 烧录（真实能力路径，mock 仅 provider/device 测试适配器）
→ 刷新各视图状态保持（SQLite/workspace 持久化）
→ 全分支触发（Lab 仍可用作状态触发，但数据路径为真实后端）
```

## 13. Definition of Done

- typecheck/lint/test/e2e:golden 全绿；27 项回归断言通过
- 仓库 grep 确认无 Mock 生产路径/无旧目录引用残留
- npm run build 成功 + 启动冒烟 + /health 200
- 唯一生产主路径（目录核对）
- 本票未首次实现任何业务功能（核对声明）

## 14. Forbidden shortcuts

- 禁止保留 try-real/catch-mock 双路径（彻底删除）
- 禁止本票首次实现业务能力（拆错信号 → needs-human）
- 禁止删除前不核查引用（V2 冻结代码在本票后仍保留为归档引用？——按 migration-strategy：提取完成即删；V2 冻结提交以 git 历史留存，不保留工作树副本）
- 禁止引入新基建（CI 平台/部署平台等超出既有脚本范围）
