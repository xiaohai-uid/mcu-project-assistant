# MCU Project Assistant

一个 AI 驱动的单片机项目辅助工具。用户描述项目想法，系统自动推荐配件、生成代码和接线图。免费用户可使用内置公益 AI 模型（每日限额），也可自带 Key 解锁更高配额。

## Language

**DesignDraft**:
用户正在迭代的设计方案。处于需求分析→配件推荐→代码生成→示意图生成的流水线中，可随时回退重新生成。每次流水线跑完自动保存为 ProjectSnapshot。
_Avoid_: Project, Session

**ProjectSnapshot**:
DesignDraft 某一时刻的完整状态快照。每次流水线完成时自动创建，用户也可手动创建命名快照（如"v1"、"最终版"）。
_Avoid_: Version, Export, Save

**ProjectTemplate**:
系统内置的预制项目范例。供未登录或免费用户浏览参考。
_Avoid_: Example, Demo, Sample

**Requirement**:
从用户自然语言描述中解析出的结构化功能需求。包含功能列表、I/O 需求、通信需求、供电要求。
_Avoid_: Spec, UserStory, Task

**ComponentList**:
推荐的配件清单，包含三种成本档位（丐版/标准/旗舰）的完整 BOM。免费版显示内置库参考价，会员版显示 WebSearchService 实时比价。
_Avoid_: BOM, Parts list

**GeneratedCode**:
根据选定的 ComponentList 和平台，自动生成的可编译单片机代码。专业模式下用户可在浏览器中编辑。
_Avoid_: Firmware, Sketch, Binary

**WiringDiagram**:
展示单片机与各配件引脚连接的 SVG 示意图及引脚映射表。
_Avoid_: Schematic, Circuit diagram

**ExperienceLevel**:
用户的使用模式。`beginner` 为向导模式；`professional` 为自定义模式，可手动选配件、自定义引脚、编辑代码。
_Avoid_: UserType, Role, Mode

**AiModel**:
AI 模型的来源路由。三个等级：`free_api`（系统内置公益 API，免费用户默认）、`user_key`（用户自备 Key，更高品质）、`premium_api`（系统付费 API，会员使用）。由 Gateway 根据 Membership 和用户配置自动选择。
_Avoid_: LLM, Model provider, Backend

**Membership**:
用户付费状态。`free`（使用内置公益 AI，每日限额，仅 Arduino）、`hasKey`（自带 Key，不限模型次数）、`subscription`（订阅会员）、`pay-as-you-go`（按量付费）。
_Avoid_: Plan, License

**DailyQuota**:
免费用户每日可使用的 AI 模型调用次数。适用于公益模型（free_api）。按用户 ID 独立计数，每日重置。
_Avoid_: Daily limit, Rate cap

**ApiKey**:
用户自备的第三方服务密钥。可以是 AI Key（如 OpenAI、DeepSeek）或搜索 Key（如 SerpAPI）。绑定后可解锁对应功能的不限次使用。
_Avoid_: Token, Credential, Secret

**Gateway**:
统一的 API 网关和编排层。负责 Membership 鉴权、AiModel 路由、ApiKey 注入、DailyQuota 计数、UsageQuota 计数、DesignDraft 自动失效级联。
_Avoid_: Backend, API server, Orchestrator

**RequirementService**:
接收原始描述文本，调用 LLM（按 AiModel 等级选择模型端点），输出结构化 Requirement。
_Avoid_: NLP service, Analyzer

**RecommendationService**:
接收 Requirement，从内置 SQLite 组件库匹配配件并按档位分级。免费版仅参考价；会员版同步调用 WebSearchService 获取实时比价。
_Avoid_: Matcher, Suggestor

**WebSearchService**:
联网搜索比价服务。三数据源（淘宝/1688、搜索引擎、专业元器件商城）。会员/按量用户使用系统爬虫；自带搜索 Key 的用户可绕过会员限制。
_Avoid_: Crawler, Price fetcher, Scraper

**CodegenService**:
接收 ComponentList 和目标平台，基于 Jinja2 模板 + LLM（按 AiModel 路由），输出 GeneratedCode。
_Avoid_: Code generator, Compiler

**SchematicService**:
接收 ComponentList 和引脚分配方案，生成 WiringDiagram（SVG + 引脚表）。
_Avoid_: Drawing service, Wiring tool

**Tier**:
成本档位。丐版 (Budget) / 标准 (Standard) / 旗舰 (Premium)。
_Avoid_: Level, Version, Grade
