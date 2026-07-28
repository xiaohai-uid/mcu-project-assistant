import pytest
from shared.domain.pins import (
    PLATFORM_PINS,
    PIN_TYPE_MAP,
    COMPONENT_LIBRARIES,
    assign_pins,
    resolve_dependencies,
)


class TestPlatformPins:
    def test_has_arduino(self):
        # This version only supports Arduino UNO (ESP32/STM32 frozen)
        assert "arduino" in PLATFORM_PINS

    def test_arduino_has_digital_and_analog(self):
        assert "digital" in PLATFORM_PINS["arduino"]
        assert "analog" in PLATFORM_PINS["arduino"]


class TestPinTypeMap:
    def test_sensor_maps_to_analog(self):
        assert PIN_TYPE_MAP["sensor"] == "analog"

    def test_actuator_maps_to_digital(self):
        assert PIN_TYPE_MAP["actuator"] == "digital"

    def test_display_maps_to_i2c(self):
        assert PIN_TYPE_MAP["display"] == "i2c"


class TestComponentLibraries:
    def test_dht11_has_library(self):
        assert "DHT sensor library" in COMPONENT_LIBRARIES["DHT11"]

    def test_hc_sr04_has_newping_library(self):
        assert COMPONENT_LIBRARIES["HC-SR04"] == ["NewPing"]


class TestAssignPins:
    def test_assigns_pin_to_sensor_component(self):
        comps = [{"name": "DHT11", "category": "sensor"}]
        result = assign_pins(comps, "arduino")
        assert len(result) == 1
        assert result[0]["componentName"] == "DHT11"
        # DHT11 uses digital interface (1-Wire protocol)
        assert result[0]["connectionType"] == "digital"
        assert result[0]["microcontrollerPin"] != "N/A"

    def test_falls_back_to_arduino_for_unknown_platform(self):
        comps = [{"name": "LED", "category": "actuator"}]
        result = assign_pins(comps, "unknown_platform")
        assert len(result) == 1
        assert result[0]["microcontrollerPin"] != "N/A"

    def test_avoids_duplicate_pins(self):
        comps = [
            {"name": "Sensor1", "category": "sensor"},
            {"name": "Sensor2", "category": "sensor"},
        ]
        result = assign_pins(comps, "arduino")
        pins = [r["microcontrollerPin"] for r in result]
        assert len(set(pins)) == 2

    def test_none_assigned_for_empty_input(self):
        assert assign_pins([], "arduino") == []

    def test_unknown_category_skipped(self):
        # Components with unknown category and no COMPONENT_INTERFACE entry are skipped
        comps = [{"name": "Generic", "category": "unknown", "interface": "digital"}]
        result = assign_pins(comps, "arduino")
        assert len(result) == 0


class TestResolveDependencies:
    def test_known_component_returns_libraries(self):
        comps = [{"name": "DHT11"}]
        deps = resolve_dependencies(comps)
        assert "DHT sensor library" in deps

    def test_unknown_component_returns_empty(self):
        comps = [{"name": "NonexistentSensor"}]
        assert resolve_dependencies(comps) == []

    def test_matches_by_substring(self):
        comps = [{"name": "LCD1602 I2C"}]
        deps = resolve_dependencies(comps)
        assert "LiquidCrystal_I2C" in deps

    def test_deduplicates(self):
        comps = [{"name": "DHT11"}, {"name": "DHT22"}]
        deps = resolve_dependencies(comps)
        assert deps == ["DHT sensor library"]

    def test_empty_input(self):
        assert resolve_dependencies([]) == []
