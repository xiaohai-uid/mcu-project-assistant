# ISSUE-005: 补齐 [E1]/[E2]/[E3] 成功证据并入库

Status: partially-resolved（[E1]/[E2] done 2026-08-23；[E3] pending-human）
Type: task
Priority: P2（ISSUE-001 已标 resolved 但 DoD 的"各留证据"未满足）
Blocked by: 无

## 问题（code-review Spec 轴 #a1）

PRD 成功证据三项在仓库内均无留证：[E1] 门禁运行输出、[E2] 本地真实链路往返、[E3] 托管 smoke。ISSUE 评论称证据在 vault——从仓库不可核验，违背证据链可复现原则。

## 切片

- [x] **[E1]**（agent 可做）：跑全量 test/typecheck/lint/build，输出摘要落 `docs/audit/diagnostics-gate-evidence-<date>.md`。
- [x] **[E2]**（agent 可做）：起真实 server 进程 → 注入一个会失败的请求 + 一次客户端错误上报 → curl 诊断端点查到两行 → 全程命令与输出入同一证据文档。
- [ ] **[E3]**（需人/凭据）：托管环境部署 smoke。若托管平台操作只有用户能做（控制台/密钥），走 `/wizard` 生成交互脚本；agent 能自动化的部分（revision 记录、公网 URL 往返验证）先行备好。

## DoD

- [ ] 三项证据各有一节，含日期、命令、输出摘要；文档提交入库并在 ISSUE-001 追加评论回链。

## Comments

- 2026-08-22 zcode: 来源 = /code-review dadc46a...HEAD Spec 轴发现 (a)1。ready-for-human 仅因 [E3] 可能需要用户侧操作；[E1]/[E2] 部分随时可由 agent 先行。
- 2026-08-23 agent: 证据文档 = `docs/audit/diagnostics-gate-evidence-2026-08-23.md`。[E3] 两次公网 URL 探活 404（真实地址/部署需用户）；执行清单已备好。
