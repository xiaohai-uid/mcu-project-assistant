"""Constraint Engine: validates hardware feasibility before code generation.

Checks:
- Voltage compatibility between components and platform
- Pin budget (enough digital/analog/pwm pins available)
- Bus sharing rules (I2C shared, SPI shared, UART limited)
- Reserved pin protection
- Deterministic pin allocation

If any constraint fails with severity=error, the design cannot proceed
to firmware generation.
"""

from mcu_worker.domain.components.models import ComponentDefinition
from mcu_worker.domain.models.common import Diagnostic, DiagnosticSeverity, DiagnosticSource
from mcu_worker.domain.models.pin_allocation import PinAllocation, PinAssignment, SharedBus
from mcu_worker.domain.platforms.models import PlatformDefinition


class ConstraintEngine:
    """Validates a component selection against platform constraints.

    Usage:
        engine = ConstraintEngine(platform, components)
        result = engine.validate()
        if result.is_feasible:
            allocation = result.pin_allocation
    """

    def __init__(
        self,
        platform: PlatformDefinition,
        components: list[tuple[str, ComponentDefinition]],
    ) -> None:
        """
        Args:
            platform: The target platform definition.
            components: List of (instance_id, ComponentDefinition) tuples.
        """
        self._platform = platform
        self._components = components
        self._diagnostics: list[Diagnostic] = []

    def validate(self) -> "ConstraintResult":
        """Run all constraint checks and produce a result."""
        self._diagnostics = []
        self._check_voltage()
        self._check_pin_budget()
        self._check_bus_conflicts()

        is_feasible = not any(
            d.severity == DiagnosticSeverity.ERROR for d in self._diagnostics
        )

        allocation = None
        if is_feasible:
            allocation = self._allocate_pins()

        return ConstraintResult(
            is_feasible=is_feasible,
            diagnostics=self._diagnostics,
            pin_allocation=allocation,
        )

    def _check_voltage(self) -> None:
        """Check that all components are compatible with platform logic voltage.

        I2C/SPI bus devices commonly run at 3.3V on 5V platforms (Arduino 3V3 pin
        or level shifters). These get WARNING instead of ERROR.
        """
        platform_voltage = self._platform.logic_voltage
        for instance_id, comp in self._components:
            max_supply = comp.electrical.supply_voltage_max
            min_supply = comp.electrical.supply_voltage_min

            # Bus-only devices (i2c/spi) can be powered from 3V3 pin — warn only
            bus_only = all(
                iface.type in ("i2c", "spi") for iface in comp.interfaces
            )

            if platform_voltage > max_supply + 0.5:
                severity = DiagnosticSeverity.WARNING if bus_only else DiagnosticSeverity.ERROR
                self._diagnostics.append(Diagnostic(
                    code="VOLTAGE_INCOMPATIBLE",
                    severity=severity,
                    message=(
                        f"{comp.display_name} ({instance_id}) max supply {max_supply}V "
                        f"is below platform logic {platform_voltage}V"
                        + (" (bus device: use 3V3 pin or level shifter)" if bus_only else "")
                    ),
                    details={"instance_id": instance_id, "component_id": comp.id},
                    source=DiagnosticSource.DOMAIN,
                ))
            elif platform_voltage < min_supply:
                self._diagnostics.append(Diagnostic(
                    code="VOLTAGE_TOO_LOW",
                    severity=DiagnosticSeverity.ERROR,
                    message=(
                        f"{comp.display_name} ({instance_id}) requires min {min_supply}V "
                        f"but platform provides {platform_voltage}V"
                    ),
                    details={"instance_id": instance_id, "component_id": comp.id},
                    source=DiagnosticSource.DOMAIN,
                ))

    def _check_pin_budget(self) -> None:
        """Check that enough pins are available for all components."""
        avail_digital = list(self._platform.available_digital)
        avail_analog = list(self._platform.available_analog)
        avail_pwm = list(self._platform.available_pwm)

        digital_needed = 0
        analog_needed = 0
        pwm_needed = 0

        for instance_id, comp in self._components:
            for iface in comp.interfaces:
                if iface.type == "analog":
                    analog_needed += iface.signal_count
                elif iface.type == "pwm":
                    pwm_needed += iface.signal_count
                elif iface.type == "digital":
                    digital_needed += iface.signal_count
                # i2c/spi/uart use shared buses, don't consume from pool

        if analog_needed > len(avail_analog):
            self._diagnostics.append(Diagnostic(
                code="ANALOG_PIN_OVERFLOW",
                severity=DiagnosticSeverity.ERROR,
                message=(
                    f"Need {analog_needed} analog pins but only "
                    f"{len(avail_analog)} available"
                ),
                details={"needed": analog_needed, "available": len(avail_analog)},
                source=DiagnosticSource.DOMAIN,
            ))

        if pwm_needed > len(avail_pwm):
            self._diagnostics.append(Diagnostic(
                code="PWM_PIN_SHORTAGE",
                severity=DiagnosticSeverity.ERROR,
                message=(
                    f"Need {pwm_needed} PWM pins but only "
                    f"{len(avail_pwm)} available"
                ),
                details={"needed": pwm_needed, "available": len(avail_pwm)},
                source=DiagnosticSource.DOMAIN,
            ))

        if digital_needed > len(avail_digital):
            self._diagnostics.append(Diagnostic(
                code="DIGITAL_PIN_OVERFLOW",
                severity=DiagnosticSeverity.ERROR,
                message=(
                    f"Need {digital_needed} digital pins but only "
                    f"{len(avail_digital)} available"
                ),
                details={"needed": digital_needed, "available": len(avail_digital)},
                source=DiagnosticSource.DOMAIN,
            ))

    def _check_bus_conflicts(self) -> None:
        """Check UART is not shared by multiple non-UART devices."""
        uart_users = []
        for instance_id, comp in self._components:
            for iface in comp.interfaces:
                if iface.type == "uart":
                    uart_users.append(instance_id)

        if len(uart_users) > 1:
            self._diagnostics.append(Diagnostic(
                code="UART_CONFLICT",
                severity=DiagnosticSeverity.ERROR,
                message=(
                    f"Multiple UART devices ({', '.join(uart_users)}) "
                    f"but Arduino UNO has only one hardware UART"
                ),
                details={"devices": uart_users},
                source=DiagnosticSource.DOMAIN,
            ))

    def _allocate_pins(self) -> PinAllocation:
        """Deterministic pin allocation.

        Strategy:
        - Analog sensors -> A0, A1, A2, ... (in order)
        - Digital inputs -> D2, D4, D7, D8, ... (skip reserved, prefer non-PWM)
        - PWM outputs -> D3, D5, D6, D9, ... (in order)
        - I2C devices -> shared A4/A5
        - SPI devices -> shared D10-D13
        - UART devices -> D2/D3 (SoftwareSerial)
        """
        assignments: list[PinAssignment] = []
        shared_buses: list[SharedBus] = []

        # Track used pins
        used_digital: set[str] = set()
        used_analog: set[str] = set()
        used_pwm: set[str] = set()

        # Pools (ordered)
        analog_pool = list(self._platform.available_analog)
        # For digital, prefer non-PWM pins first to save PWM for actuators
        pwm_set = set(self._platform.pins.pwm)
        digital_non_pwm = [p for p in self._platform.available_digital if p not in pwm_set]
        digital_pwm = [p for p in self._platform.available_digital if p in pwm_set]
        pwm_pool = list(self._platform.available_pwm)

        i2c_participants: list[str] = []
        spi_participants: list[str] = []

        for instance_id, comp in self._components:
            for iface in comp.interfaces:
                if iface.type == "analog":
                    for i in range(iface.signal_count):
                        pin = analog_pool.pop(0) if analog_pool else "N/A"
                        used_analog.add(pin)
                        assignments.append(PinAssignment(
                            instance_id=instance_id,
                            signal=f"analog_{i}" if iface.signal_count > 1 else "signal",
                            physical_pin=pin,
                            interface="analog",
                        ))

                elif iface.type == "digital":
                    for i in range(iface.signal_count):
                        # Prefer non-PWM digital pins
                        if digital_non_pwm:
                            pin = digital_non_pwm.pop(0)
                        elif digital_pwm:
                            pin = digital_pwm.pop(0)
                        else:
                            pin = "N/A"
                        used_digital.add(pin)
                        signal_name = f"digital_{i}" if iface.signal_count > 1 else "signal"
                        # Use specific names if requirements provide them
                        assignments.append(PinAssignment(
                            instance_id=instance_id,
                            signal=signal_name,
                            physical_pin=pin,
                            interface="digital",
                        ))

                elif iface.type == "pwm":
                    for i in range(iface.signal_count):
                        pin = pwm_pool.pop(0) if pwm_pool else "N/A"
                        used_pwm.add(pin)
                        assignments.append(PinAssignment(
                            instance_id=instance_id,
                            signal=f"pwm_{i}" if iface.signal_count > 1 else "signal",
                            physical_pin=pin,
                            interface="pwm",
                        ))

                elif iface.type == "i2c":
                    i2c_participants.append(instance_id)

                elif iface.type == "spi":
                    spi_participants.append(instance_id)

                elif iface.type == "uart":
                    # SoftwareSerial on D2/D3 (first available digital)
                    rx_pin = digital_non_pwm.pop(0) if digital_non_pwm else "D2"
                    tx_pin = digital_non_pwm.pop(0) if digital_non_pwm else "D3"
                    assignments.append(PinAssignment(
                        instance_id=instance_id, signal="rx",
                        physical_pin=rx_pin, interface="uart",
                    ))
                    assignments.append(PinAssignment(
                        instance_id=instance_id, signal="tx",
                        physical_pin=tx_pin, interface="uart",
                    ))

        # Add shared buses
        if i2c_participants:
            i2c_bus = self._platform.buses.get("i2c")
            shared_buses.append(SharedBus(
                type="i2c",
                pins=i2c_bus.pins if i2c_bus else {"sda": "A4", "scl": "A5"},
                participants=i2c_participants,
            ))

        if spi_participants:
            spi_bus = self._platform.buses.get("spi")
            shared_buses.append(SharedBus(
                type="spi",
                pins=spi_bus.pins if spi_bus else {"ss": "D10", "mosi": "D11", "miso": "D12", "sck": "D13"},
                participants=spi_participants,
            ))

        return PinAllocation(
            platform_id=self._platform.id,
            assignments=assignments,
            shared_buses=shared_buses,
            diagnostics=self._diagnostics,
        )


class ConstraintResult:
    """Result of constraint validation."""

    def __init__(
        self,
        is_feasible: bool,
        diagnostics: list[Diagnostic],
        pin_allocation: PinAllocation | None,
    ) -> None:
        self.is_feasible = is_feasible
        self.diagnostics = diagnostics
        self.pin_allocation = pin_allocation

    @property
    def errors(self) -> list[Diagnostic]:
        return [d for d in self.diagnostics if d.severity == DiagnosticSeverity.ERROR]

    @property
    def warnings(self) -> list[Diagnostic]:
        return [d for d in self.diagnostics if d.severity == DiagnosticSeverity.WARNING]
