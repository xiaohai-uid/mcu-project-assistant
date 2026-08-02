# V2 Release Checklist

## Pre-Release Gates

### Gateway
- [ ] `npm ci` succeeds
- [ ] `npm run lint` — 0 errors
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm test` — all pass (254 tests)
- [ ] `npm run build` — succeeds

### Worker
- [ ] `pip install -e .[dev]` succeeds
- [ ] `ruff check src/ tests/` — All checks passed
- [ ] `pytest tests/ -q` — all pass (141 tests)

### Integration
- [ ] `docker compose config` — valid (9 services)
- [ ] `docker compose build` — all images build

### Migrations
- [ ] Run 003-v2-execution-tables.sql on empty DB — succeeds
- [ ] Run 003-v2-execution-tables.sql on V1 DB — succeeds (additive only)
- [ ] Run 003 twice — idempotent (IF NOT EXISTS)

### Compiler
- [ ] `arduino-cli version` — available
- [ ] `arduino-cli compile --fqbn arduino:avr:uno <blink-fixture>` — exit 0

### Acceptance Cases (10)
- [ ] blink
- [ ] dht_monitor
- [ ] lcd_display
- [ ] smart_watering
- [ ] ultrasonic_ruler
- [ ] servo_control
- [ ] rfid_lock
- [ ] weather_station
- [ ] bluetooth_control
- [ ] combo_alarm

## Cutover Steps

1. Ensure all gates above pass
2. Set `PIPELINE_V2_ENABLED=true`
3. Monitor for 1 hour
4. If stable: tag `pre-v2-legacy-removal`
5. Proceed to Phase 11.2 (remove legacy services)

## Rollback

See: `docs/ops/v2-rollback.md`
