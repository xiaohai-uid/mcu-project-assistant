# Tasks 1.17–1.19 — ProjectSnapshot (Auto + Manual + Browse/Restore)

## Acceptance Criteria
1. **Lib:** `createSnapshot(draftId, name?, isAuto?)` insets into project_snapshots with full state JSONB
2. **POST /api/projects/[designDraftId]/snapshots** — body `{ name }`, creates manual named snapshot
3. **GET /api/projects/[designDraftId]/snapshots** — lists all snapshots for a draft (id, name, is_auto, created_at)
4. **POST /api/snapshots/[snapshotId]/restore** — restores draft fields from snapshot_data
5. All routes require x-user-id (JWT auth via middleware)
6. Tests: create snapshot, list snapshots, restore, 404, 401, ownership check

## Context
- Schema: `project_snapshots(id, design_draft_id, name, is_auto, snapshot_data JSONB, created_at)`
- `design_drafts(id, user_id, title, raw_description, status, current_stage, experience_level, membership_tier)`
- snapshot_data JSONB captures: title, raw_description, experience_level, membership_tier, status, current_stage
- Auto snapshot: `isAuto=true`, name optional (default "自动快照 #N")
- Manual snapshot: `isAuto=false`, name required
- Restore: UPDATE design_drafts SET title/raw_description/etc from snapshot_data

## Implementation files
- **Create:** `gateway/src/lib/snapshot.ts` — `createSnapshot()`, `listSnapshots()`, `restoreSnapshot()`
- **Create:** `gateway/src/app/api/projects/[designDraftId]/snapshots/route.ts` — GET (list) + POST (create)
- **Create:** `gateway/src/app/api/snapshots/[snapshotId]/restore/route.ts` — POST (restore)
- **Create:** `gateway/__tests__/snapshots.test.ts` — full test suite

## Route patterns to follow
- `gateway/src/app/api/membership/upgrade/route.ts` — x-user-id, db.query, error handling
- `gateway/src/app/api/api-keys/route.ts` — route with path params

## Output
Return files created/modified and full test results (npx vitest run).
