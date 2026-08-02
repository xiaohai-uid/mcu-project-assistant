"""Tests for CircuitIR generation."""

import pytest

from mcu_worker.domain.circuit.generator import CircuitGenerator
from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.models.component_selection import ComponentSelection, SelectionItem
from mcu_worker.domain.models.pin_allocation import PinAllocation, PinAssignment, SharedBus
from mcu_worker.domain.models.stage import ArtifactPayload, StageStatus
from mcu_worker.runtime.context import RunContext
from mcu_worker.stages.circuit_generation import CircuitGenerationStage


@pytest.fixture(scope="module")
def comp_registry():
    return ComponentRegistry()


@pytest.fixture
def sample_selection():
    return ComponentSelection(
        platform_id="arduino_uno",
        items=[
            SelectionItem(instance_id="dht_1", component_id="sensor.dht22"),
            SelectionItem(instance_id="lcd_1", component_id="display.lcd1602"),
        ],
    )


@pytest.fixture
def sample_allocation():
    return PinAllocation(
        platform_id="arduino_uno",
        assignments=[
            PinAssignment(instance_id="dht_1", signal="signal", physical_pin="D2", interface="digital"),
        ],
        shared_buses=[
            SharedBus(type="i2c", pins={"sda": "A4", "scl": "A5"}, participants=["lcd_1"]),
        ],
    )


class TestCircuitGenerator:
    def test_generates_circuit_ir(self, comp_registry, sample_selection, sample_allocation):
        gen = CircuitGenerator(comp_registry)
        ir = gen.generate(sample_selection, sample_allocation)

        assert ir.schema_version == "1"
        assert ir.platform_id == "arduino_uno"
        assert len(ir.components) == 2
        assert len(ir.nets) >= 1
        assert len(ir.power_domains) == 1

    def test_components_from_selection(self, comp_registry, sample_selection, sample_allocation):
        gen = CircuitGenerator(comp_registry)
        ir = gen.generate(sample_selection, sample_allocation)

        comp_ids = [c.component_id for c in ir.components]
        assert "sensor.dht22" in comp_ids
        assert "display.lcd1602" in comp_ids

    def test_nets_from_allocation(self, comp_registry, sample_selection, sample_allocation):
        gen = CircuitGenerator(comp_registry)
        ir = gen.generate(sample_selection, sample_allocation)

        # Should have at least one net for D2 assignment + one for I2C bus
        assert len(ir.nets) >= 2

    def test_serializable(self, comp_registry, sample_selection, sample_allocation):
        gen = CircuitGenerator(comp_registry)
        ir = gen.generate(sample_selection, sample_allocation)
        data = ir.model_dump()
        assert "components" in data
        assert "nets" in data


class TestCircuitGenerationStage:
    def test_produces_circuit_artifact(self, comp_registry, sample_selection, sample_allocation):
        ctx = RunContext(run_id="r1", design_draft_id="d1")
        ctx.component_registry = comp_registry
        ctx.set_artifact("component_selection", ArtifactPayload(
            artifact_type="component_selection",
            content_json=sample_selection.model_dump(),
            content_hash="s",
        ))
        ctx.set_artifact("pin_allocation", ArtifactPayload(
            artifact_type="component_selection",
            content_json=sample_allocation.model_dump(),
            content_hash="p",
        ))

        stage = CircuitGenerationStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.SUCCEEDED
        assert "circuit_ir" in result.outputs
        ir_data = result.outputs["circuit_ir"].content_json
        assert ir_data["platform_id"] == "arduino_uno"
