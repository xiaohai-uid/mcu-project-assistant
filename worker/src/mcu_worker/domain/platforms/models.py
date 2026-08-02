"""PlatformDefinition: structured hardware truth for a target board."""

from pydantic import BaseModel, Field


class BusDefinition(BaseModel):
    """A communication bus on the platform."""

    pins: dict[str, str] = Field(default_factory=dict)
    shared: bool = Field(default=False)


class ReservedPin(BaseModel):
    """A pin reserved for a specific system function."""

    pin: str
    reason: str


class MemorySpec(BaseModel):
    """Memory specifications."""

    flash_kb: float = Field(default=32.0)
    sram_kb: float = Field(default=2.0)
    eeprom_kb: float = Field(default=1.0)


class PowerLimits(BaseModel):
    """Electrical power limits."""

    max_pin_current_ma: float = Field(default=40.0)
    max_total_current_ma: float = Field(default=200.0)
    vin_range: list[float] = Field(default_factory=lambda: [7.0, 12.0])
    regulated_5v_available: bool = True
    regulated_3v3_available: bool = False


class ToolchainSpec(BaseModel):
    """Compiler toolchain configuration."""

    type: str = Field(default="arduino_cli")
    fqbn: str = Field(..., description="Fully Qualified Board Name")
    core: str = Field(default="")


class PinPools(BaseModel):
    """Available pin pools by type."""

    digital: list[str] = Field(default_factory=list)
    analog: list[str] = Field(default_factory=list)
    pwm: list[str] = Field(default_factory=list)


class PlatformDefinition(BaseModel):
    """V2 PlatformDefinition: the single source of hardware truth.

    Loaded from catalog/platforms/*.yaml and validated at startup.
    """

    id: str = Field(..., description="Stable platform id, e.g. arduino_uno")
    schema_version: str = Field(default="1", frozen=True)
    display_name: str
    family: str = Field(default="avr")
    framework: str = Field(default="arduino")
    logic_voltage: float = Field(default=5.0)
    pins: PinPools = Field(default_factory=PinPools)
    buses: dict[str, BusDefinition] = Field(default_factory=dict)
    reserved_pins: list[ReservedPin] = Field(default_factory=list)
    memory: MemorySpec = Field(default_factory=MemorySpec)
    power_limits: PowerLimits = Field(default_factory=PowerLimits)
    toolchain: ToolchainSpec
    codegen_profile: str = Field(default="arduino_avr")

    @property
    def reserved_pin_set(self) -> set[str]:
        """Set of reserved pin names for quick lookup."""
        return {rp.pin for rp in self.reserved_pins}

    @property
    def available_digital(self) -> list[str]:
        """Digital pins not reserved."""
        reserved = self.reserved_pin_set
        return [p for p in self.pins.digital if p not in reserved]

    @property
    def available_analog(self) -> list[str]:
        """Analog pins not reserved (excludes I2C A4/A5 if reserved)."""
        reserved = self.reserved_pin_set
        return [p for p in self.pins.analog if p not in reserved]

    @property
    def available_pwm(self) -> list[str]:
        """PWM pins not reserved."""
        reserved = self.reserved_pin_set
        return [p for p in self.pins.pwm if p not in reserved]
