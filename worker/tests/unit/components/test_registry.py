"""Tests for ComponentRegistry.

Verifies:
- get(id) works for all catalog components
- find_by_alias resolves Chinese and English aliases
- find_by_capability returns correct matches
- resolve_name handles partial matches (legacy compat)
- V2 worker does NOT need to import legacy COMPONENT_* dicts
"""

import pytest

from mcu_worker.domain.components.registry import ComponentRegistry


@pytest.fixture(scope="module")
def registry() -> ComponentRegistry:
    return ComponentRegistry()


class TestRegistryLoading:
    def test_loads_all_components(self, registry: ComponentRegistry):
        assert registry.count >= 20

    def test_all_ids_accessible(self, registry: ComponentRegistry):
        for cid in registry.all_ids:
            comp = registry.get(cid)
            assert comp.id == cid


class TestGetById:
    def test_get_dht22(self, registry: ComponentRegistry):
        comp = registry.get("sensor.dht22")
        assert comp.display_name == "DHT22"
        assert "temperature_sensing" in comp.capabilities

    def test_get_nonexistent_raises(self, registry: ComponentRegistry):
        with pytest.raises(KeyError):
            registry.get("sensor.nonexistent")

    def test_get_or_none(self, registry: ComponentRegistry):
        assert registry.get_or_none("sensor.dht22") is not None
        assert registry.get_or_none("sensor.nonexistent") is None


class TestFindByAlias:
    def test_chinese_alias(self, registry: ComponentRegistry):
        comp = registry.find_by_alias("DHT22温湿度传感器")
        assert comp is not None
        assert comp.id == "sensor.dht22"

    def test_english_alias(self, registry: ComponentRegistry):
        comp = registry.find_by_alias("NeoPixel")
        assert comp is not None
        assert comp.id == "actuator.led_strip"

    def test_case_insensitive(self, registry: ComponentRegistry):
        comp = registry.find_by_alias("dht22")
        assert comp is not None
        assert comp.id == "sensor.dht22"

    def test_display_name_lookup(self, registry: ComponentRegistry):
        comp = registry.find_by_alias("HC-SR04")
        assert comp is not None
        assert comp.id == "sensor.hc_sr04"

    def test_unknown_alias_returns_none(self, registry: ComponentRegistry):
        assert registry.find_by_alias("totally_unknown_xyz") is None


class TestFindByCapability:
    def test_temperature_sensing(self, registry: ComponentRegistry):
        results = registry.find_by_capability("temperature_sensing")
        ids = [c.id for c in results]
        assert "sensor.dht22" in ids
        assert "sensor.dht11" in ids
        assert "sensor.bmp280" in ids

    def test_motor_control(self, registry: ComponentRegistry):
        results = registry.find_by_capability("motor_control")
        assert len(results) == 1
        assert results[0].id == "actuator.l298n"

    def test_platform_filter(self, registry: ComponentRegistry):
        results = registry.find_by_capability("temperature_sensing", platform_id="arduino_uno")
        assert len(results) >= 3

    def test_unknown_capability_empty(self, registry: ComponentRegistry):
        results = registry.find_by_capability("teleportation")
        assert results == []


class TestResolveName:
    def test_exact_id(self, registry: ComponentRegistry):
        comp = registry.resolve_name("sensor.dht22")
        assert comp is not None
        assert comp.id == "sensor.dht22"

    def test_partial_match_legacy(self, registry: ComponentRegistry):
        """Legacy names like 'DHT22温湿度传感器模块' should resolve."""
        comp = registry.resolve_name("DHT22温湿度传感器模块")
        assert comp is not None
        assert comp.id == "sensor.dht22"

    def test_unknown_returns_none(self, registry: ComponentRegistry):
        assert registry.resolve_name("quantum_flux_capacitor") is None


class TestFirmwareFacts:
    """Verify firmware facts are in registry, not legacy dicts."""

    def test_dht22_libraries(self, registry: ComponentRegistry):
        comp = registry.get("sensor.dht22")
        assert "DHT sensor library" in comp.firmware.libraries
        assert "DHT.h" in comp.firmware.includes

    def test_oled_libraries(self, registry: ComponentRegistry):
        comp = registry.get("display.oled_096")
        assert "Adafruit_SSD1306" in comp.firmware.libraries
        assert "Adafruit_GFX" in comp.firmware.libraries

    def test_generic_sensor_no_libraries(self, registry: ComponentRegistry):
        comp = registry.get("sensor.soil_moisture")
        assert comp.firmware.libraries == []
        assert comp.firmware.codegen_adapter == "generic_analog_sensor"

    def test_interface_facts(self, registry: ComponentRegistry):
        comp = registry.get("sensor.hc_sr04")
        assert comp.interfaces[0].type == "digital"
        assert comp.interfaces[0].signal_count == 2
