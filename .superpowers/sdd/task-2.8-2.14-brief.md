# Tasks 2.8–2.14 — RecommendationService

## Acceptance Criteria

### 2.8 — SQLite Schema + Seed Data
- Create `services/recommendation-service/schema.sql` with `components` table + `component_categories`
- Create `services/recommendation-service/seed.py` to populate ~30 common MCU components
- Component fields: id, name, category, price, voltage, pin_count, protocol, compatible_platforms, description

### 2.9 — Platform Compatibility Checker
- In `main.py`: `check_compatibility(component, platform)` — verifies voltage range, pin count, protocol support
- Returns `{ compatible: bool, reasons: [str] }`

### 2.10 — Three-Tier Cost Allocation
- Enhanced `allocate_tiers(components, platform)` — budget (<$3), standard ($3-$15), premium (>$15)
- Ensures each tier has at least one option per functional category

### 2.11 — AI-Assisted Matching
- AI fallback: query LLM for component recommendations when SQLite returns empty
- `ai_match_component(requirement, modelConfig)` → returns Component-like dicts with `isAiSuggested=true`

### 2.12 — Conflict Detection
- `detect_conflicts(selected_components)` — voltage mismatch, protocol incompatibility, pin shortage
- Returns list of `{ type, severity, message }` conflicts

### 2.13 — Membership-Aware Triple Path
- `free + no key` → skip (no recommendation)
- `free + AI key` → SQLite only, reference prices
- `member / search key` → SQLite + publish to WebSearchService for price comparison

### 2.14 — Message Loop
- Manual ack, try/except error handling, DLQ pattern

## Implementation files
- **Modify:** `services/recommendation-service/main.py` — full rewrite
- **Create:** `services/recommendation-service/schema.sql` — components table
- **Create:** `services/recommendation-service/seed.py` — 30 seed components
- **Modify:** `shared/rabbitmq/queues.py` — add RECOMMENDATION_ERROR queue if needed

Working directory: `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant`

## Output
Return files created/modified and syntax validation result.