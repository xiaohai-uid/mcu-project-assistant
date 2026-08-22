# mcu-project-assistant 应用架构评审与改造方案

日期：2026-08-22
范围：应用架构（功能模块划分、领域概念模型、用户旅程组织）——不涉及执行/部署拓扑
性质：评审结论 + 改造方案，可作为后续项目应用架构设计的模板样例

---

## 一、现状应用架构（As-Built 地图)

### 领域脊柱（概念模型）

```
Project（项目）
 ├── Artifact（不可变版本链）
 │     kinds: requirements → hardware → pinmap → wiring → firmware → build…
 │     状态: draft / proposed / accepted / stale / validated
 ├── Proposal ★唯一变更通道★ —— AI 永不直接写入，用户逐条 Accept/Reject
 ├── BuildRecord —— 编译证据，独立于版本（D2: build 不产生版本）
 ├── ValidationRecord / DebugEvidence —— 证据族
 └── BOM（+ price observations 带日期采购观察）

Knowledge Registry（硬件事实库）
     对象五级: chip | module | board | component | tool
     事实值类: stated | recommended | typical | maximum | unknown
     置信度:   official-direct | measured | user-supplied | inferred | unsupported
     每条事实带 PlatformSource（url/revision）
```

### 旅程 × 视图 × 能力 对齐矩阵（这是本项目最大的架构优点）

| 用户旅程 | UI 视图 | 应用能力 | 领域服务 |
|---|---|---|---|
| A 想法→需求 | RequirementsView | analysis, proposals, commands(+clarification) | dependency-evaluation |
| B MCU/硬件选型 | HardwareSelectionView | mcu | platforms 知识 |
| C 引脚/接线 | WiringGuidanceView | wiring | constraint-engine |
| D 固件生成 | FirmwareView | firmware | firmware-generator |
| E 编译/验证 | BuildView | build, diagnosis | build-profile, build-readiness |
| F 实物循环 | CompanionView | flash, physical-acceptance | physical-acceptance |
| G Stale 传播 | 全局 StaleBanner + 提案卡 | revalidate | dependency-evaluation |
| H 就绪度/交付 | ReadinessView(Delivery) | readiness | delivery-report, commercial-readiness |
| I 物料与成本 | BomView | bom | bom |

横切面：ProjectCopilotPanel（常驻 AI 对话）、TopNavBar/SideNavBar、AuthGate。
API 面 44 条路由，与上述能力一一对应。

## 二、评审结论

### 做对的（不要动）

1. **三层对齐纪律**：每条用户旅程恰好对应一个视图、一组能力、一类 artifact。
   导航即流水线，用户永远知道自己在哪一步。
2. **Artifact 不可变版本链 + Proposal 单一变更通道**：这是 AI 应用的黄金骨架，
   审计、回滚、信任问题都在模型层被消灭，而不是靠提示词约束。
3. **Stale 传播是一等旅程**（G）：承认真实工作是非线性的，靠"标脏→影响审查→逐级
   重验"处理回流，而不是假装瀑布。
4. **知识层分类法已达商用规格标准**：五级对象 × 四类值 × 六档置信度 + 来源引用，
   这套本体比多数商业硬件工具严谨。

### 要改的（应用架构层面的四个改造点）

#### R1 知识库从"代码常量"升为一等数据模块 ★最重要★
- 现状：1062 行 TS 静态常量，源码自注"M1 数据为代码常量；未来可配置化再升表/文件"。
- 后果：加一颗传感器=改码+发版；社区无法贡献；来源字段覆盖率无法扩展；
  商用规格的 User Story 4/6/20（查来源、看未知标记、价格观察上下文）兑现受限。
- 改造：
  - knowledge registry 迁出代码 → 版本化数据文件（JSON Schema 校验）+ 加载器适配器
    （新增 KnowledgePort：内置包 / 用户目录 / 远端订阅三种实现）
  - 新增「知识目录」视图：浏览对象层级、每条事实的来源/置信度/查询日期、"unknown 保持未知"
  - BOM 价格观察与知识条目共用同一 provenance 结构
- 验收：新增一颗 DFRobot 器件全程不改业务代码；UI 可见其数据手册来源与访问日期。

#### R2 三态就绪词汇贯穿全应用
- 现状：local-ready / simulation-ready / physical-accepted 只在 Delivery 视图聚合展示。
- 改造：三态成为全局状态语言——每个 artifact 卡片、BOM 行、报告章节挂三态徽章；
  CompanionView 的每次检测/烧录动作直接改变对应 artifact 的物理态。
- 附带：domain/services/commercial-readiness.ts 更名 acceptance-policy.ts
  （商业模式概念不应存在于领域层，见模板第 4 条）。

#### R3 Home 与 Workspace 双结构整合
- 现状：`nav === "Home" ? <HomeDashboard/> : <Workspace/>` 是两个平行世界，
  Home 是单项目时代残留，多项目阶段应成为"项目列表 + 旅程入口"。
- 改造：Home 重定义为项目仪表盘（项目卡 + 各项目就绪态摘要 + 新建向导），
  Workspace 内不再有第二导航体系。

#### R4 Copilot 的权限边界表显式化
- 现状：Copilot 面板能触达哪些能力，散落在各 handler 里，无一张显式清单。
- 改造：建立 AI 权限三级表并让路由中间件强制执行——
  - 自动（只读）：检索知识、读工件、诊断分析
  - 必须提案（写路径）：任何产生 ArtifactVersion 的变更
  - 禁止：直接烧录（必须走 flash-token）、修改 Accepted 版本、绕过确认删数据
  这张表同时是给用户的信任界面（设置页可视化）和给测试的断言清单。

### 明确不做
- 不改执行架构（单体+端口已是共识最优）
- 不拆微服务、不加消息队列
- 不动 auth 的现有实现（内测期够用），仅把它标注为部署形态适配器，禁止进入领域能力清单

## 三、迁移顺序（依赖驱动）

1. R2 徽章系统（纯 UI + readiness 已有能力，1 天，立即提升可信度感知）
2. R3 Home 整合（半天，独立）
3. R4 权限表（1 天，含中间件与设置页）
4. R1 知识库升级（2-3 天，含 schema 设计、数据搬迁、新视图）——收益最大放最后，
   因为前 three 步会给它提供展示面

## 四、附：本评审使用的应用架构设计框架（可复用到任何项目）

1. **领域脊柱**：画出核心实体 + 不变量。回答"谁是唯一真相源？""变更的唯一通道是什么？"
2. **旅程×视图×能力对齐矩阵**：一行一个用户目标，三列必须能互相对上；
   对不上的行要么是孤儿功能要么是缺漏。
3. **AI 权限三级表**：AI 应用必备——自动只读 / 必须提案 / 绝对禁止。
4. **数据 vs 代码分界线**：会频繁增长的内容（知识、模板、配置）必须是数据文件；
   只有行为逻辑才配住在代码里。
5. **全局状态词汇表**：全应用统一的状态语言（如三态就绪），不允许每个视图自造词。
