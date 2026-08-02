"""Tests for Constraint Engine and Pin Allocator."""

import pytest

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.constraints.engine import ConstraintEngine
from mcu_worker.domain.platforms.registry import PlatformRegistry


@pytest.fixture(scope="module")
def comp_registry() -> ComponentRegistry:
    return ComponentRegistry()


@pytest.fixture(scope="module")
def platform_registry() -> PlatformRegistry:
    return PlatformRegistry()


@pytest.fixture(scope="module")
def uno(platform_registry: PlatformRegistry):
    return platform_registry.get("arduino_uno")


class TestVoltageCompatibility:
    def test_5v_components_pass(self, uno, comp_registry):
        components = [
            ("temp_1", comp_registry.get("sensor.dht22")),
            ("display_1", comp_registry.get("display.lcd1602")),
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert result.is_feasible

    def test_3v3_bus_device_gets_warning_not_error(self, uno, comp_registry):
        """BMP280 (I2C-only) max supply 3.6V < 5V -> WARNING (use 3V3 pin), still feasible."""
        components = [
            ("pressure_1", comp_registry.get("sensor.bmp280")),
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        # Bus-only device: voltage mismatch is WARNING, not ERROR
        assert result.is_feasible
        voltage_warnings = [d for d in result.warnings if d.code == "VOLTAGE_INCOMPATIBLE"]
        assert len(voltage_warnings) == 1
        assert "3V3 pin" in voltage_warnings[0].message


class TestPinBudget:
    def test_within_budget(self, uno, comp_registry):
        components = [
            ("soil_1", comp_registry.get("sensor.soil_moisture")),
            ("light_1", comp_registry.get("sensor.photoresistor")),
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert result.is_feasible
        assert result.pin_allocation is not None

    def test_analog_overflow(self, uno, comp_registry):
        """7 analog sensors exceed 4 available analog pins (A0-A3, A4/A5 reserved)."""
        components = [
            (f"sensor_{i}", comp_registry.get("sensor.soil_moisture"))
            for i in range(7)
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert not result.is_feasible
        assert any(d.code == "ANALOG_PIN_OVERFLOW" for d in result.errors)

    def test_pwm_shortage(self, uno, comp_registry):
        """7 PWM devices exceed 6 available PWM pins."""
        components = [
            (f"servo_{i}", comp_registry.get("actuator.sg90"))
            for i in range(7)
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert not result.is_feasible
        assert any(d.code == "PWM_PIN_SHORTAGE" for d in result.errors)


class TestBusConflicts:
    def test_i2c_shared_ok(self, uno, comp_registry):
        """Multiple I2C devices share the bus without conflict."""
        components = [
            ("lcd_1", comp_registry.get("display.lcd1602")),
            ("oled_1", comp_registry.get("display.oled_096")),
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert result.is_feasible
        assert result.pin_allocation is not None
        # Should have one shared I2C bus with both participants
        i2c_buses = [b for b in result.pin_allocation.shared_buses if b.type == "i2c"]
        assert len(i2c_buses) == 1
        assert len(i2c_buses[0].participants) == 2

    def test_uart_conflict(self, uno, comp_registry):
        """Two UART devices conflict on UNO (single hardware UART)."""
        components = [
            ("bt_1", comp_registry.get("comm.hc_05")),
            ("bt_2", comp_registry.get("comm.hc_05")),
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert not result.is_feasible
        assert any(d.code == "UART_CONFLICT" for d in result.errors)


class TestPinAllocation:
    def test_deterministic(self, uno, comp_registry):
        """Same input produces same allocation."""
        components = [
            ("temp_1", comp_registry.get("sensor.dht22")),
            ("soil_1", comp_registry.get("sensor.soil_moisture")),
            ("servo_1", comp_registry.get("actuator.sg90")),
        ]
        engine1 = ConstraintEngine(uno, components)
        engine2 = ConstraintEngine(uno, components)
        r1 = engine1.validate()
        r2 = engine2.validate()
        assert r1.pin_allocation == r2.pin_allocation

    def test_analog_gets_a_pins(self, uno, comp_registry):
        components = [("soil_1", comp_registry.get("sensor.soil_moisture"))]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        alloc = result.pin_allocation
        analog_assignments = [a for a in alloc.assignments if a.interface == "analog"]
        assert analog_assignments[0].physical_pin.startswith("A")

    def test_pwm_gets_pwm_pins(self, uno, comp_registry):
        components = [("servo_1", comp_registry.get("actuator.sg90"))]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        alloc = result.pin_allocation
        pwm_assignments = [a for a in alloc.assignments if a.interface == "pwm"]
        valid_pwm = {"D3", "D5", "D6", "D9", "D10", "D11"}
        assert pwm_assignments[0].physical_pin in valid_pwm

    def test_infeasible_design_no_allocation(self, uno, comp_registry):
        """When constraints fail, no pin allocation is produced."""
        components = [
            (f"sensor_{i}", comp_registry.get("sensor.soil_moisture"))
            for i in range(7)
        ]
        engine = ConstraintEngine(uno, components)
        result = engine.validate()
        assert result.pin_allocation is None
