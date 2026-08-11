# 0007 — Task Execution Abstraction: Task Execution Port

## Status

accepted

## Context

Application Contract 不能知道 Queue（指令 §十二）。本地模式不得依赖任何队列服务（P-12）。旧 RabbitMQ 是管道时代的传输假设，已被契约删除（v2-contract-mapping）。

## Considered Options

- **Task Execution Port（chosen）**: 应用层定义 `submit_task / cancel_task / task events`；Local Adapter = in-process runner + SQLite 任务表（崩溃恢复）；Cloud Adapter = 队列后端（RabbitMQ / Redis jobs / Postgres job table / managed queue 任选其一）。
- 直接使用 RabbitMQ 作为核心: 违背 P-12（本地不可用）、把部署选择当架构。
- 每能力自建线程/进程: 无统一取消/持久化/事件语义。

## Consequences

- RabbitMQ 被降级为 Cloud Deployment Adapter 的可选实现，**不是核心架构**。
- 任务可取消、可持久化（SQLite 表）、可发布进度事件（build.output / analysis.progress）。
- 能力实现与执行机制解耦：本地与云端同一代码路径。
