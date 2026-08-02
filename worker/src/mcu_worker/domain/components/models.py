"""ComponentDefinition: structured engineering truth for a single component."""

from pydantic import BaseModel, Field


class ElectricalSpec(BaseModel):
    """Electrical characteristics."""

    logic_voltage: float = Field(default=5.0)
    supply_voltage_min: float = Field(default=3.3)
    supply_voltage_max: float = Field(default=5.5)
    typical_current_ma: float = Field(default=10.0)


class InterfaceSpec(BaseModel):
    """How the component connects to the MCU."""

    type: str = Field(..., description="analog | digital | i2c | spi | uart | pwm")
    signal_count: int = Field(default=1, ge=1)
    io_direction: str = Field(default="input", description="input | output | bidirectional")
    requirements: dict[str, object] = Field(default_factory=dict)


class FirmwareSpec(BaseModel):
    """Firmware generation metadata."""

    libraries: list[str] = Field(default_factory=list)
    includes: list[str] = Field(default_factory=list)
    codegen_adapter: str = Field(default="generic")
    var_name: str = Field(default="COMPONENT")


class PurchasingSpec(BaseModel):
    """Purchasing search metadata."""

    search_terms: list[str] = Field(default_factory=list)


class ComponentDefinition(BaseModel):
    """V2 ComponentDefinition: the single source of engineering truth.

    Loaded from catalog/components/*.yaml and validated at startup.
    Stable id is the identity; display_name and aliases are for lookup only.
    """

    id: str = Field(..., description="Stable id, e.g. sensor.dht22")
    schema_version: str = Field(default="1", frozen=True)
    display_name: str
    aliases: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    electrical: ElectricalSpec = Field(default_factory=ElectricalSpec)
    interfaces: list[InterfaceSpec] = Field(default_factory=list)
    platform_compatibility: dict[str, str] = Field(default_factory=dict)
    firmware: FirmwareSpec = Field(default_factory=FirmwareSpec)
    purchasing: PurchasingSpec = Field(default_factory=PurchasingSpec)
    safety_notes: list[str] = Field(default_factory=list)
