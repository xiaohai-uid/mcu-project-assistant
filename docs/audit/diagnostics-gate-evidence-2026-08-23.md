# 诊断切片成功证据（[E1]/[E2]/[E3]）— 2026-08-23

- 仓库：`xiaohai-uid/mcu-project-assistant` @ `ac3cc9c`（ISSUE-002/003/004/006 已合入后的 HEAD）
- 环境：WSL2 (Ubuntu) / Node 22 / 本地 SQLite
- 关联：PRD 成功证据三项；ISSUE-001 DoD「各留证据」；ISSUE-005
- 红线遵循：文档不含任何真实凭据；命令以 `$OPERATOR_BASIC` 环境变量形式引用认证（本地一次性值，不入库）

---

## [E1] 全量门禁运行输出

日期：2026-08-22T18:15Z ｜ HEAD：`ac3cc9c`

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 通过（零输出，exit=0） |
| `npm run lint` | 通过（零输出，exit=0） |
| `npm run build` | `✓ built in 608ms`（exit=0） |
| `npm test` | **Test Files: 4 failed / 103 passed (107)**；**Tests: 4 failed / 637 passed / 1 skipped (643)** |

测试失败明细（与 `.scratch/mcu-commercial-product/issues/08` 文档化的 WSL 永久环境集逐一对应，origin/main 无关改动上原样复现）：

```
tests/integration/infrastructure/owned-child-crash.test.ts × 2（父子进程终止语义）
tests/unit/adapters/compiler/esp32-arduino.test.ts × 1（output-flood 子进程终止）
tests/unit/adapters/device/physical-arduino.test.ts × 1（并发闪写租约时序）
```

另知：`tests/contract/sse/events.test.ts` 在全量并行负载下偶发抖动，单跑稳定通过（本日两轮全量中一现一隐），非本切片回归。

---

## [E2] 本地真实链路往返

日期：2026-08-22T18:14Z ｜ 构建：`npm run build` 后 `node dist/server/server.js`

服务启动（临时本地凭据与占位 AI key，仅本次证据会话使用）：

```bash
MCU_HOST=127.0.0.1 MCU_PORT=3931 \
MCU_DEVICE_PROVIDER=companion MCU_AI_PROVIDER=zhipu \
MCU_ZHIPU_API_KEY=e2e-evidence-placeholder-not-a-real-key \
MCU_ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4 \
MCU_ZHIPU_CHAT_MODEL=glm-4-flash \
MCU_DB_PATH=/tmp/e2e-evi/evidence.db MCU_WORKSPACE_DIR=/tmp/e2e-evi/ws \
MCU_BASIC_AUTH_USER=evidence-op MCU_BASIC_AUTH_PASSWORD=local-evidence-pass-16ch \
node dist/server/server.js
# [log] MCU Project Assistant local server listening on http://127.0.0.1:3931 (ai=zhipu-glm)
```

往返全程（`$OPERATOR_BASIC` = 本地一次性 Basic 凭据，已脱敏）：

```text
### step0 healthz（免认证探活）
{"status":"ok"}                                   HTTP 200
### step1 api health（运营者认证）
{"status":"ok"}                                   HTTP 200
### step2 失败请求（合法 JSON、业务校验失败）
{"error":{"code":"invalid_name","message":"Project name is invalid"}}
                                                  HTTP 400
### step3 客户端错误上报
{"status":"accepted"}                             HTTP 202
### step4 运营者诊断读取 GET /api/v1/diagnostics/events?limit=10   HTTP 200
{"events":[
  {"id":2,"level":"warn","source":"server","type":"http.request",
   "correlationId":"ce460f00-…","data":{"method":"POST","path":"/api/v1/projects","status":400,"durationMs":1}},
  {"id":1,"level":"error","source":"client","type":"client.error",
   "correlationId":"bf4d628d-…","data":{"message":"E2 evidence: simulated renderer crash",
   "sessionId":"e2e-evidence-session","stack":"at render()","url":"http://127.0.0.1:3931/"}}
]}
```

**核验点**：
- 两行齐备——服务端失败请求落 `http.request`(warn)，客户端上报落 `client.error`(error)。✅
- ISSUE-003 契约在真实进程生效：`client.error.correlationId == 该 POST 响应头 x-request-id`；原 `sessionId` 降级为 data 字段保留。✅
- ISSUE-004 单一事实源生效：400 仅一行 `http.request`；无 api.error 双写。✅

观测备注（预存行为，非本切片缺陷）：请求体 JSON 解析失败（`invalid_json` 400）发生在 express.json 解析器层，先于 request-id/finish 中间件链，故**既不产生 event_log 行，也不产生本服务的 stdout 指标行**（完成钩子从未挂载）。这类请求只存在于接入层（反向代理）日志中；如需覆盖，可在解析错误处理器内补一行记录。

---

## [E3] 托管 smoke — 已备好待用户执行（pending-human）

平台：Render（`render.yaml` → service `mcu-project-assistant-free`，docker runtime，healthCheckPath `/healthz`）。密钥类 envVars 均 `sync: false`，部署动作需用户控制台操作。

用户执行清单（约 5 分钟）：

1. Render 控制台 → mcu-project-assistant-free → Manual Deploy → Deploy latest commit（≥ `ac3cc9c`）。
2. 记录 deploy revision id。
3. 公网往返验证（免认证部分任何人可跑）：
   ```bash
   curl -s -w "\nHTTP %{http_code}\n" https://mcu-project-assistant-free.onrender.com/healthz
   ```
   预期 `{"status":"ok"}` HTTP 200。
4. 认证部分（凭据走 Render Dashboard 的 envVars，勿贴入任何文档）：登录后触发一次前端报错或直接 `POST /api/v1/diagnostics/client-errors`，再以运营者身份读 `/api/v1/diagnostics/events` 核对行数 +1。

agent 可代跑的部分：第 3 步公网 healthz 探活可随时执行；其余等部署完成后同样可代跑并回填本文档。

2026-08-22T18:20Z 探活尝试（agent）：`https://mcu-project-assistant-free.onrender.com/healthz` 与 `https://mcu-project-assistant.onrender.com/healthz` 均返回 404 Not Found（Render 对不存在/自定义域服务一律 404）——实际公网 URL 需用户提供，或该服务尚未首次部署。**[E3] 整体保持 pending-human。**
