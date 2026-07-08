# Rollback Guide

## Image Format

All services run as named Docker images built locally. There is no remote registry — rollback means rebuilding the previous commit.

```bash
# Current state on disk
git log --oneline -5

# Rollback to previous deploy
git checkout <previous-tag-or-sha>
docker compose build
docker compose up -d
```

## Database Rollback

### Schema

`shared/database/migrations/*.sql` are applied automatically by the migration runner (`gateway/src/lib/migrate.ts`) on gateway startup. Each migration is tracked in the `_migrations` table.

**To revert a migration:**

```bash
# 1. Connect to the database
docker compose exec postgres psql -U mcu -d mcu_assistant

# 2. Check what's been applied
SELECT filename, applied_at FROM _migrations ORDER BY id;

# 3. Revert the change manually (example: revert 002)
ALTER TABLE api_keys DROP COLUMN IF EXISTS key_hash;

# 4. Remove the tracking row
DELETE FROM _migrations WHERE filename = '002-encrypted-keys.sql';

# 5. Restart gateway to re-run pending migrations (if any)
docker compose restart gateway
```

### Volume (Data)

Named volumes `postgres_data` and `rabbitmq_data` persist across container restarts. To wipe and restart fresh:

```bash
docker compose down -v    # WARNING: destroys all data
docker compose up -d
```

## Service Rollback

If a specific service (e.g. `websearch-service`) is broken:

```bash
# Rebuild just that service from current code
docker compose build websearch-service
docker compose up -d websearch-service

# Or pin to an older image if one exists (requires registry setup)
docker compose up -d websearch-service
```

## Full Rollback

```bash
# 1. Note the current HEAD
CURRENT=$(git rev-parse HEAD)

# 2. Go back to the last known-good commit
git checkout <known-good-sha>

# 3. Rebuild everything
docker compose build

# 4. Restart (preserves volumes)
docker compose up -d

# 5. Verify
curl http://localhost:3000/api/health

# 6. To return to HEAD after fix:
git checkout $CURRENT
docker compose build
docker compose up -d
```

## Incident Checklist

1. Check `/api/health` for which service is degraded
2. Check logs: `docker compose logs <service> --tail 50`
3. If code issue → rollback service or full rollback
4. If DB issue → check `_migrations` for partial application
5. If bad deploy → `git revert` the commit and rebuild

## Key Commands

```bash
docker compose logs <service> --tail 50   # check logs
docker compose restart <service>           # soft restart
docker compose down -v                     # full wipe + restart
docker compose build <service>             # rebuild single service
docker compose up -d                       # restart all
```