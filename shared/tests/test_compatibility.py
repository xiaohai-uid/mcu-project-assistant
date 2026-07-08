import pytest
from shared.domain.compatibility import (
    check_compatibility,
    allocate_tiers,
    detect_conflicts,
)


class TestCheckCompatibility:
    def test_compatible_when_platform_in_list(self):
        comp = {"name": "DHT11", "compatible_platforms": "arduino,esp32"}
        result = check_compatibility(comp, "arduino")
        assert result["compatible"] is True
        assert result["reasons"] == []

    def test_not_compatible_when_platform_not_in_list(self):
        comp = {"name": "DHT11", "compatible_platforms": "arduino,esp32"}
        result = check_compatibility(comp, "stm32")
        assert result["compatible"] is False
        assert len(result["reasons"]) == 1

    def test_case_insensitive(self):
        comp = {"name": "DHT11", "compatible_platforms": "Arduino,ESP32"}
        result = check_compatibility(comp, "ARDUINO")
        assert result["compatible"] is True

    def test_empty_compatible_platforms(self):
        comp = {"name": "DHT11", "compatible_platforms": ""}
        result = check_compatibility(comp, "arduino")
        assert result["compatible"] is False


class TestAllocateTiers:
    def test_tiers_by_price(self):
        comps = [
            {"name": "LED", "price": 1.0},
            {"name": "Sensor", "price": 10.0},
            {"name": "Board", "price": 25.0},
        ]
        result = allocate_tiers(comps)
        assert len(result["budget"]) == 1
        assert len(result["standard"]) == 1
        assert len(result["premium"]) == 1

    def test_allocates_to_budget_when_under_3(self):
        comps = [{"name": "Resistor", "price": 0.5}]
        result = allocate_tiers(comps)
        assert result["budget"][0]["name"] == "Resistor"

    def test_allocates_to_standard_when_3_to_15(self):
        comps = [{"name": "Sensor", "price": 7.0}]
        result = allocate_tiers(comps)
        assert result["standard"][0]["name"] == "Sensor"

    def test_allocates_to_premium_when_15_or_more(self):
        comps = [{"name": "Board", "price": 20.0}]
        result = allocate_tiers(comps)
        assert result["premium"][0]["name"] == "Board"

    def test_empty_input(self):
        result = allocate_tiers([])
        assert result == {"budget": [], "standard": [], "premium": []}

    def test_backward_compatibility_no_platform(self):
        comps = [{"name": "LED", "price": 1.0}]
        result = allocate_tiers(comps)
        assert "budget" in result

    def test_filters_incompatible_when_platform_provided(self):
        comps = [
            {"name": "Arduino LED", "price": 1.0, "compatible_platforms": "arduino"},
            {"name": "STM32 Board", "price": 20.0, "compatible_platforms": "stm32"},
        ]
        result = allocate_tiers(comps, platform="arduino")
        assert len(result["budget"]) == 1
        assert result["budget"][0]["name"] == "Arduino LED"
        assert len(result["premium"]) == 0


class TestDetectConflicts:
    def test_no_conflicts_when_same_voltage(self):
        comps = [
            {"name": "A", "voltage": 3.3},
            {"name": "B", "voltage": 3.3},
        ]
        assert detect_conflicts(comps) == []

    def test_detects_voltage_mismatch(self):
        comps = [
            {"name": "A", "voltage": 3.3},
            {"name": "B", "voltage": 5.0},
        ]
        result = detect_conflicts(comps)
        assert len(result) == 1
        assert result[0]["type"] == "voltage_mismatch"
        assert result[0]["severity"] == "warning"

    def test_ignores_missing_voltage(self):
        comps = [
            {"name": "A", "voltage": 3.3},
            {"name": "B", "price": 10},
        ]
        assert detect_conflicts(comps) == []

    def test_multiple_pairs(self):
        comps = [
            {"name": "A", "voltage": 3.3},
            {"name": "B", "voltage": 5.0},
            {"name": "C", "voltage": 3.3},
            {"name": "D", "voltage": 5.0},
        ]
        result = detect_conflicts(comps)
        assert len(result) == 4

    def test_single_component_no_conflicts(self):
        comps = [{"name": "A", "voltage": 3.3}]
        assert detect_conflicts(comps) == []
