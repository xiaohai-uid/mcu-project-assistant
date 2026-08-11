# V2 Compatibility Mapping — 新契约 ↔ V2 实现

> 日期：2026-08-11
> 状态：Draft（Contract Frozen 后执行依据）
> 前置：新契约已定义（interaction / application / domain / stale / events）。
> V2 = `C:\codex\mcu-project-assistant` main `730a52d`（领先 origin/main 7 提交，**仍冻结，未删除未开发**）。
> 裁定符号：**REUSE**（可直接用）/ **EXTRACT**（提取算法或数据，重构后用）/ **REWRITE**（方向对，需按新契约重写）/ **DELETE**（不保留）。
> 补充（ADR-0013）：EXTRACT/REUSE 的 Python 纯逻辑模块统一 **TS 移植**，测试 1:1 搬运为验收门；单模块移植等价性失败才按需建 Engineering Port。
> 纪律：**禁止因为 V2 已写 9107 行就强行保留**；也禁止因为产品重做就把可靠逻辑无意义推倒（keep-adapt-delete-new-audit.md）。

---

## 1. Worker 域模型

| V2 模块 | 裁定 | 新契约对应 | 理由 |
|---|---|---|---|
| `worker/src/mcu_worker/domain/models/design_spec.py` | **DELETE**（作为域根） | 被 Project + ArtifactVersion 取代 | DesignSpec 是"一次生成规范"；新域根是长期 Project + 不可变版本；不保留概念包装 |
| `domain/models/circuit_ir.py` | **EXTRACT** | Pin Map / Wiring 版本内容 | 电路 IR 是引脚/接线数据的合理结构；提取为版本内容 schema（无独立生命周期） |
| `domain/models/pin_allocation.py` | **EXTRACT** | generate_pin_map 输出 | 分配结果结构可复用 |
| `domain/models/component_selection.py` | **EXTRACT** | Hardware 版本内容（MCU + 外设） | 选择结果结构可复用 |
| `domain/models/stage.py` | **DELETE** | 无对应 | Stage 是旧管道概念；新契约没有 stage 生命周期（capability 是语义层） |
| `domain/models/compile_result.py` | **REUSE** | BuildRecord 的 result/diagnostics 字段 | 编译结果结构直接映射 BuildRecord |
| `domain/constraints/engine.py` | **EXTRACT** | evaluate_constraints / generate_pin_map 的约束求值 | **已验证的算法资产**（test_engine 150 行测试）；提取为纯函数约束引擎，输出 issues[]（severity 对齐 L1/L2/L3） |
| `domain/firmware/generator.py` | **REWRITE** | generate_firmware_proposal | 方向对（模板+业务逻辑），但输出必须改为"Proposal + diff + impacts"，且不得直接写版本 |
| `domain/circuit/generator.py` | **EXTRACT** | Wiring 图生成 | 布局算法可复用（test_circuit） |
| `domain/components/registry.py` | **REUSE** | 组件目录（外设/约束数据源） | 数据注册表 |
| `domain/platforms/registry.py` | **REUSE** | MCU 平台数据（引脚集/strapping 规则） | **strapping 知识**正是 Golden Journey 冲突的来源；复用并扩充 |
| `domain/components/models.py` | **EXTRACT** | 版本内容 schema | 组件模型并入 hardware/requirement 内容 |

## 2. Worker 流程层

| V2 模块 | 裁定 | 新契约对应 | 理由 |
|---|---|---|---|
| `stages/requirement.py` | **REWRITE** | analyze_requirement | 输出形态改为"能力 + 提案 + 澄清"，且流式/可取消 |
| `stages/constraint_validation.py` | **EXTRACT** | validate_wiring / evaluate_constraints | 校验逻辑提取为 ValidationRecord 生产者（引用版本、禁误报成功） |
| `stages/firmware_generation.py` | **REWRITE** | generate_firmware_proposal | 改为提案产出 |
| `jobs/consumer.py` | **REWRITE** | 异步 Capability 的执行器（传输无关） | 消费循环方向对，但必须传输无关（本地/云一致），且处理对象是 capability 任务而非 queue 阶段 |
| `main.py` | **REWRITE** | capability 执行器入口 | 同上 |
| `observability/logging.py` | **REUSE** | 日志基建 | 可靠 |

## 3. Worker 适配器

| V2 模块 | 裁定 | 新契约对应 | 理由 |
|---|---|---|---|
| `adapters/compiler/arduino_cli.py` | **REWRITE** | run_build 的 toolchain adapter（BuildRecord 环境） | 被自家验收判定不可用（vault 2026-08-01）；方向对（真实编译），但需按 BuildRecord 契约重写并覆盖 ESP32（Golden Path） |
| 内置 `arduino-cli.tar.gz` | **REWRITE** | 工具链管理（检测/安装） | 不可用状态重做；工具链检测是 L2/L3 门禁前提 |

## 4. Worker 测试

| V2 模块 | 裁定 | 理由 |
|---|---|---|
| `tests/unit/constraints/test_engine.py`（150 行） | **REUSE/EXTRACT** | 约束引擎逻辑测试直接保留（若引擎 EXTRACT） |
| `tests/unit/firmware/test_firmware.py` | **REWRITE** | 断言输出形态变化（版本→提案） |
| `tests/unit/platforms/test_platform.py` | **REUSE** | 平台数据/strapping 测试 |
| `tests/unit/circuit/test_circuit.py` | **REUSE** | 电路生成算法测试 |
| `tests/unit/components/test_catalog.py` / `test_registry.py` | **REUSE** | 目录/注册表测试 |
| `tests/unit/jobs/test_consumer.py` / `test_pipeline_definition.py` | **REWRITE** | 断言对象从"阶段链"变为"capability 任务" |
| `tests/unit/runtime/test_pipeline.py` | **REWRITE** | 同上（pipeline → 任务编排） |
| `tests/unit/test_models.py` | **EXTRACT** | 模型结构测试按新 schema 拆分保留 |

## 5. Gateway V2（未推送提交中的 gateway 改动）

| V2 模块 | 裁定 | 理由 |
|---|---|---|
| Gateway V2 API（占位响应） | **DELETE** | 被自家验收判定"占位、未写库未发队列"；新 API 按 Application Capability 重建 |
| acceptance fixtures（10 个 case） | **EXTRACT** | 作为 Capability 测试夹具（Golden Journey 路径）保留价值 |
| feature flags | **DELETE** | 无调用证据（vault 2026-08-01）；新架构不需要 |
| FakeRepository 默认 | **DELETE** | 根因缺陷：默认 Fake = 假运行。新契约要求：真实实现或显式注入，**禁止"默认 Fake"** |

## 6. 旧正式工程（GitHub main 38f8c93）相关

| 模块 | 裁定 | 新契约对应 |
|---|---|---|
| `services/*`（5 个 FastAPI） | **REWRITE**（能力处理器） | analyze/recommend/generate/validate 能力；**LLM 客户端模式保留**（结构化输出+重试+mock） |
| `shared/llm_client.py` | **REUSE** | AI adapter（统一 provider 抽象，参考 Gemini/DeepSeek/OpenAI 兼容） |
| `shared/domain/compatibility.py` | **REUSE** | 电压/兼容冲突检测 → evaluate_constraints |
| `shared/domain/pins.py` / `layout.py` / `classification.py` | **REUSE** | 引脚/布局/分类纯逻辑 |
| `shared/rabbitmq/*` | **DELETE**（契约层） | 传输无关；transport 决策延后 |
| `shared/database/schema.sql` | **DELETE** | 漂移不可用（artifact 列缺失）；Persistence Requirements 阶段重写 |
| `cascade.ts`（invalidateDownstream） | **EXTRACT** | 理念（失效传播）被 stale-semantics 取代；实现重写为依赖图语义 |
| `pipeline.ts` definePipeline（Zod 校验） | **EXTRACT** | 拓扑声明 + 校验的工程价值 → 用于 capability/依赖声明校验（可选） |
| gateway 中间件栈（JWT/限流/安全头） | **REUSE** | 认证/安全基建（Cloud 模式） |
| BYOK 加密（AES-256-GCM + key_hash） | **REUSE** | 认证边界能力（BYOK） |
| websearch 货币安全聚合 | **REUSE** | BOM 价格增强能力（保持解耦） |
| MOCK_MODE | **REUSE** | 开发/演示（State Lab 同源） |

---

## 7. 映射结论

- **REUSE**：llm_client、compatibility/pins/layout/classification、platforms registry（strapping）、components registry、observability、compile_result 结构、货币聚合、加密、中间件栈、约束引擎测试、平台/电路/目录测试
- **EXTRACT**：constraint engine、circuit IR、pin allocation、component selection、cascade 理念、definePipeline 校验、acceptance fixtures、model 测试
- **REWRITE**：firmware generator、requirement stage、consumer/main、arduino_cli adapter、5 个旧服务、gateway API、pipeline/runtime 测试
- **DELETE**：design_spec（域根）、stage.py、FakeRepository、feature flags、V2 占位 API、旧 schema、shared/rabbitmq（契约层）

**总原则**：算法与数据（约束、兼容性、引脚、平台、strapping）是资产 → EXTRACT/REUSE；**流程形态（阶段、管道、Fake 默认、一次性生成）是负债 → DELETE/REWRITE**。
