import pytest
from shared.domain.layout import (
    WIRE_COLORS,
    layout_components,
    generate_bom,
    render_pin_table,
)


class TestWireColors:
    def test_has_power_and_ground(self):
        assert "power" in WIRE_COLORS
        assert "ground" in WIRE_COLORS

    def test_power_is_red(self):
        assert WIRE_COLORS["power"] == "#FF0000"

    def test_ground_is_black(self):
        assert WIRE_COLORS["ground"] == "#000000"


class TestLayoutComponents:
    def test_returns_list_of_layout_items(self):
        comps = [{"name": "DHT11", "category": "sensor"}]
        result = layout_components(comps, [])
        assert len(result) >= 1
        assert "x" in result[0]
        assert "y" in result[0]

    def test_positions_have_name_and_category(self):
        comps = [{"name": "Arduino", "category": "board"}]
        result = layout_components(comps, [])
        assert result[0]["name"] == "Arduino"
        assert result[0]["category"] == "board"

    def test_empty_input_returns_empty(self):
        assert layout_components([], []) == []

    def test_groups_by_category_order(self):
        comps = [
            {"name": "Sensor", "category": "sensor"},
            {"name": "Board", "category": "board"},
        ]
        result = layout_components(comps, [])
        board_idx = next(i for i, r in enumerate(result) if r["name"] == "Board")
        sensor_idx = next(i for i, r in enumerate(result) if r["name"] == "Sensor")
        assert board_idx < sensor_idx


class TestGenerateBom:
    def test_returns_svg_string(self):
        comps = [{"name": "LED", "price": 1.0, "category": "actuator"}]
        svg = generate_bom(comps)
        assert isinstance(svg, str)
        assert "<g" in svg
        assert "LED" in svg

    def test_empty_input_returns_svg_without_items(self):
        svg = generate_bom([])
        assert "<g" in svg


class TestRenderPinTable:
    def test_returns_svg_string(self):
        pins = [
            {"microcontrollerPin": "A0", "componentName": "DHT11",
             "wireColor": "red", "connectionType": "analog"},
        ]
        svg = render_pin_table(pins)
        assert isinstance(svg, str)
        assert "<g" in svg
        assert "A0" in svg

    def test_empty_input_returns_svg_without_rows(self):
        svg = render_pin_table([])
        assert "<g" in svg
