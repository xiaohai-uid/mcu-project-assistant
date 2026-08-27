# Tasks 2.16–2.22 — WebSearchService 报告

## Status: DONE

## 实现内容

### 2.16 — 1688 Crawler
- `search_taobao()`: HTTP GET to 1688 search, BeautifulSoup parse `.offer-item`
- 返回 `{source, component, title, price, currency, url, timestamp}`

### 2.17 — General Search Engine
- `search_general()`: POST DuckDuckGo HTML, parse `.result__title a`, `.result__snippet`
- Form data: `{q: f"{component} price buy"}`

### 2.18 — Professional Distributor
- `search_distributor()`: LCSC product page HTML parsing
- 注释预留 Mouser/DigiKey 模式

### 2.19 — Price Comparison & Freshness
- `deduplicate_results()`: 按组件+源去重, 保留最便宜
- `aggregate_prices()`: cheapest, average, currency, timestamp

### 2.20 — Anti-Blocking
- 6 个 User-Agent 轮换池
- `RateLimiter` 类: 每源 2s 最小间隔 + jitter
- `_get_proxy()` 占位

### 2.21 — Error Handling
- `retry_with_backoff()`: 3 次重试 (1s/2s/4s)
- 每源 10s timeout

### 2.22 — Message Loop
- auto_ack=False, try/except, 错误发布到输出队列

## 修改文件
- `services/websearch-service/main.py` — 完全重写
