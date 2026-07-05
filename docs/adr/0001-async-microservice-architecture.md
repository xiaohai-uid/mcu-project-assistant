# ADR 0001: 异步消息驱动的微服务架构

采用 RabbitMQ 消息队列驱动的流水线式微服务架构，替代初始设计中的单体 FastAPI 后端。

## 决策

系统由以下服务组成：Gateway（编排层 + API 网关）、RequirementService（需求分析）、RecommendationService（配件推荐）、CodegenService（代码生成）、SchematicService（示意图生成）。

Gateway 接收前端 HTTP 请求，将任务发布到 RabbitMQ 输入队列。对应服务消费并处理后，将结果发布到 RabbitMQ 结果队列。Gateway 消费结果队列，写入共享 Postgres 数据库。前端通过轮询 GET 接口获取处理状态和结果。

修改 DesignDraft 中任一阶段的内容时，后续阶段结果**自动废弃**并在后台自动重新生成。

## 背景

初始设计为 Next.js + Python FastAPI 单体后端。用户提出微服务拆分需求，确认采用流水线架构、服务间用 RabbitMQ 异步通信、仅对内暴露 API。

## 考虑的方案

- **方案 A**: 单体后端，同步 HTTP 调用 → 被否决，不解耦
- **方案 B**: 微服务 + 同步 HTTP（一个挂全链挂）
- **方案 C (选中)**: 微服务 + RabbitMQ + Gateway 编排 + 轮询结果

## 后果

- 正向：服务间完全解耦，任一服务可独立部署/升级/伸缩；LLM 调用耗时不影响其他服务
- 正向：用户可回头修改需求而无需关心下游如何重算
- 代价：引入 RabbitMQ 和消息序列化增加了架构复杂度；前端需要轮询机制；需要额外开发 Gateway 的编排和结果聚合逻辑
