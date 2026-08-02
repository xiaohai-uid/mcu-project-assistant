"""CircuitIR: semantic circuit intermediate representation.

The single source of truth for electrical connections.
SVG and checklist are Views derived from this.
"""

from pydantic import BaseModel, Field

from mcu_worker.domain.models.common import Diagnostic


class ComponentInstance(BaseModel):
    """A placed component instance in the circuit."""

    instance_id: str
    component_id: str = Field(..., description="Stable catalog id, e.g. sensor.dht22")
    quantity: int = Field(default=1, ge=1)


class NetEndpoint(BaseModel):
    """One endpoint of a net connection."""

    instance_id: str
    pin_role: str = Field(..., description="e.g. data, vcc, gnd, sda, scl")
    physical_pin: str = Field(..., description="e.g. D2, A4, 5V, GND")


class Net(BaseModel):
    """A electrical net connecting component endpoints."""

    net_id: str
    endpoints: list[NetEndpoint] = Field(default_factory=list)
    signal_type: str = Field(default="digital", description="digital | analog | i2c | spi | uart | power")
    voltage_domain: str = Field(default="5V")


class PinAllocationEntry(BaseModel):
    """A single pin allocation record."""

    instance_id: str
    signal: str
    physical_pin: str
    interface: str = Field(default="digital")


class PowerDomain(BaseModel):
    """A power domain in the circuit."""

    voltage: float
    rail_name: str = Field(..., description="e.g. 5V, 3V3")
    consumers: list[str] = Field(default_factory=list)


class CircuitIR(BaseModel):
    """V2 CircuitIR: semantic circuit fact source."""

    schema_version: str = Field(default="1", frozen=True)
    platform_id: str = Field(default="arduino_uno")
    components: list[ComponentInstance] = Field(default_factory=list)
    nets: list[Net] = Field(default_factory=list)
    pin_allocations: list[PinAllocationEntry] = Field(default_factory=list)
    power_domains: list[PowerDomain] = Field(default_factory=list)
    warnings: list[Diagnostic] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
