# Migration Strategy — V1/V2 → New Product

> 日期：2026-08-11
> 状态：Draft（Architecture Review 通过后执行依据；ADR-0011 为决策）
> 原则：**Extract proven capability, not old architecture.**
> 基线：V1 = GitHub main `38f8c93`；V2 = 本地 `730a52d`（7 提交未推送，冻结，不删除不开发）；新 = Contract Frozen + Target Architecture。

---

## 1. 资产裁定汇总（详细清单见 v2-contract-mapping.md）

### What Survives（REUSE）
- `shared/llm_client.py`（OpenAI 兼容结构化输出 + 重试 + MOCK 模式）→ AI Provider Port 的参考实现
- `shared/domain/compatibility.py` / `pins.py` / `layout.py` / `classification.py` → evaluate_constraints / generate_pin_map 的纯逻辑
- `worker/domain/platforms/registry.py`（引脚集 + **strapping 知识**）→ MCU 平台数据
- `worker/domain/components/registry.py` → 组件/外设目录
- `worker/observability/logging.py`、`compile_result.py` 结构 → BuildRecord 字段
- 网关中间件栈（JWT/限流/安全头/CORS）→ Cloud 模式认证边界
- BYOK 加密（AES-256-GCM + key_hash）→ Provider 密钥管理
- websearch 货币安全聚合 + 兜底 → WebSearch Port
- 测试：constraints（150 行）、platform、circuit、catalog、registry、compatibility、classification、pins、layout、websearch 聚合 → 随资产迁移

### What Is Extracted（EXTRACT）
- `worker/domain/constraints/engine.py` → 约束求值（输出 issues[]，severity 对齐 L1/L2/L3）
- `circuit_ir.py` / `pin_allocation.py` / `component_selection.py` → Pin Map / Wiring / Hardware 版本内容结构
- `cascade.ts` 的失效传播理念 → DependencyEdge 求值服务
- `pipeline.ts` definePipeline 的拓扑校验 → 依赖声明校验（可选）
- acceptance fixtures（10 case）→ Capability 测试夹具（Golden Journey）
- V2 模型/结构测试 → 按新 schema 拆分

### What Is Rewritten（REWRITE）
- firmware 生成（输出 = Proposal + diff + impacts，非直接版本）
- requirement 分析（能力 + 提案 + 多轮澄清 + 流式/取消）
- consumer/main（→ Task Execution Port 的执行器，传输无关）
- arduino_cli adapter（→ Device Port 编译适配器；覆盖 ESP32 Golden Path；原实现被判定不可用）
- 5 个旧 FastAPI 服务 → Capability 处理器（复用其提示词/模板数据）

### What Is Deleted（DELETE）
- DesignSpec（域根）、Stage、StageHandler、Pipeline、Orchestrator、run-consumer
- FakeRepository 默认（根因缺陷）、feature flags（无调用证据）
- V2 占位 API、旧 schema.sql / migrations 001-002（漂移不可用）
- shared/rabbitmq（契约层）、trial_run.py、旧设计预览产物

## 2. 迁移顺序（Architecture Review 通过后）

| 阶段 | 内容 | 退出条件（Gate） |
|---|---|---|
| M-1 | 新核心骨架：Domain（8 对象 + 12 不变量）+ Application（21 Capability 接口）+ Persistence Port（SQLite 适配器） | 领域不变量测试绿（无 I/O） |
| M-2 | 移植纯逻辑资产：约束引擎 / 兼容性 / 引脚 / 分类 / 平台+strapping 数据 / 组件目录 | 资产测试从 V2 原样通过 |
| M-3 | AI Provider Port + Mock 适配器 + 流式/取消/结构化输出 | mock 全链路能力测试绿 |
| M-4 | UI：冻结 Mock（C:\zcode\mcu）切换数据源为真实 Capability（SSE 事件替换脚本流） | Golden Journey 浏览器走查（对真实后端） |
| M-5 | Task Execution Port：Local in-process runner + SQLite 任务表；构建适配器（ESP32 Arduino/PlatformIO） | BuildRecord 全链路 + 失败/诊断/修复闭环 |
| M-6 | Companion Device Port：检测/烧录/串口（Mock 适配器先行） | 烧录确认 + 证据流走通 |
| M-7 | Cloud 适配器：relational + blob、队列后端、Hosted AI、云同步 | 双模式一致性测试（同一能力测试两模式跑通） |
| M-8 | 旧数据迁移（design_drafts → Project/版本）——**仅当存在需要保留的用户数据** | 迁移测试 + 抽样核对 |
| M-9 | 旧工程退役：V2 冻结提交归档说明；删除项从仓库移除 | 无引用残留 |

## 3. 禁止事项

- 不把 V2 的 worker 拓扑/队列假设搬进新系统
- 不先迁移数据再建系统（数据迁移最后，M-8）
- 不在 UI 与契约之间加"兼容层"（AGENTS.md：不保留向后兼容）
- 不并行维护两套产品逻辑（单轨切换）

## 4. 成功标准

新系统 Golden Journey 在**真实后端**（非脚本 mock）下浏览器走查通过：创建→发现→澄清→提案→MCU→引脚冲突→固件 Diff→构建→失败→诊断→修复→重建→Stale→Revalidate——且 Local 模式无 Postgres/RabbitMQ 依赖。
