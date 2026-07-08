# Tasks 2.16–2.22 — WebSearchService

## Acceptance Criteria

### 2.16 — 1688/淘宝 Crawler
- `search_taobao(component)`: scrapes search results, extracts price/title/url
- Returns list of `{ source, component, title, price, currency, url, timestamp }`

### 2.17 — General Search Engine
- `search_general(component)`: uses DuckDuckGo Lite API (POST to html.duckduckgo.com/html)
- Parse response HTML with BeautifulSoup for result links + snippets
- Returns same format

### 2.18 — Professional Distributor
- `search_distributor(component)`: fetches LCSC search, extracts price from HTML
- Stub Mouser/DigiKey with pattern comment

### 2.19 — Price Comparison & Freshness
- `deduplicate_results(results)`: group by component name, keep cheapest per source
- `aggregate_prices(all_results)`: add `cheapest`, `average`, `timestamp`, `freshness` fields

### 2.20 — Anti-Blocking Strategy
- User-Agent rotation pool (6+ modern browser UAs)
- Rate limiter: `RateLimiter` class with per-source min interval
- Jittered delays between requests

### 2.21 — Error Handling
- `retry_with_backoff(func, max_retries=3)`: exponential backoff (1s, 2s, 4s)
- Per-source timeout (10s each)
- Failures logged but don't crash the consumer

### 2.22 — Message Loop
- Manual ack, try/except with traceback
- Error message published to WEBSERACH_OUTPUT if needed

## Implementation files
- **Modify:** `services/websearch-service/main.py` — full rewrite

Working directory: `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant`

## Implementation Details

Use `beautifulsoup4` (already in requirements.txt) for HTML parsing.
Use `time.sleep` for rate limiting (no external dep needed).
No external proxy rotation library — just stub a `_get_proxy()` function that returns None.

### DuckDuckGo HTML parsing pattern:
```python
def search_general(component: str) -> list:
    url = "https://html.duckduckgo.com/html/"
    data = {"q": f"{component} price buy"}
    resp = httpx.post(url, data=data, headers=ua_pool[0], timeout=10)
    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    for result in soup.select(".result"):
        title_el = result.select_one(".result__title a")
        snippet_el = result.select_one(".result__snippet")
        if title_el:
            results.append({
                "source": "duckduckgo",
                "component": component,
                "title": title_el.get_text(strip=True),
                "url": title_el.get("href", ""),
                "price": None,
                "currency": None,
                "timestamp": datetime.utcnow().isoformat(),
            })
    return results
```

### LCSC HTML parsing pattern:
```python
def search_distributor(component: str) -> list:
    url = f"https://www.lcsc.com/search?q={component}"
    resp = httpx.get(url, headers=ua_pool[1], timeout=10)
    soup = BeautifulSoup(resp.text, "html.parser")
    # LCSC product cards — attempt to find prices
    results = []
    for item in soup.select(".product-item"):
        title_el = item.select_one(".product-name a")
        price_el = item.select_one(".price")
        if title_el:
            results.append({...})
    return results
```

### User-Agent pool:
```python
UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:119.0) Gecko/20100101 Firefox/119.0",
]
```

### Rate limiter:
```python
class RateLimiter:
    def __init__(self):
        self._last_call: dict[str, float] = {}
        self._min_interval = 2.0  # seconds between calls per source
    
    def wait(self, source: str):
        now = time.time()
        last = self._last_call.get(source, 0)
        elapsed = now - last
        if elapsed < self._min_interval:
            jitter = random.uniform(0.1, 0.5)
            time.sleep(self._min_interval - elapsed + jitter)
        self._last_call[source] = time.time()
```

## Validate
```powershell
cd C:\Users\Administrator\Desktop\opencode\mcu-project-assistant
python -c "import ast; ast.parse(open('services/websearch-service/main.py', encoding='utf-8').read()); print('OK')"
```

Return file created/modified and syntax validation.