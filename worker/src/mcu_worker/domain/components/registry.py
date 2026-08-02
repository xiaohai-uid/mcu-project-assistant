"""ComponentRegistry: loads and queries validated ComponentDefinitions.

The registry is the single access point for component engineering facts.
V2 worker code must use this instead of legacy COMPONENT_* dictionaries.
"""

import os
from pathlib import Path

import yaml

from mcu_worker.domain.components.models import ComponentDefinition

_DEFAULT_CATALOG_DIR = Path(
    os.environ.get("CATALOG_DIR", str(Path(__file__).resolve().parents[5] / "catalog" / "components"))
)


class ComponentRegistry:
    """In-memory registry of validated ComponentDefinitions.

    Usage:
        registry = ComponentRegistry()  # loads from default catalog/
        comp = registry.get("sensor.dht22")
        matches = registry.find_by_capability("temperature_sensing")
        comp = registry.find_by_alias("DHT22温湿度传感器")
    """

    def __init__(self, catalog_dir: Path | None = None) -> None:
        self._by_id: dict[str, ComponentDefinition] = {}
        self._by_alias: dict[str, str] = {}  # alias_lower -> component_id
        self._by_capability: dict[str, list[str]] = {}  # capability -> [component_ids]
        self._catalog_dir = catalog_dir or _DEFAULT_CATALOG_DIR
        self._load()

    def _load(self) -> None:
        """Load and validate all YAML files from catalog directory."""
        if not self._catalog_dir.exists():
            raise FileNotFoundError(f"Catalog directory not found: {self._catalog_dir}")

        for yaml_file in sorted(self._catalog_dir.glob("*.yaml")):
            with open(yaml_file, encoding="utf-8") as f:
                data = yaml.safe_load(f)

            comp = ComponentDefinition(**data)

            if comp.id in self._by_id:
                raise ValueError(f"Duplicate component id: {comp.id}")

            self._by_id[comp.id] = comp

            # Index aliases (case-insensitive)
            for alias in comp.aliases:
                key = alias.lower()
                if key in self._by_alias:
                    raise ValueError(
                        f"Duplicate alias '{alias}': "
                        f"used by {self._by_alias[key]} and {comp.id}"
                    )
                self._by_alias[key] = comp.id

            # Also index display_name as lookup key
            dn_key = comp.display_name.lower()
            if dn_key not in self._by_alias:
                self._by_alias[dn_key] = comp.id

            # Index capabilities
            for cap in comp.capabilities:
                self._by_capability.setdefault(cap, []).append(comp.id)

    @property
    def count(self) -> int:
        """Number of registered components."""
        return len(self._by_id)

    @property
    def all_ids(self) -> list[str]:
        """All registered stable ids."""
        return list(self._by_id.keys())

    def get(self, component_id: str) -> ComponentDefinition:
        """Get a component by stable id. Raises KeyError if not found."""
        if component_id not in self._by_id:
            raise KeyError(f"Component not found: {component_id}")
        return self._by_id[component_id]

    def get_or_none(self, component_id: str) -> ComponentDefinition | None:
        """Get a component by stable id, or None if not found."""
        return self._by_id.get(component_id)

    def find_by_alias(self, alias: str) -> ComponentDefinition | None:
        """Find a component by alias or display name (case-insensitive)."""
        comp_id = self._by_alias.get(alias.lower())
        if comp_id is None:
            return None
        return self._by_id[comp_id]

    def find_by_capability(
        self, capability: str, platform_id: str | None = None
    ) -> list[ComponentDefinition]:
        """Find all components that provide a given capability.

        Optionally filter by platform compatibility.
        """
        ids = self._by_capability.get(capability, [])
        results = [self._by_id[cid] for cid in ids]
        if platform_id:
            results = [
                c
                for c in results
                if c.platform_compatibility.get(platform_id) == "supported"
            ]
        return results

    def resolve_name(self, name: str) -> ComponentDefinition | None:
        """Resolve a component by exact id, alias, or partial name match.

        Priority: exact id > exact alias > partial match in aliases.
        """
        # Exact id
        if name in self._by_id:
            return self._by_id[name]

        # Exact alias
        result = self.find_by_alias(name)
        if result:
            return result

        # Partial match (legacy compat: "DHT22温湿度传感器模块" contains "DHT22")
        name_lower = name.lower()
        for alias, comp_id in self._by_alias.items():
            if alias in name_lower or name_lower in alias:
                return self._by_id[comp_id]

        return None
