"""Unit tests for codegen-service message handling (mock channel)."""

import json
import sys
import os
from unittest.mock import MagicMock, patch

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


@pytest.fixture
def mock_channel():
    ch = MagicMock()
    ch.basic_ack = MagicMock()
    return ch


@pytest.fixture
def mock_method():
    m = MagicMock()
    m.delivery_tag = 1
    return m


class TestCodegenHelpers:
    """Test the deterministic code generation helpers."""

    def test_build_global_objects_dht22(self):
        from shared.domain.codegen_helpers import build_global_objects
        components = [{"name": "DHT22", "interface": "digital"}]
        objects = build_global_objects(components)
        assert any("DHT dht(" in o for o in objects)

    def test_build_global_objects_lcd1602(self):
        from shared.domain.codegen_helpers import build_global_objects
        components = [{"name": "LCD1602", "interface": "i2c"}]
        objects = build_global_objects(components)
        assert any("LiquidCrystal_I2C" in o for o in objects)

    def test_build_constants_soil_moisture(self):
        from shared.domain.codegen_helpers import build_constants
        components = [{"name": "土壤湿度传感器"}]
        constants = build_constants(components)
        assert any("MOISTURE_THRESHOLD" in c for c in constants)

    def test_build_setup_lines_dht(self):
        from shared.domain.codegen_helpers import build_setup_lines
        components = [{"name": "DHT22", "interface": "digital", "category": "sensor"}]
        lines = build_setup_lines(components, [])
        assert "dht.begin();" in lines

    def test_mock_business_logic_has_delay(self):
        from shared.domain.codegen_helpers import mock_business_logic
        components = [{"name": "土壤湿度传感器", "category": "sensor", "interface": "analog"}]
        logic = mock_business_logic(components, [])
        assert "delay(" in logic

    def test_validate_code_missing_setup(self):
        from shared.domain.codegen_helpers import validate_code
        result = validate_code("void loop() {}", [])
        assert not result["valid"]
        assert any("setup" in w for w in result["warnings"])

    def test_validate_code_valid(self):
        from shared.domain.codegen_helpers import validate_code
        code = "void setup() {}\nvoid loop() {}"
        result = validate_code(code, [])
        assert result["valid"]

    def test_build_upload_instructions(self):
        from shared.domain.codegen_helpers import build_upload_instructions
        result = build_upload_instructions([], ["DHT sensor library"])
        assert "steps" in result
        assert len(result["steps"]) > 5
        assert any("DHT sensor library" in s for s in result["steps"])
        assert result["libraryCommands"] == ['arduino-cli lib install "DHT sensor library"']


class TestPinAssignment:
    """Test pin assignment logic."""

    def test_assign_pins_basic(self):
        from shared.domain.pins import assign_pins
        components = [
            {"name": "土壤湿度传感器", "category": "sensor", "interface": "analog"},
            {"name": "继电器模块", "category": "actuator", "interface": "digital"},
        ]
        pins = assign_pins(components, "arduino")
        assert len(pins) == 2
        # Sensor should get analog pin
        sensor_pin = next(p for p in pins if "土壤" in p["componentName"])
        assert "A" in sensor_pin["microcontrollerPin"]

    def test_assign_pins_no_overflow(self):
        from shared.domain.pins import assign_pins
        # Arduino UNO has 6 analog + 14 digital
        components = [
            {"name": f"sensor{i}", "category": "sensor", "interface": "analog"}
            for i in range(6)
        ]
        pins = assign_pins(components, "arduino")
        assert len(pins) == 6

    def test_sanitize_pin_name_chinese(self):
        from shared.domain.pins import sanitize_pin_name
        assert sanitize_pin_name("土壤湿度传感器") == "SOIL_MOISTURE"
        assert sanitize_pin_name("DHT22") == "DHT22"
        assert sanitize_pin_name("继电器模块") == "RELAY"


class TestCompatibility:
    """Test voltage/compatibility checking."""

    def test_detect_conflicts_3v3_5v(self):
        from shared.domain.compatibility import detect_conflicts
        components = [
            {"name": "Sensor A", "voltage": 3.3},
            {"name": "Sensor B", "voltage": 5.0},
        ]
        conflicts = detect_conflicts(components)
        # Should detect voltage mismatch (diff > 1.0)
        assert len(conflicts) == 1
        assert conflicts[0]["type"] == "voltage_mismatch"

    def test_no_conflicts_same_voltage(self):
        from shared.domain.compatibility import detect_conflicts
        components = [
            {"name": "Sensor A", "voltage": 5.0},
            {"name": "Sensor B", "voltage": 5.0},
        ]
        conflicts = detect_conflicts(components)
        assert len(conflicts) == 0
