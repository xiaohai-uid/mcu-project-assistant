"""Tests for Platform registry and Arduino UNO definition."""

import pytest

from mcu_worker.domain.platforms.models import PlatformDefinition
from mcu_worker.domain.platforms.registry import PlatformRegistry


@pytest.fixture(scope="module")
def registry() -> PlatformRegistry:
    return PlatformRegistry()


@pytest.fixture(scope="module")
def uno(registry: PlatformRegistry) -> PlatformDefinition:
    return registry.get("arduino_uno")


class TestPlatformRegistry:
    def test_loads_arduino_uno(self, registry: PlatformRegistry):
        assert registry.count >= 1
        assert "arduino_uno" in registry.all_ids

    def test_get_nonexistent_raises(self, registry: PlatformRegistry):
        with pytest.raises(KeyError, match="esp32"):
            registry.get("esp32")

    def test_is_supported(self, registry: PlatformRegistry):
        assert registry.is_supported("arduino_uno") is True
        assert registry.is_supported("esp32") is False


class TestArduinoUnoDefinition:
    def test_basic_facts(self, uno: PlatformDefinition):
        assert uno.id == "arduino_uno"
        assert uno.family == "avr"
        assert uno.framework == "arduino"
        assert uno.logic_voltage == 5.0

    def test_pin_pools(self, uno: PlatformDefinition):
        assert len(uno.pins.digital) == 14  # D0-D13
        assert len(uno.pins.analog) == 6   # A0-A5
        assert len(uno.pins.pwm) == 6      # D3,D5,D6,D9,D10,D11

    def test_buses(self, uno: PlatformDefinition):
        assert "i2c" in uno.buses
        assert "spi" in uno.buses
        assert "uart" in uno.buses
        assert uno.buses["i2c"].pins["sda"] == "A4"
        assert uno.buses["i2c"].pins["scl"] == "A5"
        assert uno.buses["i2c"].shared is True

    def test_reserved_pins(self, uno: PlatformDefinition):
        reserved = uno.reserved_pin_set
        assert "D0" in reserved
        assert "D1" in reserved
        assert "A4" in reserved
        assert "A5" in reserved

    def test_available_digital_excludes_reserved(self, uno: PlatformDefinition):
        avail = uno.available_digital
        assert "D0" not in avail
        assert "D1" not in avail
        assert "D2" in avail
        assert "D13" in avail

    def test_available_analog_excludes_i2c(self, uno: PlatformDefinition):
        avail = uno.available_analog
        assert "A4" not in avail
        assert "A5" not in avail
        assert "A0" in avail
        assert "A3" in avail

    def test_available_pwm(self, uno: PlatformDefinition):
        avail = uno.available_pwm
        assert "D3" in avail
        assert "D9" in avail

    def test_toolchain(self, uno: PlatformDefinition):
        assert uno.toolchain.type == "arduino_cli"
        assert uno.toolchain.fqbn == "arduino:avr:uno"

    def test_power_limits(self, uno: PlatformDefinition):
        assert uno.power_limits.max_pin_current_ma == 40
        assert uno.power_limits.max_total_current_ma == 200

    def test_memory(self, uno: PlatformDefinition):
        assert uno.memory.flash_kb == 32
        assert uno.memory.sram_kb == 2

    def test_no_legacy_platform_pins_import(self, uno: PlatformDefinition):
        """V2 gets facts from PlatformDefinition, not PLATFORM_PINS dict."""
        assert uno.pins.digital is not None
        assert len(uno.pins.digital) > 0
