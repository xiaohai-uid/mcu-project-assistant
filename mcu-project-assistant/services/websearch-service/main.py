import os
import json
import time
import random
import traceback
import threading
from datetime import datetime
from typing import Any, Callable

import httpx
from bs4 import BeautifulSoup

from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client

client = make_rabbitmq_client()

FALLBACK_PRICES = {
    "Arduino Uno R3": {"price": 18.00, "currency": "USD", "source": "database"},
    "Arduino Nano": {"price": 12.00, "currency": "USD", "source": "database"},
    "ESP32 DevKit V1": {"price": 8.00, "currency": "USD", "source": "database"},
    "STM32F103C8T6": {"price": 5.00, "currency": "USD", "source": "database"},
    "Raspberry Pi Pico": {"price": 4.00, "currency": "USD", "source": "database"},
    "DHT11": {"price": 2.00, "currency": "USD", "source": "database"},
    "DHT22": {"price": 4.00, "currency": "USD", "source": "database"},
    "HC-SR04": {"price": 1.50, "currency": "USD", "source": "database"},
    "BMP280": {"price": 3.00, "currency": "USD", "source": "database"},
    "MQ-135": {"price": 2.50, "currency": "USD", "source": "database"},
    "光敏电阻模块": {"price": 1.00, "currency": "USD", "source": "database"},
    "土壤湿度传感器": {"price": 1.50, "currency": "USD", "source": "database"},
    "声音传感器": {"price": 1.00, "currency": "USD", "source": "database"},
    "红外循迹传感器": {"price": 1.00, "currency": "USD", "source": "database"},
    "水位传感器": {"price": 1.50, "currency": "USD", "source": "database"},
    "SG90 舵机": {"price": 2.50, "currency": "USD", "source": "database"},
    "L298N 电机驱动": {"price": 3.00, "currency": "USD", "source": "database"},
    "继电器模块": {"price": 2.00, "currency": "USD", "source": "database"},
    "小型水泵": {"price": 4.00, "currency": "USD", "source": "database"},
    "LED 灯带": {"price": 3.00, "currency": "USD", "source": "database"},
    "蜂鸣器": {"price": 0.50, "currency": "USD", "source": "database"},
    "电磁锁": {"price": 8.00, "currency": "USD", "source": "database"},
    "LCD1602": {"price": 2.50, "currency": "USD", "source": "database"},
    "OLED 0.96寸": {"price": 3.50, "currency": "USD", "source": "database"},
    "LED 数码管": {"price": 1.50, "currency": "USD", "source": "database"},
    "HC-05 蓝牙模块": {"price": 3.00, "currency": "USD", "source": "database"},
    "RC522 RFID": {"price": 2.00, "currency": "USD", "source": "database"},
    "矩阵键盘 4x4": {"price": 1.50, "currency": "USD", "source": "database"},
    "5V 电源模块": {"price": 3.00, "currency": "USD", "source": "database"},
    "电池组 18650": {"price": 5.00, "currency": "USD", "source": "database"},
    "面包板": {"price": 2.00, "currency": "USD", "source": "database"},
    "杜邦线套装": {"price": 1.50, "currency": "USD", "source": "database"},
}

UA_POOL = [
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"
    },
    {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36"
    },
    {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0"
    },
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    },
    {
        "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:119.0) Gecko/20100101 Firefox/119.0"
    },
]


class CircuitBreaker:
    """Tracks consecutive failures per source and opens the circuit after a threshold.

    States:
        CLOSED: normal operation, requests allowed
        OPEN: failures exceeded threshold, requests blocked for cooldown period
        HALF_OPEN: cooldown expired, one test request allowed
    """

    def __init__(self, threshold: int = 3, cooldown: float = 60.0):
        self._threshold = threshold
        self._cooldown = cooldown
        self._failures: dict[str, int] = {}
        self._state: dict[str, str] = {}
        self._open_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def _log(self, source: str, message: str):
        print(f"[circuit-breaker] source={source} {message}")

    def record_success(self, source: str):
        with self._lock:
            self._failures[source] = 0
            if self._state.get(source) == "half_open":
                self._state[source] = "closed"
                self._log(source, "half_open -> closed (test passed)")

    def record_failure(self, source: str):
        with self._lock:
            self._failures[source] = self._failures.get(source, 0) + 1
            if self._failures[source] >= self._threshold:
                prev = self._state.get(source, "closed")
                self._state[source] = "open"
                self._open_until[source] = time.time() + self._cooldown
                self._log(source, f"{prev} -> open (failures={self._failures[source]}, cooldown={self._cooldown}s)")

    def allow_request(self, source: str) -> bool:
        with self._lock:
            state = self._state.get(source, "closed")
            if state == "closed":
                return True
            if state == "open":
                if time.time() >= self._open_until.get(source, 0):
                    self._state[source] = "half_open"
                    self._log(source, "open -> half_open (cooldown expired)")
                    return True
                return False
            return True


class TimeoutConfig:
    """Per-source timeout configuration.

    Provides default timeouts for each search source, overridable via constructor.
    """

    DEFAULTS = {
        "taobao": 10.0,
        "duckduckgo": 10.0,
        "digikey": 15.0,
        "mouser": 15.0,
        "lcsc": 10.0,
    }

    def __init__(self, overrides: dict[str, float] | None = None):
        self._timeouts = dict(self.DEFAULTS)
        if overrides:
            self._timeouts.update(overrides)

    def get(self, source: str) -> float:
        return self._timeouts.get(source, 10.0)


_circuit_breaker = CircuitBreaker()
_timeout_config = TimeoutConfig()


class RetryableError(Exception):
    """Error that should be retried (timeout, 5xx, network error)."""


class NonRetryableError(Exception):
    """Error that should NOT be retried (4xx, parse failure, circuit open)."""


def _classify_error(e: Exception) -> Exception:
    if isinstance(e, (RetryableError, NonRetryableError)):
        return e
    if isinstance(e, httpx.TimeoutException):
        return RetryableError(f"timeout: {e}")
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        if 400 <= code < 500:
            return NonRetryableError(f"HTTP {code}: {e}")
        if code >= 500:
            return RetryableError(f"HTTP {code}: {e}")
    if isinstance(e, httpx.RequestError):
        return RetryableError(f"request error: {e}")
    return NonRetryableError(f"unexpected error: {e}")


def _log_error(source: str, component: str, error: Exception, status_code: str = ""):
    error_type = type(error).__name__
    if isinstance(error, (RetryableError, NonRetryableError)):
        print(f"[websearch] source={source} component={component} error={error}")
    else:
        print(f"[websearch] source={source} component={component} error_type={error_type}{status_code}")
        traceback.print_exc()


def retry_with_backoff(func: Callable, source: str, component: str, max_retries: int = 3):
    """Execute func with retry, jittered backoff, and error classification.

    Args:
        func: The callable to execute
        source: Source identifier for circuit breaker and logging
        component: Component name for logging
        max_retries: Maximum retry attempts (2 for distributor, 3 for general)
    """
    if not _circuit_breaker.allow_request(source):
        raise NonRetryableError(f"circuit breaker open for source '{source}'")

    for attempt in range(max_retries):
        try:
            result = func()
            _circuit_breaker.record_success(source)
            return result
        except Exception as e:
            classified = _classify_error(e)
            _circuit_breaker.record_failure(source)

            status = ""
            if isinstance(e, httpx.HTTPStatusError):
                status = f" status={e.response.status_code}"
            _log_error(source, component, classified, status)

            if isinstance(classified, NonRetryableError):
                raise

            if attempt < max_retries - 1:
                delay = (2 ** attempt) + random.uniform(0, 0.5)
                print(f"[websearch] source={source} component={component} "
                      f"attempt={attempt + 1}/{max_retries} retry in {delay:.2f}s")
                time.sleep(delay)
            else:
                raise


class RateLimiter:
    def __init__(self):
        self._last_call: dict[str, float] = {}
        self._min_interval = 2.0

    def wait(self, source: str):
        now = time.time()
        last = self._last_call.get(source, 0)
        elapsed = now - last
        if elapsed < self._min_interval:
            jitter = random.uniform(0.1, 0.5)
            time.sleep(self._min_interval - elapsed + jitter)
        self._last_call[source] = time.time()


_rate_limiter = RateLimiter()


def _get_proxy() -> str | None:
    return None


def _parse_price(text: str | None) -> tuple[float | None, str | None]:
    if not text:
        return None, None
    text = text.strip().replace(",", "")
    if text.startswith("¥"):
        try:
            return float(text[1:].strip()), "CNY"
        except ValueError:
            return None, None
    if text.startswith("$"):
        try:
            return float(text[1:].strip()), "USD"
        except ValueError:
            return None, None
    if text.startswith("€"):
        try:
            return float(text[1:].strip()), "EUR"
        except ValueError:
            return None, None
    return None, None


def search_taobao(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch():
        nonlocal results
        url = f"https://s.1688.com/selloffer/offer_search.htm?keywords={component}"
        headers = UA_POOL[2].copy()
        headers["Accept-Language"] = "zh-CN,zh;q=0.9"
        resp = httpx.get(url, headers=headers, timeout=_timeout_config.get("taobao"))
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select(".offer-list-row .offer-item"):
            title_el = item.select_one(".offer-title")
            price_el = item.select_one(".price")
            link_el = item.select_one("a[href]")
            if title_el:
                price, currency = _parse_price(price_el.get_text(strip=True) if price_el else None)
                results.append({
                    "source": "1688",
                    "component": component,
                    "title": title_el.get_text(strip=True),
                    "price": price,
                    "currency": currency,
                    "url": f"https:{link_el.get('href', '')}" if link_el else "",
                    "timestamp": timestamp,
                })

    try:
        _rate_limiter.wait("taobao")
        retry_with_backoff(_fetch, source="taobao", component=component, max_retries=3)
    except Exception:
        print(f"[websearch] source=taobao component={component} all retries exhausted")

    return results


def search_general(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch():
        nonlocal results
        url = "https://html.duckduckgo.com/html/"
        data = {"q": f"{component} price buy"}
        resp = httpx.post(url, data=data, headers=UA_POOL[0], timeout=_timeout_config.get("duckduckgo"))
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for result in soup.select(".result"):
            title_el = result.select_one(".result__title a")
            snippet_el = result.select_one(".result__snippet")
            if title_el:
                results.append({
                    "source": "duckduckgo",
                    "component": component,
                    "title": title_el.get_text(strip=True),
                    "price": None,
                    "currency": None,
                    "url": title_el.get("href", ""),
                    "timestamp": timestamp,
                })

    try:
        _rate_limiter.wait("duckduckgo")
        retry_with_backoff(_fetch, source="duckduckgo", component=component, max_retries=3)
    except Exception:
        print(f"[websearch] source=duckduckgo component={component} all retries exhausted")

    return results


def _search_digikey(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch():
        nonlocal results
        url = f"https://www.digikey.com/en/products/result?keywords={component}"
        resp = httpx.get(url, headers=UA_POOL[0], timeout=_timeout_config.get("digikey"), follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("[data-testid='product-card'], .product-item, tr[data-product-id]"):
            title_el = item.select_one(".product-title a, .product-name a, a[href*='/products/']")
            price_el = item.select_one(".price, .product-price, [data-testid='price']")
            link_el = title_el or item.select_one("a[href*='/products/']")
            if title_el:
                price, currency = _parse_price(price_el.get_text(strip=True) if price_el else None)
                href = link_el.get("href", "") if link_el else ""
                results.append({
                    "source": "digikey",
                    "component": component,
                    "title": title_el.get_text(strip=True),
                    "price": price,
                    "currency": currency or "USD",
                    "url": f"https://www.digikey.com{href}" if href.startswith("/") else href,
                    "timestamp": timestamp,
                })
        if not results:
            for row in soup.select("table tr"):
                cells = row.select("td")
                if len(cells) >= 3:
                    title_el = cells[0]
                    price_el = cells[1] if len(cells) > 1 else None
                    results.append({
                        "source": "digikey",
                        "component": component,
                        "title": title_el.get_text(strip=True)[:100],
                        "price": _parse_price(price_el.get_text(strip=True) if price_el else None)[0],
                        "currency": "USD",
                        "url": "",
                        "timestamp": timestamp,
                    })

    try:
        _rate_limiter.wait("digikey")
        retry_with_backoff(_fetch, source="digikey", component=component, max_retries=2)
    except Exception:
        print(f"[websearch] source=digikey component={component} all retries exhausted")

    return results


def _search_mouser(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch():
        nonlocal results
        url = f"https://www.mouser.com/search/?q={component}"
        resp = httpx.get(url, headers=UA_POOL[1], timeout=_timeout_config.get("mouser"), follow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("[data-product-id], .product-item, .mouser-product-card, .result-item"):
            title_el = item.select_one(".product-name a, .product-title a, a[href*='/ProductDetail/']")
            price_el = item.select_one(".price, .product-price, .unit-price")
            link_el = title_el or item.select_one("a[href*='/ProductDetail/']")
            if title_el:
                price, currency = _parse_price(price_el.get_text(strip=True) if price_el else None)
                href = link_el.get("href", "") if link_el else ""
                results.append({
                    "source": "mouser",
                    "component": component,
                    "title": title_el.get_text(strip=True),
                    "price": price,
                    "currency": currency or "USD",
                    "url": f"https://www.mouser.com{href}" if href.startswith("/") else href,
                    "timestamp": timestamp,
                })

    try:
        _rate_limiter.wait("mouser")
        retry_with_backoff(_fetch, source="mouser", component=component, max_retries=2)
    except Exception:
        print(f"[websearch] source=mouser component={component} all retries exhausted")

    return results


def search_distributor(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch_lcsc():
        nonlocal results
        url = f"https://www.lcsc.com/search?q={component}"
        resp = httpx.get(url, headers=UA_POOL[1], timeout=_timeout_config.get("lcsc"))
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select(".product-item"):
            title_el = item.select_one(".product-name a")
            price_el = item.select_one(".price")
            if title_el:
                price, currency = _parse_price(price_el.get_text(strip=True) if price_el else None)
                results.append({
                    "source": "lcsc",
                    "component": component,
                    "title": title_el.get_text(strip=True),
                    "price": price,
                    "currency": currency or "USD",
                    "url": f"https://www.lcsc.com{title_el.get('href', '')}" if title_el.get("href") else "",
                    "timestamp": timestamp,
                })

    try:
        _rate_limiter.wait("lcsc")
        retry_with_backoff(_fetch_lcsc, source="lcsc", component=component, max_retries=3)
    except Exception:
        print(f"[websearch] source=lcsc component={component} all retries exhausted")

    results.extend(_search_digikey(component))
    results.extend(_search_mouser(component))

    return results


def _fuzzy_match_component(component: str) -> str | None:
    comp_lower = component.lower().strip()
    for name in FALLBACK_PRICES:
        if name.lower().strip() == comp_lower:
            return name
    for name in FALLBACK_PRICES:
        if name.lower() in comp_lower or comp_lower in name.lower():
            return name
    return None


def build_fallback_prices(components: list[str]) -> dict:
    result = {}
    timestamp = datetime.utcnow().isoformat()
    for comp in components:
        matched = _fuzzy_match_component(comp)
        if matched:
            entry = FALLBACK_PRICES[matched]
            result[comp] = {
                "sources": {
                    "database": {
                        "source": "database",
                        "component": comp,
                        "title": matched,
                        "price": entry["price"],
                        "currency": entry["currency"],
                        "url": "",
                        "timestamp": timestamp,
                    }
                },
                "cheapest": entry["price"],
                "average": entry["price"],
                "currency": entry["currency"],
                "timestamp": timestamp,
            }
        else:
            result[comp] = {
                "sources": {},
                "cheapest": None,
                "average": None,
                "currency": None,
                "timestamp": timestamp,
            }
    return result


def deduplicate_results(all_results: dict[str, list]) -> dict:
    deduped = {}
    for comp, sources in all_results.items():
        deduped[comp] = {}
        seen = set()
        for source_key, items in sources.items():
            cheapest = None
            for item in items:
                dedup_key = (item["source"], item.get("title", ""))
                if dedup_key in seen:
                    continue
                seen.add(dedup_key)
                if cheapest is None or (item.get("price") is not None and cheapest.get("price") is None):
                    cheapest = item
                elif item.get("price") is not None and cheapest.get("price") is not None:
                    if item["price"] < cheapest["price"]:
                        cheapest = item
            if cheapest:
                deduped[comp][source_key] = cheapest
    return deduped


def aggregate_prices(deduped: dict) -> dict:
    result = {}
    timestamp = datetime.utcnow().isoformat()
    for comp, sources in deduped.items():
        prices = []
        entry = {"sources": sources, "timestamp": timestamp}
        for item in sources.values():
            if item.get("price") is not None:
                prices.append(item["price"])
        if prices:
            entry["cheapest"] = min(prices)
            entry["average"] = round(sum(prices) / len(prices), 2)
            entry["currency"] = "USD"
        else:
            entry["cheapest"] = None
            entry["average"] = None
            entry["currency"] = None
        result[comp] = entry
    return result


def handle_websearch(ch, method, _properties, body):
    message = json.loads(body)
    components = message.get("components", [])
    design_draft_id = message.get("designDraftId")

    all_results = {}
    any_web_results = False
    total_source_calls = 0
    failed_source_calls = 0

    for comp in components:
        print(f"[websearch] Searching for component: {comp}")
        taobao_results = search_taobao(comp)
        dist_results = search_distributor(comp)
        general_results = search_general(comp)

        source_counts = [
            ("taobao", len(taobao_results)),
            ("distributors", len(dist_results)),
            ("general", len(general_results)),
        ]
        for source_key, count in source_counts:
            total_source_calls += 1
            if count == 0:
                failed_source_calls += 1

        all_results[comp] = {
            "taobao": taobao_results,
            "distributors": dist_results,
            "general": general_results,
        }
        if taobao_results or dist_results or general_results:
            any_web_results = True
        else:
            print(f"[websearch] WARNING: All web sources failed for '{comp}', will use database fallback")

    succeeded = total_source_calls - failed_source_calls
    print(f"[websearch] Summary: {succeeded}/{total_source_calls} source calls succeeded, {failed_source_calls} failed")

    deduped = deduplicate_results(all_results)
    aggregated = aggregate_prices(deduped)

    error_message = None
    if not any_web_results:
        print("[websearch] All web sources failed, falling back to database prices")
        aggregated = build_fallback_prices(components)
        error_message = "All web search sources failed, used database fallback"
    else:
        fallback = build_fallback_prices(components)
        for comp in components:
            if comp not in aggregated or not aggregated[comp].get("sources"):
                if comp in fallback and fallback[comp].get("sources"):
                    aggregated[comp] = fallback[comp]
                    print(f"[websearch] Using database fallback for '{comp}'")

    try:
        output = {
            "designDraftId": design_draft_id,
            "prices": aggregated,
        }
        if error_message:
            output["error"] = error_message
        client.publish(q.WEBSERACH_OUTPUT, output)
    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.WEBSERACH_OUTPUT, {
                "designDraftId": design_draft_id,
                "error": error_message or "WebSearch processing failed",
                "prices": {},
            })
        except Exception:
            pass
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    run_service(
        name="websearch",
        port=8003,
        declare_queues=[q.WEBSERACH_OUTPUT],
        bindings=[
            QueueBinding(queue=q.WEBSERACH_INPUT, callback=handle_websearch),
        ],
        client=client,
    )


if __name__ == "__main__":
    main()
