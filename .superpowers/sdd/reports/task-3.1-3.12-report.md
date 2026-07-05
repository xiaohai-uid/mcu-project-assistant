# Tasks 3.1–3.12 — Gateway Pipeline Orchestration 报告

## Status: DONE

## 实现内容

### 3.1 Gateway Publish/Subscribe
- 5 consumers bound to output queues via `getChannel().consume()`

### 3.2 Start → Requirement
- 已在 Task 1.5 完成 — POST /api/projects/start ✓

### 3.3 Requirement → Recommendation
- `handleRequirementOutput()`: status → "recommending", publish to RECOMMENDATION_INPUT

### 3.4 Recommendation → Codegen
- `handleRecommendationOutput()`: status → "generating", 读取 DB 获取 context, 转发

### 3.5 Codegen → Schematic
- `handleCodegenOutput()`: status → "finalizing", 保存 code + pin_mappings, 转发

### 3.6 Schematic → Finalize
- `handleSchematicOutput()`: status → "ready", 保存 svg + pin_table

### 3.7 Error Handling
- try/catch 包裹每个 handler, ack even on error, status → "failed" + error_message

### 3.8 Polling Endpoint
- GET /api/projects/[id]: 返回完整 DesignDraft 状态

### 3.9 WebSearch Output
- `handleWebsearchOutput()`: 保存 price_comparison JSON

### 3.10 Per-Stage Timeout
- `startStageTimeout()` (60s), timeout 自动标记失败

### 3.11 Completion Notification
- `console.log` on completion (预留 webhook 扩展点)

### 3.12 Rollback
- Failed stage → status "failed", 保留 partial results, 存储 error trace

## 修改文件
- `gateway/src/lib/orchestrator.ts` — 新建
- `gateway/src/run-consumer.ts` — 新建
- `gateway/src/app/api/projects/[id]/route.ts` — 重写
- `gateway/package.json` — 添加 consumer 脚本 + tsx 依赖
- `gateway/tsconfig.json` — 修复 paths 别名

## TypeScript
- 新文件 0 错误, 剩余 17 个均为预存错误 (测试文件 + amqplib 类型)
