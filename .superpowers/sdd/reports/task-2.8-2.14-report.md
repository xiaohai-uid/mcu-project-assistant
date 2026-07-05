# Tasks 2.8–2.14 — RecommendationService 报告

## Status: DONE

## 实现内容

### 2.8 — SQLite Schema + Seed Data
- `schema.sql`: 两张表 (component_categories, components), 6 个品类
- `seed.py`: 32 个常见组件 (主控板5, 传感器10, 执行器7, 显示3, 通信3, 电源4)

### 2.9 — Platform Compatibility Checker
- `check_compatibility(component, platform)`: 检查 `compatible_platforms` 字段
- 返回 `{ compatible: bool, reasons: [str] }`

### 2.10 — Three-Tier Cost Allocation
- `allocate_tiers(components, platform)`: budget (<$3), standard ($3-$15), premium (>$15)
- 自动过滤平台不兼容的组件
- 返回 `totalCosts` 各层级总价

### 2.11 — AI-Assisted Matching
- `ai_match_components()`: SQLite 无匹配时通过 LLM 生成推荐
- 标记 `isAiSuggested=true`

### 2.12 — Conflict Detection
- `detect_conflicts()`: 检测电压不匹配
- 返回 severity 等级

### 2.13 — Membership Triple Path
- `free + no key` → 跳过, 返回 error
- `free + AI key` → SQLite only
- `member/search key` → SQLite + WebSearch

### 2.14 — Message Loop
- manual ack, try/except, traceback, DLQ 模式

## 修改文件
- `services/recommendation-service/main.py` — 完全重写
- `services/recommendation-service/schema.sql` — 新建
- `services/recommendation-service/seed.py` — 新建
