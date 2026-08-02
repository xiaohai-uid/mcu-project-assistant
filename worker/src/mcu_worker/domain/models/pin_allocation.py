"""PinAllocation: output of the ConstraintValidation stage."""

from pydantic import BaseModel, Field

from mcu_worker.domain.models.common import Diagnostic


class PinAssignment(BaseModel):
    """A single pin assignment."""

    instance_id: str
    signal: str
    physical_pin: str
    interface: str = Field(default="digital")


class SharedBus(BaseModel):
    """A shared bus (I2C, SPI, UART) with participants."""

    type: str = Field(..., description="i2c | spi | uart")
    pins: dict[str, str] = Field(default_factory=dict)
    participants: list[str] = Field(default_factory=list)


class PinAllocation(BaseModel):
    """V2 PinAllocation: deterministic pin assignment result."""

    schema_version: str = Field(default="1", frozen=True)
    platform_id: str = Field(default="arduino_uno")
    assignments: list[PinAssignment] = Field(default_factory=list)
    shared_buses: list[SharedBus] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
