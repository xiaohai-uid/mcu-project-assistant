---
title: Extract shared domain logic from services
status: ready-for-agent
labels: [refactor, domain]
date: 2026-07-08
prd: .scratch/domain-extraction/PRD.md
---

# Issue: Extract shared domain logic from services

## Description

Extract 11+ duplicated domain functions (`check_compatibility`, `allocate_tiers`, `detect_conflicts`, `CATEGORY_MAP`, `PIN_TYPE_MAP`, `PLATFORM_PINS`, `assign_pins`, `resolve_dependencies`, `COMPONENT_LIBRARIES`, `layout_components`, `generate_bom`, `render_pin_table`) from four files into `shared/domain/` sub-packages.

## Tasks

- [ ] Create `shared/domain/__init__.py`
- [ ] Create `shared/domain/classification.py` (CATEGORY_MAP, _map_functionality_to_category)
- [ ] Create `shared/domain/compatibility.py` (check_compatibility, allocate_tiers with optional platform, detect_conflicts)
- [ ] Create `shared/domain/pins.py` (PLATFORM_PINS, PIN_TYPE_MAP, assign_pins, resolve_dependencies, COMPONENT_LIBRARIES)
- [ ] Create `shared/domain/layout.py` (layout_components, generate_bom, render_pin_table, WIRE_COLORS)
- [ ] Adapt `services/recommendation-service/main.py` to import from shared.domain
- [ ] Adapt `services/codegen-service/main.py` to import from shared.domain
- [ ] Adapt `services/schematic-service/main.py` to import from shared.domain
- [ ] Rewrite `trial_run.py` to import from shared.domain (remove all copy-paste)
- [ ] Remove dead HTTP env vars from `docker-compose.yml`
- [ ] Create `shared/tests/test_compatibility.py`
- [ ] Create `shared/tests/test_classification.py`
- [ ] Create `shared/tests/test_pins.py`
- [ ] Create `shared/tests/test_layout.py`
- [ ] Add one smoke test per modified service
- [ ] Delete copied functions from each service
- [ ] Run all tests to confirm no regression

## Verification

```powershell
# From D:\mcu-project-assistant
cd services/recommendation-service; python -m pytest tests/ -v
cd ../codegen-service; python -m pytest tests/ -v
cd ../schematic-service; python -m pytest tests/ -v
# Unit tests
cd ../..; python -m pytest shared/tests/ -v
# Trial run
python trial_run.py "test" --dry-run
```
