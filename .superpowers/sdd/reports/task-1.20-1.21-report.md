# Tasks 1.20–1.21 — Cascade Invalidation 报告

## Status: DONE

## 实现内容

### Task 1.20 — 阶段依赖追踪
- `lib/cascade.ts` — `STAGE_ORDER`, `getDownstreamStages()`
- 四阶段: requirement → recommendation → codegen → schematic
- `getDownstreamStages(stage)` 返回指定阶段之后的所有下游阶段

### Task 1.21 — 级联触发逻辑
- `lib/cascade.ts` — `invalidateDownstream(draftId, fromStage)`
- 设置 `status='stale'` + `current_stage` 为第一个受影响阶段
- 返回下游阶段列表 (为 Layer 2 RabbitMQ 发布预留)

## 新增文件
- `gateway/src/lib/cascade.ts` — cascade lib
- `gateway/__tests__/cascade.test.ts` — 8 tests

## 验收标准
1. ✅ `STAGE_ORDER` 和 `getDownstreamStages()` 依赖追踪
2. ✅ `invalidateDownstream()` DB 更新
3. ✅ 8 tests, 总计 **122 tests passed**
