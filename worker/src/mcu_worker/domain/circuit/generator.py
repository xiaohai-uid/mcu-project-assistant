"""CircuitIR generation from ValidatedDesign + PinAllocation.

CircuitIR is the semantic circuit fact source.
SVG and checklist are Views derived from CircuitIR (not the other way).
"""

from __future__ import annotations

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.models.circuit_ir import (
    CircuitIR,
    ComponentInstance,
    Net,
    NetEndpoint,
    PinAllocationEntry,
    PowerDomain,
)
from mcu_worker.domain.models.component_selection import ComponentSelection
from mcu_worker.domain.models.pin_allocation import PinAllocation


class CircuitGenerator:
    """Generates CircuitIR from component selection and pin allocation."""

    def __init__(self, component_registry: ComponentRegistry) -> None:
        self._registry = component_registry

    def generate(
        self,
        selection: ComponentSelection,
        allocation: PinAllocation,
    ) -> CircuitIR:
        """Build CircuitIR from validated design artifacts."""
        components: list[ComponentInstance] = []
        nets: list[Net] = []
        pin_entries: list[PinAllocationEntry] = []
        power_domains: list[PowerDomain] = []

        # Build component instances
        for item in selection.items:
            components.append(ComponentInstance(
                instance_id=item.instance_id,
                component_id=item.component_id,
                quantity=item.quantity,
            ))

        # Build nets from pin allocation assignments
        net_counter = 0
        for assignment in allocation.assignments:
            net_counter += 1
            nets.append(Net(
                net_id=f"net_{net_counter}",
                endpoints=[NetEndpoint(
                    instance_id=assignment.instance_id,
                    pin_role=assignment.signal,
                    physical_pin=assignment.physical_pin,
                )],
                signal_type=assignment.interface,
                voltage_domain="5V",
            ))
            pin_entries.append(PinAllocationEntry(
                instance_id=assignment.instance_id,
                signal=assignment.signal,
                physical_pin=assignment.physical_pin,
                interface=assignment.interface,
            ))

        # Build shared bus nets
        for bus in allocation.shared_buses:
            net_counter += 1
            endpoints = [
                NetEndpoint(instance_id=p, pin_role=bus.type, physical_pin=str(bus.pins))
                for p in bus.participants
            ]
            nets.append(Net(
                net_id=f"net_{bus.type}_{net_counter}",
                endpoints=endpoints,
                signal_type=bus.type,
                voltage_domain="5V",
            ))

        # Default power domain
        power_domains.append(PowerDomain(
            voltage=5.0,
            rail_name="5V",
            consumers=[c.instance_id for c in components],
        ))

        return CircuitIR(
            platform_id=selection.platform_id,
            components=components,
            nets=nets,
            pin_allocations=pin_entries,
            power_domains=power_domains,
        )
