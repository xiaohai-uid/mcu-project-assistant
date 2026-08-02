"""Tests for component catalog loading and validation.

Verifies:
- Every YAML in catalog/components/ loads and validates against ComponentDefinition
- No duplicate stable ids
- No duplicate aliases across components
- All components have at least one interface
"""

from pathlib import Path

import yaml
from pydantic import ValidationError

from mcu_worker.domain.components.models import ComponentDefinition

CATALOG_DIR = Path(__file__).resolve().parents[4] / "catalog" / "components"


def load_all_components() -> list[dict]:
    """Load all YAML files from catalog/components/."""
    raw = []
    for yaml_file in sorted(CATALOG_DIR.glob("*.yaml")):
        with open(yaml_file, encoding="utf-8") as f:
            data = yaml.safe_load(f)
            data["_source_file"] = yaml_file.name
            raw.append(data)
    return raw


class TestCatalogLoading:
    def test_catalog_directory_exists(self):
        assert CATALOG_DIR.exists(), f"Catalog dir not found: {CATALOG_DIR}"

    def test_catalog_has_components(self):
        components = load_all_components()
        assert len(components) >= 20, f"Expected >=20 components, got {len(components)}"

    def test_all_yaml_validate_against_schema(self):
        components = load_all_components()
        errors = []
        for comp in components:
            source = comp.pop("_source_file", "unknown")
            try:
                ComponentDefinition(**comp)
            except ValidationError as e:
                errors.append(f"{source}: {e}")
        assert not errors, "Validation errors:\n" + "\n".join(errors)


class TestCatalogIntegrity:
    def test_no_duplicate_stable_ids(self):
        components = load_all_components()
        ids = [c["id"] for c in components]
        duplicates = [x for x in ids if ids.count(x) > 1]
        assert not duplicates, f"Duplicate stable ids: {set(duplicates)}"

    def test_no_duplicate_aliases(self):
        components = load_all_components()
        all_aliases: dict[str, str] = {}
        conflicts = []
        for comp in components:
            for alias in comp.get("aliases", []):
                alias_lower = alias.lower()
                if alias_lower in all_aliases:
                    conflicts.append(
                        f"Alias '{alias}' used by both {all_aliases[alias_lower]} and {comp['id']}"
                    )
                else:
                    all_aliases[alias_lower] = comp["id"]
        assert not conflicts, "Alias conflicts:\n" + "\n".join(conflicts)

    def test_display_name_not_used_as_id(self):
        components = load_all_components()
        for comp in components:
            assert comp["id"] != comp["display_name"], (
                f"Component {comp['id']} uses display_name as stable id"
            )

    def test_all_have_interface(self):
        components = load_all_components()
        for comp in components:
            assert len(comp.get("interfaces", [])) > 0, (
                f"Component {comp['id']} has no interface defined"
            )

    def test_all_have_capabilities(self):
        components = load_all_components()
        for comp in components:
            assert len(comp.get("capabilities", [])) > 0, (
                f"Component {comp['id']} has no capabilities"
            )

    def test_all_support_arduino_uno(self):
        components = load_all_components()
        for comp in components:
            compat = comp.get("platform_compatibility", {})
            assert compat.get("arduino_uno") == "supported", (
                f"Component {comp['id']} does not support arduino_uno"
            )

    def test_stable_id_format(self):
        """Stable ids must be category.name format."""
        components = load_all_components()
        for comp in components:
            parts = comp["id"].split(".")
            assert len(parts) == 2, f"Invalid id format: {comp['id']}"
            assert parts[0] in ("sensor", "display", "actuator", "comm", "input"), (
                f"Unknown category prefix in id: {comp['id']}"
            )
