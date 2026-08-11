# ISSUE-011 — S9 Flash Confirmation + Serial end-to-end

**Status:** resolved
**Blocked by:** ISSUE-010（Failure Diagnosis + Fix e2e）
**Priority:** P0-core
**Resolved:** 2026-08-12 · commit `ebca0d1`（docs `253fb5e`）· DETERMINISTIC acceptance

## 15. Delivery Record

- **DevicePort**（`src/ports/device.ts`）+ companion-local adapter（`src/adapters/device/companion-local.ts`）：ESP32-S3 WROOM-1 @ COM6 @ 115200；flash 进度 10→100% + 行事件；serialStream/sendSerial/disconnect。**DeviceSession = 运行时状态**（无 device_sessions 表；preferences 存 last_device）。
- **flash_device**（`src/application/capabilities/flash.ts`）：一次性确认令牌（60s TTL、单次、绑定设备）→ L3 Stale 门禁（I-8）→ 连接检查 → in-process task（device.flashing 进度）→ 成功才写 `.evidence/<sessionId>.log`（中断/失败零半成品证据，测试证明）；AI/Companion/重试无令牌一律拒绝。
- **HTTP**（app.ts）：`/device/detect`、`/device/flash-token`、`/device/flash`、`/device/disconnect`、`/device/serial/send`、`/device/serial/stream`（SSE `serial.line` + `device.disconnected`）。
- **Persistent**：preferences 表（migration v8）；`setPreference`/`getPreference`（UoW）。
- **UI swap（§5 全换）**：mock detectBoard/flashDevice/sendSerial 删除 → 真实 API；flash 确认对话框 → `flashWithConfirmation`（用户动作 → 签发令牌 → 真实 flash）；串口流经 EventSource；Build/SideNav bolt 均走确认对话框。
- **Browser acceptance（§12 全过，deterministic）**：检测 → "已连接 ESP32-S3 (COM6)"；烧录 → 高风险确认 → 进度 → 完成（`[system] Firmware flashed successfully` + `.evidence/session-*.log` 6 步）；遥测流；`GET_STATUS` → 回显 `STATUS moisture=.. pump=.. temp=..`；Lab 断开 → 顶栏红点 + 串口冻结 + 输入禁用。
- **安全组**（flash-security.test.ts，8 tests）：missing/expired/reused/device_mismatch/无令牌/L3 Stale/中断无证据/错设备 全绿。
- **Deviations**：无（proposals.type CHECK 冻结，无新类型需求）。toolchain 缺失（无 arduino-cli）→ Build 视图 flash 按钮不可达（stage 门禁）；§12 走 Companion 视图路径（仅需 firmwareOk）——已按验收标注。
- **验收标注**：DETERMINISTIC —— 无真实硬件/arduino-cli；真实 DevicePort 结构 + companion-local 适配器按能力实现。

## 1. User-visible outcome

用户在 Companion/Build 视图检测到开发板（型号/COM 口）后点"烧录"：出现高风险确认对话框 → 确认后烧录进度 → 完成 → 串口遥测流（可发命令）。**Flash 必须显式用户确认**：一次性令牌、过期拒绝、AI/Companion/重试不得绕过；L3 Stale 下禁止烧录；设备断开中止烧录（不留半成品证据）。

## 2. Frozen upstream references

- UI：CompanionView/BuildView（检测/烧录确认/串口/遥测）、ui-state-model.md（H1-H3、O3/O4、G5）
- Interaction Contract：H1 Detect Board / H2 Flash / H3 Device Disconnect
- Application Capability：flash_device / detect_device / device_session / read_serial（application-contract 2.15/2.16/2.17）
- Domain Invariant：I-8（L3 禁 Flash）、I-10（证据保留）；DeviceSession = 运行时状态（非持久业务数据）
- Product Decision：D6（确认语义）；Safety（Tier 0：用户不知情不得执行工程风险动作）
- ADR：0009（Companion 边界：Device Port 适配器，无领域状态）、0008（SSE/串口流）、0013
- Implementation Spec：§4 Companion M1 五能力、§9 DevicePort、§12 Security（Flash 确认令牌）、§15 S9、§5 工作区 .evidence/

## 3. In scope

- DevicePort（detectBoard/flash/serialStream/sendSerial）→ **companion-local 适配器**（M1 最小：检测/烧录/串口；mock 适配器并行用于测试）
- Companion M1 正式能力（仅 5 项）：discover toolchain（S7 已建，接入设备流程）/ detect board / structured build 边界（复用 S7）/ flash / basic serial——**其余 8 类排除**（§4 Non-Goals）
- flash_device：POST /device/flash {deviceId, confirmationToken, firmwareVersionId}；**确认令牌 = UI 对话框一次性生成、短时效（如 60s）、单次使用**；AI/Provider/Companion 自身无令牌拒绝；**L3 Stale 门禁**（I-8）；设备断开中止（不留半成品证据）
- 烧录进度事件（device.flashing/completed/failed）+ 完成后 Debug 证据（.evidence/<sessionId>.log；DebugEvidence 版本化内容）
- DeviceSession = **运行时状态**（DevicePort/适配器内存态；持久化仅 last_device/toolchain_info → preferences）
- 串口：GET /device/serial/stream（SSE）+ POST /device/serial/send
- UI：检测/确认对话框/进度/串口/遥测切真实 API

## 4. Out of scope

- 高级调试器/USB 抽象/device fleet/远程设备/插件/通用工具运行器/任意 shell/遥测平台（Non-Goals）
- Flash 之外的高风险操作（erase 等）；真实硬件串口协议细节（适配器内；mock 覆盖验收）

## 5. Mock being replaced

```
mockDetectBoard / mockFlashDevice / mockSendSerial（AppContext/CompanionView 内存）
→ real DevicePort companion-local（+ mock device adapter 保留测试）
mock 确认对话框（BuildView 本地 state）
→ real 令牌校验（服务端一次性/过期/L3 门禁）
```

## 6. End-to-end flow

```
POST /device/detect → DevicePort.detectBoard → 设备信息（型号/COM）→ connected
→ POST /device/flash {confirmationToken}（令牌由 UI 对话框向服务端签发，一次性）
→ 校验：令牌有效？L3 Stale？设备连接？→ 拒绝任一 → 403/409
→ DevicePort.flash → device.flashing 进度（SSE）→ completed
→ Debug 证据写入 .evidence/ + DebugEvidence 版本
→ GET /device/serial/stream → 遥测行流；POST /device/serial/send {command} → 回显
→ 断开 → device.disconnected（顶栏红点；烧录中则中止）
```

## 7. Minimum domain changes

- DeviceSession 运行时类型（检测/连接/烧录/断开迁移）；DebugEvidence 内容形状
- **无新持久对象**（会话不建表——S2 表审查决策）

## 8. Minimum persistence changes

- 表：preferences（key/value；last_device/toolchain_info 条目）
- Workspace：.evidence/<sessionId>.log

## 9. Ports / Adapters

- DevicePort → companion-local + mock（测试）
- PersistencePort：UoW 增 setPreference；只读 getPreference
- EventPort（复用；device.* 事件）

## 10. Error states

- 403 confirmation_missing / confirmation_expired / token_reused（一次性）；409 DeviceDisconnected；409 BlockingStale（L3）；烧录中断（无半成品证据）

## 11. Tests first

- **安全验收（必须单独成组）**：令牌一次性（复用被拒）、过期（60s 后拒）、错误设备（令牌绑定设备）、断线重连后令牌不可复用（重新确认）、无令牌被拒、L3 Stale 被拒
- Domain/Application：flash_device（确认校验、门禁）、detect/断开（烧录中止）
- Adapter：device mock（检测/进度/串口流）；companion-local 结构
- Persistence：preferences；.evidence 写入
- Contract/SSE：/device/*、device.flashing 帧、串口流
- Browser/E2E：见 §12

## 12. Browser acceptance

```
Companion 视图 → 检测开发板 → "已连接 ESP32-S3 (COM6)"
→ Build 视图（Build 成功后）→ "烧录" → 确认对话框 → 确认
→ 烧录进度 0→100% → 完成 → 串口遥测流出现（Moisture/Pump 行）
→ 发串口命令 GET_STATUS → 回显
→ Lab 触发"设备断开" → 顶栏红点 + 串口停止
→ 安全验证：过期令牌 / 二次复用令牌 / 无令牌 → 全部被拒
```

## 13. Definition of Done

- typecheck/lint/test 绿（**安全验收组必须全部通过**）；e2e:golden 相关用例绿
- 浏览器验收全过；Mock 设备生产路径删除（mock 仅测试适配器）
- 无令牌绕过路径（测试证明）；会话不建表；无 fallback

## 14. Forbidden shortcuts

- 禁止无确认 Flash（AI/Companion/重试不得绕过——令牌必须来自 UI 用户动作）
- 禁止 DeviceSession 建持久表（运行时状态 + preferences）
- 禁止实现排除清单 8 类能力
- 禁止本票接入真实硬件作为完成前提（mock 适配器可验收；companion-local 按能力实现）
