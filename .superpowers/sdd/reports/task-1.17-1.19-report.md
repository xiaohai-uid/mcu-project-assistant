# Tasks 1.17–1.19 — ProjectSnapshot 报告

## Status: DONE

## 实现内容

### Task 1.17 — 自动快照
- `lib/snapshot.ts` — `createSnapshot()` 函数
- 自动生成名称 "自动快照 #N" (N 递增)
- 为 Layer 2 流水线完成回调预留调用点

### Task 1.18 — 手动命名快照
- `POST /api/projects/[designDraftId]/snapshots` — body `{ name }`
- 201 返回快照详情，name 必填

### Task 1.19 — 快照浏览与恢复
- `GET /api/projects/[designDraftId]/snapshots` — 列出所有快照
- `POST /api/snapshots/[snapshotId]/restore` — 恢复快照
- 恢复时更新 design_drafts 的 title/raw_description/status/current_stage/experience_level

## 新增文件
- `gateway/src/lib/snapshot.ts` — `createSnapshot()`, `listSnapshots()`, `restoreSnapshot()`
- `gateway/src/app/api/projects/[designDraftId]/snapshots/route.ts`
- `gateway/src/app/api/snapshots/[snapshotId]/restore/route.ts`
- `gateway/__tests__/snapshots.test.ts` — 9 tests

## 验收标准完成情况
1. ✅ `createSnapshot()` lib 函数 (auto + manual)
2. ✅ POST 手动命名快照 (name 必填)
3. ✅ GET 快照列表
4. ✅ POST 恢复快照 (UPDATE 设计稿)
5. ✅ JWT 保护 + 所有权检查
6. ✅ 9 tests passed, 总计 **114 tests passed**
