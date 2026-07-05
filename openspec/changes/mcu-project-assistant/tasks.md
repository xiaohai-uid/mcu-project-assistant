## Layer 1: 项目整体框架

### 1A: 基础设施

- [x] 1.1 初始化 monorepo 结构（gateway/, services/, docker/）
- [x] 1.2 编写 docker-compose.yml（RabbitMQ + Postgres + 6 个服务）
- [x] 1.3 搭建 Gateway（Next.js API Routes + RabbitMQ 客户端 + Postgres 读写）
- [x] 1.4 设计共享 Postgres Schema（users, api_keys, memberships, usage_quotas, design_drafts, project_snapshots, project_templates）
- [x] 1.5 实现 AiModel 三级路由（Gateway 根据 Membership 选择 free_api / user_key / premium_api）
- [x] 1.6 实现 DailyQuota 计数器（按用户 ID 独立计数、每日重置、超限拦截）
- [x] 1.7 配置内置公益 API 端点（DeepSeek / 通义千问等免费公开 API）
- [x] 1.8 实现前端轮询 hook（useDesignDraft / useProjectStatus）
- [x] 1.9 实现 DesignDraft 状态机（analyzing → recommending → generating → ready / stale）

### 1B: 用户与会员系统

- [ ] 1.10 实现用户注册/登录
- [ ] 1.11 实现会员状态管理（free / hasKey / subscription / pay-as-you-go）
- [ ] 1.12 实现 UsageQuota 计数器（搜索次数/月）
- [ ] 1.13 实现平台权限控制（免费仅 Arduino，会员全平台）
- [ ] 1.14 实现 API Key 加密存储与安全管理（添加/查看/撤销/轮换）
- [ ] 1.15 实现 API Key 注入逻辑（Gateway 将用户 Key 注入请求上下文发给微服务）
- [ ] 1.16 实现按量计费系统（预充值、按搜索扣费、余额查询）

### 1C: 自动快照与版本管理

- [ ] 1.17 实现 DesignDraft 自动快照（每次流水线完成 → 创建 ProjectSnapshot）
- [ ] 1.18 实现手动命名快照功能
- [ ] 1.19 实现快照浏览与回退（回到任历史快照继续编辑）

### 1D: 自动失效与级联重算

- [ ] 1.20 实现 DesignDraft 阶段依赖追踪
- [ ] 1.21 实现修改触发逻辑（修改→标记下游 stale→重新发布消息）

### 1E: 预制模板系统

- [ ] 1.22 设计 ProjectTemplate 数据模型（标题、描述、配件清单、代码、接线图）
- [ ] 1.23 创建首批预制模板（温度计、智能灯、门禁系统、循迹小车等 5-10 个）
- [ ] 1.24 实现模板浏览和展示页面（免费用户的首页）

## Layer 2: 核心业务逻辑 — 微服务

### 2A: RequirementService

- [x] 2.1 脚手架 RequirementService（Python FastAPI + RabbitMQ）
- [x] 2.2 实现 LLM 调用层（支持 AiModel 三级路由：free_api / user_key / premium_api）
- [ ] 2.3 实现原始描述 → 结构化 Requirement 解析
- [ ] 2.4 实现多轮追问逻辑（模糊描述自动追问）
- [ ] 2.5 实现语言检测（中文/英文自适应）
- [ ] 2.6 实现消息处理循环

### 2B: RecommendationService

- [x] 2.7 脚手架 RecommendationService（Python + RabbitMQ + SQLite）
- [ ] 2.8 设计 SQLite Schema 并填充种子数据（板卡/传感器/执行器/显示/通信/电源）
- [ ] 2.9 实现平台兼容性检查器（电压、引脚数、协议）
- [ ] 2.10 实现三档成本分配算法（丐版/标准/旗舰）
- [ ] 2.11 实现 AI 辅助组件匹配（内置库找不到时用 AI + 用户 Key 补充）
- [ ] 2.12 实现冲突检测与替换逻辑
- [ ] 2.13 实现 Membership 感知三路径：
  - 免费+无 Key：不进入此服务
  - 免费+自带 AI Key：仅内置库参考价
  - 会员/自带搜索 Key：内置库 + 调用 WebSearchService 比价
- [ ] 2.14 实现消息处理循环

### 2C: WebSearchService

- [x] 2.15 脚手架 WebSearchService（Python + RabbitMQ + 爬虫引擎）
- [ ] 2.16 实现通用搜索引擎搜索（调用搜索 API 或爬虫）
- [ ] 2.17 实现淘宝/1688 价格爬虫
- [ ] 2.18 实现专业元器件商城搜索（DigiKey/Mouser/LCSC）
- [ ] 2.19 实现结果合并去重与排序（按价格升序 + 来源标注 + 链接）
- [ ] 2.20 实现反封锁策略（User-Agent 轮换、请求限速、代理轮换）
- [ ] 2.21 实现用户自备搜索 Key 注入模式
- [ ] 2.22 实现消息处理循环

### 2D: CodegenService

- [x] 2.23 脚手架 CodegenService（Python + RabbitMQ + Jinja2）
- [ ] 2.24 创建 Arduino 模板系列
- [ ] 2.25 创建 ESP32 模板系列（WiFi + MQTT + WebServer）
- [ ] 2.26 创建 STM32 模板系列（Arduino Core + HAL）
- [ ] 2.27 实现引脚定义生成器
- [ ] 2.28 实现 AI 业务逻辑填充（支持用户注入 Key 或系统 Key）
- [ ] 2.29 实现错误处理注入
- [ ] 2.30 实现 Professional 模式：用户在线编辑代码
- [ ] 2.31 实现消息处理循环

### 2E: SchematicService

- [x] 2.32 脚手架 SchematicService（Python + RabbitMQ + SVG）
- [ ] 2.33 实现自动引脚分配算法
- [ ] 2.34 生成引脚映射表
- [ ] 2.35 实现 SVG 接线图生成器
- [ ] 2.36 实现供电网络可视化
- [ ] 2.37 实现 Professional 模式：用户自定义引脚后 SVG 实时更新
- [ ] 2.38 实现消息处理循环

## Layer 3: 前端 UI

- [ ] 3.1 首页（无 Key 用户：模板浏览 + 引导绑定 Key/开通会员）
- [ ] 3.2 项目想法输入页（Wizard 引导式对话框）
- [ ] 3.3 Professional 模式入口（跳过 Wizard 直接进入自定义面板）
- [ ] 3.4 需求确认与细化 UI
- [ ] 3.5 配件推荐展示页（免费版静态价格 vs 会员版实时比价+来源链接）
- [ ] 3.6 Professional 配件编辑器（增删改配件、手动替换）
- [ ] 3.7 代码预览页（免费只读 / 专业可编辑，语法高亮）
- [ ] 3.8 Professional 引脚编辑器（拖拽式引脚映射）
- [ ] 3.9 接线图查看器（SVG 渲染 + 缩放）
- [ ] 3.10 项目导出页 + 版本快照列表
- [ ] 3.11 会员中心（开通/管理订阅 + 查看用量/余额）
- [ ] 3.12 API Key 管理页面（绑定 AI Key + 搜索 Key）
- [ ] 3.13 Beginner/Professional 模式切换

## Layer 4: 集成与交付

- [ ] 4.1 前端 ↔ Gateway 全链路联调
- [ ] 4.2 三层权限测试（无 Key / 有 Key / 会员各自看到正确的功能边界）
- [ ] 4.3 WebSearchService 爬虫容错处理（淘宝反爬、API 超时、降级到内置库价格）
- [ ] 4.4 API Key 加解密与安全测试
- [ ] 4.5 UsageQuota 计数与超限拦截测试
- [ ] 4.6 异步流程端到端测试（想法→导出完整路径）
- [ ] 4.7 部署文档、架构图、API 文档
