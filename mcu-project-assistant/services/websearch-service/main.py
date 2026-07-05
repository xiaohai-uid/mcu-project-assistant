import os
import json
import time
import random
import traceback
from datetime import datetime

import httpx
from bs4 import BeautifulSoup

from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))

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


def retry_with_backoff(func, max_retries=3):
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            print(f"[websearch] Attempt {attempt + 1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise


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
        resp = httpx.get(url, headers=headers, timeout=10)
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
        retry_with_backoff(_fetch, max_retries=3)
    except Exception as e:
        print(f"[websearch] search_taobao failed for {component}: {e}")

    return results


def search_general(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    def _fetch():
        nonlocal results
        url = "https://html.duckduckgo.com/html/"
        data = {"q": f"{component} price buy"}
        resp = httpx.post(url, data=data, headers=UA_POOL[0], timeout=10)
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
        retry_with_backoff(_fetch, max_retries=3)
    except Exception as e:
        print(f"[websearch] search_general failed for {component}: {e}")

    return results


def search_distributor(component: str) -> list[dict]:
    results = []
    timestamp = datetime.utcnow().isoformat()

    # --- LCSC ---
    def _fetch_lcsc():
        nonlocal results
        url = f"https://www.lcsc.com/search?q={component}"
        resp = httpx.get(url, headers=UA_POOL[1], timeout=10)
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
        retry_with_backoff(_fetch_lcsc, max_retries=3)
    except Exception as e:
        print(f"[websearch] search_distributor (lcsc) failed for {component}: {e}")

    # --- Mouser / DigiKey stub ---
    # TODO: Implement Mouser search
    #   url = f"https://www.mouser.com/search/?q={component}"
    #   Parse product listing, extract price/title/url
    #
    # TODO: Implement DigiKey search
    #   url = f"https://www.digikey.com/en/products/result?keywords={component}"
    #   Parse product listing, extract price/title/url

    return results


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
    for comp in components:
        print(f"[websearch] Searching for component: {comp}")
        all_results[comp] = {
            "taobao": search_taobao(comp),
            "distributors": search_distributor(comp),
            "general": search_general(comp),
        }

    deduped = deduplicate_results(all_results)
    aggregated = aggregate_prices(deduped)

    try:
        client.publish(queues.WEBSERACH_OUTPUT, {
            "designDraftId": design_draft_id,
            "prices": aggregated,
        })
    except Exception:
        traceback.print_exc()
        try:
            client.publish(queues.WEBSERACH_OUTPUT, {
                "designDraftId": design_draft_id,
                "error": "WebSearch processing failed",
                "prices": {},
            })
        except Exception:
            pass
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.WEBSERACH_INPUT)
    client.declare_queue(queues.WEBSERACH_OUTPUT)
    client.channel.basic_consume(
        queue=queues.WEBSERACH_INPUT,
        on_message_callback=handle_websearch,
        auto_ack=False,
    )
    print("WebSearchService started. Waiting for messages...")
    client.channel.start_consuming()


if __name__ == "__main__":
    main()
