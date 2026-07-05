## Context

用户需要一个 Web 服务，输入单片机项目想法后自动完成配件推荐和代码生成。经过多轮领域建模，项目形态已完整清晰。

## Goals / Non-Goals

**Goals:**
- Beginner 向导模式 + Professional 自定义模式双体验
- 支持 Arduino（免费）、ESP32、STM32（会员）三大平台
- 内置常用配件数据库 + AI 辅助匹配 + 会员专享联网比价
- 三档成本方案（丐版/标准/旗舰）
- 可编译工程代码 + SVG 接线图
- DesignDraft 自动快照 + 手动命名版本
- 三层商业模式：免费+自带 Key / 订阅会员 / 按量付费

**Non-Goals:**
- 不涉及实时硬件仿真或在线调试
- 不支持 PCB 布局设计
- 不自行接入支付网关（前期手动处理）

## 商业模式

| 维度 | 免费（内置公益 AI） | 免费（自带 AI Key） | 订阅/按量会员 |
|------|-------------------|-------------------|-------------|
| AI 模型 | ✅ 公益 API 每日限额 | ✅ 用自己的不限次 | ✅ 系统付费 API |
| 配件匹配 | ✅ 内置库 | ✅ 内置库 | ✅ 内置库+联网比价 |
| 联网比价 | ❌ | ❌ | ✅ 系统爬虫 |
| 自带搜索 Key | — | ✅ 可绑定绕过比价限制 | — |
| 平台 | Arduino 限免 | Arduino | 全平台 |
| 项目配额 | 有限/日（随 AI 配额） | 不限（Key 自己的） | 无限制 |

## Decisions

### Decision 1: 异步消息驱动的微服务架构
6 个 Python 微服务 + 1 个 Node.js Gateway。RabbitMQ 异步通信。
- **Gateway**: 编排 + 鉴权 + ApiKey 注入 + UsageQuota 计数 + DesignDraft 状态管理
- **RequirementService**: LLM 需求分析（接受系统 Key 或用户注入 Key）
- **RecommendationService**: 配件推荐（免费→内置库 / 会员→+WebSearch 比价）
- **WebSearchService**: 联网比价（会员爬虫 / BYO Key）
- **CodegenService**: 模板 + LLM 代码生成
- **SchematicService**: SVG 接线图

### Decision 2: Gateway 编排 + Postgres 共享存储 + 前端轮询
Gateway 统一处理：Membership 鉴权 → ApiKey 注入请求 → 发布消息到队列 → 消费结果写库 → 前端轮询 GET。

### Decision 3: RabbitMQ 异步流水线
每个服务输入/结果双队列。消息体含 DesignDraft ID + Membership 上下文 + 注入的 ApiKey。

### Decision 4: 自动快照与命名版本
每次流水线完成自动生成 ProjectSnapshot。用户可随时回到任一快照继续编辑，也可给快照命名（如"送审版"）。

### Decision 5: 免费用户三层限制
1. 搜索配额：每月固定次数（调用 WebSearchService 时扣除）
2. 项目配额：每月固定生成次数
3. 平台限制：仅 Arduino（ESP32/STM32 需会员）

### Decision 6: AI 模型三级路由 (AiModel)
Gateway 根据 Membership 和用户配置自动选择模型端点：

| AiModel 等级 | 谁在用 | 端点 | 配额 |
|-------------|--------|------|------|
| `free_api` | 免费用户（默认） | DeepSeek / 通义千问等免费公开 API | 每日 N 次 |
| `user_key` | 绑定了自己 AI Key 的用户 | 用户指定的 API 端点 | 不限（用户付费） |
| `premium_api` | 订阅会员 | GPT-4 / Claude 等高质量 API | 不限 |

Gateway 将 AiModel 等级和端点信息随消息一起发布到 RabbitMQ，RequirementService 和 CodegenService 据此选择调用哪个模型。

DailyQuota 计数器在 Gateway 层实现：每次免费用户发起 AI 调用前检查并扣减，超限返回配额耗尽提示。

### Decision 7: API Key 双通道注入
用户可在设置页绑定 AI Key（如 OpenAI、DeepSeek）和/或搜索 Key（如 SerpAPI）。
- 绑定 AI Key 后 AiModel 升为 `user_key`，不限调用次数
- 绑定搜索 Key 后可使用 WebSearchService 绕过会员限制
- Key 加密存储，仅在运行时解密注入请求上下文

### Decision 8: 推荐引擎三路径
RecommendationService 根据 Membership 走不同路径：
- **免费（公益 AI）**: 查询内置 SQLite 库，返回参考价
- **免费+自带 AI Key**: 同上，但 AiModel 为 `user_key`
- **会员 / 自带搜索 Key**: 内置库匹配后同步调用 WebSearchService 比价，替换价格

### Decision 9: WebSearchService 三层数据源
淘宝/1688 爬虫 + 通用搜索引擎 + DigiKey/Mouser/LCSC 专业商城。结果合并去重排序。

### Decision 10: 代码模板引擎
Jinja2 模板 + LLM 填充。Professional 模式下用户可在浏览器编辑代码后导出。

## Risks / Trade-offs

- [淘宝反爬升级] → 多爬虫策略轮换 + 用户自备 Key 作为备选路径
- [LLM 调用成本风险] → 系统零 AI 成本：免费用户自带 Key，会员费覆盖系统 Key 开销
- [免费用户可能滥用配额] → 按 Session + IP 限频
- [Key 安全风险] → 加密存储 + 仅运行时解密 + 支持随时撤销
