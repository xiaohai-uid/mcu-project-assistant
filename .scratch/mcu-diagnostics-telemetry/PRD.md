# PRD: Diagnostics & Flywheel Foundation

Status: ready-for-agent
Gate: S1（功能本身）→ 随发布走 S3（S2 连续 3 次黄金路径 + 候选 smoke + 生产 smoke + 回滚就绪）
OVERRIDE: 2026-08-21 用户当次明确指令"加日志功能后发布到客群；要有数据飞轮"——卫星轨道临时解冻本单项，记入当日日志。
REVISION: 2026-08-22 code-review 发现 `proposal.decided` 为新增领域事件、与"零新领域采集"冲突；经用户裁决**保留**——该事件正是 MUST 采集项"提案接受/拒绝"的落点，直接服务数据飞轮目标。范围条款修订为：零新增采集，`proposal.decided` 除外。

## 用户结果

运营者（用户本人）把应用发布给客群内测后：

1. 任何用户设备上发生的错误，运营者无需用户描述代码级细节，即可通过诊断端点看到：错误码、堆栈、发生路径、请求关联 ID、时间线。
2. 产品使用数据自动沉淀：需求分析、提案接受/拒绝、构建成败、重验证结果、烧录结果——为"哪种搭配更好"提供数据底座（数据飞轮第一阶段=采集+聚合查询，反哺推荐属后续迭代）。

## 范围内

- 服务端结构化日志（stdout JSON lines，平台 log drain 可收）+ SQLite `event_log` 持久化（warn/error + 全部 LogicalEvent + 客户端错误）
- 请求关联 ID（x-request-id）贯穿请求日志与错误记录
- 前端全局错误捕获（ErrorBoundary + window.onerror + unhandledrejection）上报端点
- 运营者只读诊断端点：事件查询 + 聚合摘要（仅认 Basic Auth 头，网页会话 Cookie 不放行）
- LogicalEvent 持久化适配器（复用既有 EventPort，零新领域采集）

## 范围外

- 每用户身份体系（当前共享凭据单租户，保持不变）
- 日志 UI 页面（v1 用 curl 即可；后续按需）
- 飞轮推荐引擎/自动调参
- 第三方 telemetry SDK（不引入依赖）

## MUST

- 绝不记录密钥/API key/密码/Authorization 头；客户端上报 payload 有大小上限与服务端速率限制
- event_log 行数有上限裁剪（防免费盘撑爆）
- 诊断读取端点在 publicMode 下对仅持会话 Cookie 的普通用户返回 403
- 全量门禁绿：test/typecheck/lint/build

## MUST NOT

- 不改变现有任何 API 的行为契约
- 不把 physical/paid 门禁语义与本次发布混淆（本次是免费内测扩面，不是 paid-release）

## 成功证据

- [E1] 全量测试/typecheck/lint/build 通过
- [E2] 本地真实链路：真实 server 进程产生错误 → event_log 可查 → 客户端错误上报往返
- [E3] 托管环境部署 smoke：revision + 环境记录，公网 URL 上完成同一往返
