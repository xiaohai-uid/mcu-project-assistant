import pytest
from shared.domain.classification import CATEGORY_MAP, map_functionality_to_category


class TestCategoryMap:
    def test_contains_expected_keys(self):
        assert "temperature" in CATEGORY_MAP
        assert "humidity" in CATEGORY_MAP
        assert "light" in CATEGORY_MAP

    def test_maps_to_correct_categories(self):
        assert CATEGORY_MAP["temperature"] == "sensor"
        assert CATEGORY_MAP["servo"] == "actuator"
        assert CATEGORY_MAP["i2c"] == "communication"


class TestMapFunctionalityToCategory:
    def test_returns_category_for_known_functionality(self):
        result = map_functionality_to_category("temperature")
        assert result == "sensor"

    def test_returns_other_for_unknown_functionality(self):
        result = map_functionality_to_category("unknown_thing")
        assert result == "other"

    def test_returns_category_for_case_insensitive(self):
        result = map_functionality_to_category("Temperature")
        assert result == "sensor"
