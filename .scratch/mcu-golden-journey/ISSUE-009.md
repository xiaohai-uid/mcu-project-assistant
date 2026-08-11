# ISSUE-009 — S7 Build end-to-end

**Status:** resolved
**Blocked by:** ISSUE-008（Firmware Proposal + Diff e2e）
**Priority:** P0-core

## 1. User-visible outcome

用户点击"编译"：真实工具链输出逐行流入 Build 视图（可取消）；成功 → BUILD SUCCESS + 内存/Flash 用量 + BuildRecord；失败 → BUILD FAILED + 错误日志（诊断在 S8）；同一固件版本可多次构建（历史可见）；**Build 不产生新 Firmware 版本**；工具链缺失 → 明确警告与重检测入口。

## 2. Frozen upstream references

- UI：BuildView（日志/结果徽标/工具链横幅/串口区）、ui-state-model.md（W12/W13/W14/W16、G6）
- Interaction Contract：F1 Build / F2 Cancel Build / F5 Rebuild
- Application Capability：run_build（application-contract 2.12）
- Domain Invariant：I-6（Build 不产生内容版本；失败也落记录）、I-7（未验证≠通过）、D2
- Product Decision：D2（BuildRecord vs ArtifactVersion）
- ADR：0007（Task Execution）、0008（SSE）、0009（Companion 边界——build 执行属工具链，非设备）、0013
- Implementation Spec：§13 Build Spec（BuildRecord 字段）、§14 CompilerPort（结构化参数）、§15 S7、§5 工作区 .build/
- v2-contract-mapping：compile_result 形状 EXTRACT、arduino_cli REWRITE

## 3. In scope

- CompilerPort（discoverToolchain/build——**结构化参数**：target="esp32-s3"、toolchain 枚举、options 对象；禁原始命令串）
- esp32-arduino 适配器：本地工具链发现（arduino-cli，M1 选定：单二进制轻量、与 V2 方向一致；platformio 为后续备选）→ 编译执行（child_process，无 shell 拼接）→ 逐行输出事件（build.output）
- run_build：POST /projects/:id/builds → 202 {buildId}；BuildRecord（id/artifactVersionId/target/toolchain/toolchainVersion/options/status/startedAt/completedAt/stdoutRef/stderrRef/diagnostics/exitCode）；**同版本多 Build 允许**；取消（/builds/:id/cancel）
- 证据分离：stdout/stderr → workspace `.build/<buildId>.log`；SQLite 只存 metadata/refs/diagnostics/exitCode
- ToolchainUnavailable：discover 失败 → 503 + UI 横幅 + 重检测
- UI：日志流（SSE build.output，允许合并）、结果徽标、工具链横幅、历史（GET /versions/:vid/builds）切真实 API

## 4. Out of scope

- 诊断/修复提案（S8）；Flash（S9）；构建农场/云 worker/RabbitMQ（Non-Goals）；任意 shell 执行

## 5. Mock being replaced

```
mockRunBuildScript（UI 内预置日志脚本）
→ real run_build（CompilerPort esp32-arduino + BuildRecord）
mock toolchain 开关（Lab 状态）
→ real discoverToolchain（真实检测 + ToolchainUnavailable 事件）
```

## 6. End-to-end flow

```
Firmware v1（S8 前置）→ POST /projects/:id/builds {versionId, target, toolchain}
→ TaskExecutionPort.submit → CompilerPort.discoverToolchain（缺失 → 503 ToolchainUnavailable）
→ CompilerPort.build（结构化参数）→ 逐行 build.output（SSE → UI 日志）
→ 完成 → BuildRecord（succeeded/failed，stdout→.build/<id>.log，exitCode）
→ UI 结果徽标；GET /versions/:vid/builds 历史
→ 再次编译 → 新 BuildRecord（同一 Firmware v1，不产生 v2）
→ 取消 → build.cancelled + 不写半成品
```

## 7. Minimum domain changes

- BuildRecord 类型（D2 字段）；无其他新对象

## 8. Minimum persistence changes

- 表：build_records（上述字段 + 索引 idx_builds_version）
- Workspace：.build/<buildId>.log（大体积证据；DB 只存 ref）

## 9. Ports / Adapters

- CompilerPort → esp32-arduino（结构化参数）+ mock（测试）
- TaskExecutionPort（复用 S3A in-process）
- EventPort（复用；build.output/build.succeeded/failed/cancelled）

## 10. Error states

- 503 ToolchainUnavailable；409 stale_blocked（L3 未处理，S5B 门禁接入）；build failed = 200 记录（非错误信封，诊断在 S8）；取消幂等

## 11. Tests first

- Domain：BuildRecord 状态机（running→succeeded/failed/cancelled）；**Build 不产生 Firmware 版本（D2 断言）**
- Application：run_build（幂等键、取消、失败落记录）
- Adapter：compiler mock（结构化参数正确性；**无 shell 拼接断言**——参数数组传递）；工具链发现
- Persistence：build_records 约束；.build 文件写入
- Contract/SSE：POST /projects/:id/builds、build.output 帧、终态事件、取消
- Browser/E2E：见 §12

## 12. Browser acceptance

```
Firmware 就绪 → Build 视图 → 点"编译"
→ 日志逐行流入（CMake→编译→链接→镜像）→ BUILD SUCCESS + 用量
→ 再点"编译" → 新日志（Build #2，同固件版本）
→ Lab 触发"下次编译失败" → 编译 → BUILD FAILED + 错误行
→ Lab 触发"工具链缺失" → 横幅 + 编译禁用 → 重检测恢复
→ 刷新 → Build 历史（2 条记录，版本号未变）
```

## 13. Definition of Done

- typecheck/lint/test 绿（D2 断言 + 无 shell 拼接断言）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 构建日志生产路径删除
- 大体积日志在 .build/（DB 只 metadata）；无 fallback；无云 worker

## 14. Forbidden shortcuts

- 禁止 LLM/UI 生成任意 shell 命令（CompilerPort 只收结构化参数；child_process 数组传参）
- 禁止 Build 产生 Firmware 版本（D2）
- 禁止 RabbitMQ/云 worker/build farm
- 禁止本票实现诊断/修复（S8）；禁止日志存 SQLite

---

## Delivery Record（2026-08-11，ZCode）

**实际实现**（S7 范围；无诊断/修复——S8；无云 worker/RabbitMQ）：
- `src/ports/compiler.ts` — CompilerPort（**结构化参数**：target/toolchain/options 对象；禁止原始命令串）；ToolchainUnavailableError
- `src/adapters/compiler/esp32-arduino.ts` — 真实适配器：discover（spawnSync arduino-cli version，ENOENT → unavailable+reason）；build（spawn argv 数组、**shell:false 无拼接**、逐行流式、signal 中断杀进程）
- `src/adapters/compiler/mock.ts` — deterministic mock（测试/e2e 夹具；**结构化参数断言** = 无 shell 拼接契约；mutable script handle 支持单服务器多场景）
- `src/application/capabilities/build.ts` — run_build（202 {buildId}；BuildRecord 先落库 running → in-process 任务 → 逐行 build.output（SSE）+ `.build/<buildId>.log` 证据分离（DB 只存 ref）→ 终态记录；**D2：Build 不产生 Firmware 版本**；I-6：失败也落记录；取消幂等（终态 409））；L3 门禁（I-8：run_build 被 BlockingStale 拒绝）
- BuildRecord 状态机（running→succeeded|failed|cancelled；终态幂等）+ 迁移 007（build_records + task_id + idx_builds_version）
- HTTP：POST /projects/:id/builds（202）、GET /builds/:buildId、POST /builds/:buildId/cancel、GET /versions/:vid/builds、GET /toolchain（真实 discover）
- 事件：build.output / build.succeeded / build.failed / build.cancelled（SSE 帧契约测试）
- UI（Progressive Swap）：mock runBuildScript 生产路径删除；真实 run_build + SSE 事件驱动日志流/结果徽标；真实 discoverToolchain 驱动工具链横幅 + **重新检测**入口；取消走 API

**Tests**：domain 状态机 4 + application 4（含 D2 断言 + .build 文件真实存在 + 无 shell 拼接契约）+ contract 4（含 SSE build.output 帧 + 503 + cancel 409）+ e2e golden 2 = 14 新增；`npm test` 282/282 全绿；typecheck/lint 0；app build 0

**Browser evidence**（真实 Chrome，真实 HTTP + 真实 esp32-arduino discover）：打开项目 → 系统消息 "Toolchain unavailable: arduino-cli not found on PATH"（真实检测）→ Build 视图横幅"工具链不可用" + 编译按钮禁用 → 点"重新检测" → 再次真实检测（横幅保持——工具链确缺失）。

**Acceptance marking**：
- 工具链缺失 → 横幅/禁用/重检测：**REAL**（真实 discoverToolchain；本机无 arduino-cli）
- BUILD SUCCESS / BUILD FAILED / 取消 / Build #2 同版本：**DETERMINISTIC**（e2e mock 编译适配器覆盖全部路径；无真实工具链环境）

**Deviations**：
1. run_build 任务执行期间 BuildRecord 先落库（running）→ task_id 随后回填（取消查询用）
2. build.output 逐行事件不合并（高频流合并为延后项；M1 本地单用户可承受）
3. 取消返回 202 确认 + 终态由任务处理器异步落（build.cancelled 事件驱动 UI）
4. esp32-arduino build 的 srcDir 由 capability 传结构化 options.srcDir（固件版本 contentRef 解析出源目录；.build/ 输出目录由 adapter 默认）
