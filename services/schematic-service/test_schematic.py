"""Unit tests for schematic-service SVG generation and wiring checklist."""

import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


class TestSchematicLayout:
    """Test SVG layout generation logic."""

    def test_layout_positions_components(self):
        from shared.domain.layout import layout_components
        components = [
            {"name": "DHT22", "category": "sensor"},
            {"name": "继电器模块", "category": "actuator"},
            {"name": "LCD1602", "category": "display"},
        ]
        positions = layout_components(components, [])
        assert len(positions) == 3
        # Each position should have x, y coordinates
        for pos in positions:
            assert "x" in pos
            assert "y" in pos

    def test_layout_groups_by_category(self):
        from shared.domain.layout import layout_components
        components = [
            {"name": "DHT22", "category": "sensor"},
            {"name": "继电器", "category": "actuator"},
        ]
        positions = layout_components(components, [])
        categories = [p["category"] for p in positions]
        assert "sensor" in categories
        assert "actuator" in categories


class TestWiringChecklist:
    """Test wiring checklist generation."""

    def test_checklist_from_pin_mappings(self):
        from shared.domain.pins import assign_pins
        components = [
            {"name": "土壤湿度传感器", "category": "sensor", "interface": "analog"},
            {"name": "小型水泵", "category": "actuator", "interface": "digital"},
        ]
        pins = assign_pins(components, "arduino")
        # Each pin mapping should have required fields
        for pin in pins:
            assert "componentName" in pin
            assert "microcontrollerPin" in pin
            assert "connectionType" in pin

    def test_pin_var_name_readable(self):
        from shared.domain.pins import assign_pins
        components = [
            {"name": "土壤湿度传感器", "category": "sensor", "interface": "analog"},
        ]
        pins = assign_pins(components, "arduino")
        pin = pins[0]
        assert "pinVarName" in pin
        # Should be readable, not all underscores
        assert "___" not in pin["pinVarName"]
        assert "SOIL_MOISTURE" in pin["pinVarName"]


class TestLoggingConfig:
    """Test the structured logging setup."""

    def test_setup_logging_returns_logger(self):
        from shared.logging_config import setup_logging
        logger = setup_logging("test-service")
        assert logger.name == "test-service"
        assert len(logger.handlers) > 0

    def test_get_logger(self):
        from shared.logging_config import get_logger
        logger = get_logger("my.module")
        assert logger.name == "my.module"

    def test_json_formatter_output(self):
        import json
        import logging
        from shared.logging_config import JsonFormatter

        formatter = JsonFormatter()
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="hello world", args=None, exc_info=None,
        )
        output = formatter.format(record)
        parsed = json.loads(output)
        assert parsed["level"] == "info"
        assert parsed["msg"] == "hello world"
        assert "time" in parsed
