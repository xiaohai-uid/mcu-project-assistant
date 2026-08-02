"""PlatformRegistry: loads and queries validated PlatformDefinitions."""

import os
from pathlib import Path

import yaml

from mcu_worker.domain.platforms.models import PlatformDefinition

_DEFAULT_CATALOG_DIR = Path(
    os.environ.get("PLATFORM_CATALOG_DIR", str(Path(__file__).resolve().parents[5] / "catalog" / "platforms"))
)


class PlatformRegistry:
    """In-memory registry of validated PlatformDefinitions.

    Usage:
        registry = PlatformRegistry()
        platform = registry.get("arduino_uno")
    """

    def __init__(self, catalog_dir: Path | None = None) -> None:
        self._by_id: dict[str, PlatformDefinition] = {}
        self._catalog_dir = catalog_dir or _DEFAULT_CATALOG_DIR
        self._load()

    def _load(self) -> None:
        if not self._catalog_dir.exists():
            raise FileNotFoundError(f"Platform catalog not found: {self._catalog_dir}")

        for yaml_file in sorted(self._catalog_dir.glob("*.yaml")):
            with open(yaml_file, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            platform = PlatformDefinition(**data)
            if platform.id in self._by_id:
                raise ValueError(f"Duplicate platform id: {platform.id}")
            self._by_id[platform.id] = platform

    @property
    def count(self) -> int:
        return len(self._by_id)

    @property
    def all_ids(self) -> list[str]:
        return list(self._by_id.keys())

    def get(self, platform_id: str) -> PlatformDefinition:
        if platform_id not in self._by_id:
            raise KeyError(
                f"Platform not found: {platform_id}. "
                f"Available: {self.all_ids}"
            )
        return self._by_id[platform_id]

    def get_or_none(self, platform_id: str) -> PlatformDefinition | None:
        return self._by_id.get(platform_id)

    def is_supported(self, platform_id: str) -> bool:
        return platform_id in self._by_id
