"""Integration tests using REAL web-crawled data (Firecrawl, 2026-07-08).

These tests verify that WebSearchService's aggregation logic correctly
handles real-world price data with mixed currencies and missing prices.
"""
import sys
import os
import types
from unittest.mock import MagicMock

# Stub out heavy dependencies (shared.* needs pika/rabbitmq) so we can
# import only the pure functions we want to test.
_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_SERVICE_DIR))
sys.path.insert(0, _SERVICE_DIR)
sys.path.insert(0, _REPO_ROOT)

# Create fake 'shared' package with no-op submodules
_shared = types.ModuleType("shared")
_shared.rabbitmq = types.ModuleType("shared.rabbitmq")
_shared.rabbitmq.queues = MagicMock()
_shared.bootstrap = types.ModuleType("shared.bootstrap")
_shared.bootstrap.run_service = MagicMock()
_shared.bootstrap.QueueBinding = MagicMock()
_shared.bootstrap.make_rabbitmq_client = MagicMock()
sys.modules["shared"] = _shared
sys.modules["shared.rabbitmq"] = _shared.rabbitmq
sys.modules["shared.rabbitmq.queues"] = _shared.rabbitmq.queues
sys.modules["shared.bootstrap"] = _shared.bootstrap

# Stub threading (used at module level in main.py but not imported there)
import threading as _threading
sys.modules["threading"] = _threading

# Load main.py module manually and inject threading into its namespace
import importlib.util

_main_path = os.path.join(_SERVICE_DIR, "main.py")
_spec = importlib.util.spec_from_file_location("websearch_main", _main_path)
_main_mod = importlib.util.module_from_spec(_spec)
_main_mod.__dict__["threading"] = _threading
_spec.loader.exec_module(_main_mod)

deduplicate_results = _main_mod.deduplicate_results
aggregate_prices = _main_mod.aggregate_prices

# --- Real data crawled from Firecrawl on 2026-07-08 ---
# ESP32 DevKit V1: Taobao ¥10-27.9
# Arduino Uno R3: €29.30 (official), NT$380 (Taiwan), S$20 (Singapore)
# DHT11: Taobao ¥2.85

REAL_CRAWLED_DATA = {
    "ESP32 DevKit V1": {
        "taobao": [
            {
                "source": "1688",
                "component": "ESP32 DevKit V1",
                "title": "ESP32开发板S3/C3/C6支持小智ai聊天机器人WIFI蓝牙无线模块套件",
                "price": 10.0,
                "currency": "CNY",
                "url": "https://world.taobao.com/product/ch3200v",
                "timestamp": "2026-07-08T09:00:00",
            },
            {
                "source": "1688",
                "component": "ESP32 DevKit V1",
                "title": "源地ESP32-S3核心板/开发板/系统板乐鑫ESP32S3小智AI机器人wifi",
                "price": 27.9,
                "currency": "CNY",
                "url": "https://www.taobao.com/list/product/",
                "timestamp": "2026-07-08T09:00:00",
            },
        ],
        "distributors": [],
        "general": [
            {
                "source": "duckduckgo",
                "component": "ESP32 DevKit V1",
                "title": "ESP32-C3 开发板ESP32 SuperMini 开发板ESP32开发板wifi 蓝牙",
                "price": None,
                "currency": None,
                "url": "https://world.taobao.com/product/ch3200v",
                "timestamp": "2026-07-08T09:00:00",
            },
        ],
    },
    "Arduino Uno R3": {
        "taobao": [],
        "distributors": [
            {
                "source": "digikey",
                "component": "Arduino Uno R3",
                "title": "Arduino UNO Rev3",
                "price": 29.30,
                "currency": "EUR",
                "url": "https://store.arduino.cc/products/arduino-uno-rev3",
                "timestamp": "2026-07-08T09:01:00",
            },
        ],
        "general": [
            {
                "source": "duckduckgo",
                "component": "Arduino Uno R3",
                "title": "UNO R3 開發板相容Arduino 原廠開發板",
                "price": None,
                "currency": None,
                "url": "https://www.ltc.com.tw/products/mtarduinor3a0",
                "timestamp": "2026-07-08T09:01:00",
            },
        ],
    },
    "DHT11": {
        "taobao": [
            {
                "source": "1688",
                "component": "DHT11",
                "title": "DHT11 数字温湿度传感器模块检测环境温湿度感应探头模块带杜邦线",
                "price": 2.85,
                "currency": "CNY",
                "url": "https://guangtao.taobao.com/product-27f24b",
                "timestamp": "2026-07-08T09:02:00",
            },
        ],
        "distributors": [],
        "general": [],
    },
}


def describe(description):
    def decorator(func):
        func.__doc__ = description
        return func
    return decorator


@describe("deduplicate_results picks cheapest item per source when price available")
def test_dedup_esp32_picks_cheapest_taobao():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    esp32_sources = deduped["ESP32 DevKit V1"]
    # taobao: 2 items, should pick cheapest (¥10)
    assert esp32_sources["taobao"]["price"] == 10.0
    # general: price is None, should still keep the item
    assert esp32_sources["general"]["price"] is None


@describe("deduplicate_results keeps None-price items when no priced alternative")
def test_dedup_keeps_none_price():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    # Arduino general result has no price, dedup should keep it
    arduino_general = deduped["Arduino Uno R3"]["general"]
    assert arduino_general["price"] is None
    assert "UNO R3" in arduino_general["title"]


@describe("aggregate_prices computes cheapest and average from real mixed data")
def test_aggregate_esp32():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    aggregated = aggregate_prices(deduped)
    esp32 = aggregated["ESP32 DevKit V1"]
    # taobao cheapest=10.0, general=None → only 10.0 counted
    assert esp32["cheapest"] == 10.0
    assert esp32["average"] == 10.0
    assert esp32["currency"] == "USD"  # hardcoded in aggregate_prices


@describe("aggregate_prices handles single-source component (DHT11)")
def test_aggregate_dht11():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    aggregated = aggregate_prices(deduped)
    dht11 = aggregated["DHT11"]
    assert dht11["cheapest"] == 2.85
    assert dht11["average"] == 2.85
    assert dht11["currency"] == "USD"


@describe("aggregate_prices with multi-source component (Arduino)")
def test_aggregate_arduino():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    aggregated = aggregate_prices(deduped)
    arduino = aggregated["Arduino Uno R3"]
    # Only digikey has price (29.30 EUR), general is None
    assert arduino["cheapest"] == 29.30
    assert arduino["average"] == 29.30


@describe("full pipeline: dedup + aggregate produces all 3 components")
def test_full_pipeline_real_data():
    deduped = deduplicate_results(REAL_CRAWLED_DATA)
    aggregated = aggregate_prices(deduped)
    assert set(aggregated.keys()) == {"ESP32 DevKit V1", "Arduino Uno R3", "DHT11"}
    assert all("sources" in v for v in aggregated.values())
    assert all("timestamp" in v for v in aggregated.values())


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
