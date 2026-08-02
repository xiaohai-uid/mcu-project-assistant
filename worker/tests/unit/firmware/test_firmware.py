"""Tests for firmware generator and compile validation stage."""

import pytest

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.firmware.generator import FirmwareGenerator
from mcu_worker.domain.models.pin_allocation import PinAllocation, PinAssignment
from mcu_worker.domain.models.stage import ArtifactPayload, StageStatus
from mcu_worker.domain.platforms.registry import PlatformRegistry
from mcu_worker.runtime.context import RunContext
from mcu_worker.stages.compile_validation import CompileValidationStage
from mcu_worker.stages.firmware_generation import FirmwareGenerationStage


@pytest.fixture(scope="module")
def comp_registry():
    return ComponentRegistry()


@pytest.fixture(scope="module")
def plat_registry():
    return PlatformRegistry()


@pytest.fixture
def uno(plat_registry):
    return plat_registry.get("arduino_uno")


@pytest.fixture
def simple_allocation():
    return PinAllocation(
        platform_id="arduino_uno",
        assignments=[
            PinAssignment(instance_id="dht_1", signal="signal", physical_pin="D2", interface="digital"),
            PinAssignment(instance_id="soil_1", signal="signal", physical_pin="A0", interface="analog"),
        ],
    )


class TestFirmwareGenerator:
    def test_generates_includes(self, uno, comp_registry, simple_allocation):
        components = [
            ("dht_1", comp_registry.get("sensor.dht22")),
            ("soil_1", comp_registry.get("sensor.soil_moisture")),
        ]
        gen = FirmwareGenerator(uno, components, simple_allocation)
        includes = gen.generate_includes()
        assert "DHT.h" in includes

    def test_generates_constants(self, uno, comp_registry, simple_allocation):
        components = [("dht_1", comp_registry.get("sensor.dht22"))]
        gen = FirmwareGenerator(uno, components, simple_allocation)
        constants = gen.generate_constants()
        assert any("PIN_DHT_1_SIGNAL" in c for c in constants)

    def test_generates_complete_sketch(self, uno, comp_registry, simple_allocation):
        components = [
            ("dht_1", comp_registry.get("sensor.dht22")),
            ("soil_1", comp_registry.get("sensor.soil_moisture")),
        ]
        gen = FirmwareGenerator(uno, components, simple_allocation)
        sketch = gen.generate_sketch()

        assert "void setup()" in sketch
        assert "void loop()" in sketch
        assert "#include <DHT.h>" in sketch
        assert "Serial.begin(9600)" in sketch

    def test_deterministic_output(self, uno, comp_registry, simple_allocation):
        """Same input produces identical output."""
        components = [("dht_1", comp_registry.get("sensor.dht22"))]
        gen1 = FirmwareGenerator(uno, components, simple_allocation)
        gen2 = FirmwareGenerator(uno, components, simple_allocation)
        assert gen1.generate_sketch() == gen2.generate_sketch()

    def test_business_logic_injected(self, uno, comp_registry, simple_allocation):
        components = [("dht_1", comp_registry.get("sensor.dht22"))]
        gen = FirmwareGenerator(uno, components, simple_allocation)
        sketch = gen.generate_sketch("float temp = dht.readTemperature();")
        assert "float temp = dht.readTemperature();" in sketch

    def test_pins_from_allocation_not_llm(self, uno, comp_registry, simple_allocation):
        """Pin names come from PinAllocation, not LLM."""
        components = [("dht_1", comp_registry.get("sensor.dht22"))]
        gen = FirmwareGenerator(uno, components, simple_allocation)
        constants = gen.generate_constants()
        # D2 from allocation
        assert any("2" in c for c in constants)


class TestFirmwareGenerationStage:
    def test_produces_firmware_artifact(self, comp_registry, plat_registry):
        from mcu_worker.domain.models.component_selection import ComponentSelection, SelectionItem

        selection = ComponentSelection(
            platform_id="arduino_uno",
            items=[SelectionItem(instance_id="dht_1", component_id="sensor.dht22")],
        )
        allocation = PinAllocation(
            platform_id="arduino_uno",
            assignments=[PinAssignment(instance_id="dht_1", signal="signal", physical_pin="D2")],
        )

        ctx = RunContext(run_id="r1", design_draft_id="d1")
        ctx.component_registry = comp_registry
        ctx.platform_registry = plat_registry
        ctx.set_artifact("component_selection", ArtifactPayload(
            artifact_type="component_selection", content_json=selection.model_dump(), content_hash="s",
        ))
        ctx.set_artifact("pin_allocation", ArtifactPayload(
            artifact_type="component_selection", content_json=allocation.model_dump(), content_hash="p",
        ))

        stage = FirmwareGenerationStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.SUCCEEDED
        assert "firmware_source" in result.outputs
        assert "void setup()" in result.outputs["firmware_source"].content_text


class TestCompileValidationStage:
    def test_fails_without_compiler(self):
        """Per spec: firmware must be compile-validated. No compiler = FAILURE."""
        ctx = RunContext(run_id="r1", design_draft_id="d1")
        ctx.set_artifact("firmware_source", ArtifactPayload(
            artifact_type="firmware_source", content_text="void setup(){} void loop(){}", content_hash="fw",
        ))
        stage = CompileValidationStage()
        result = stage.execute(ctx)
        # Without compiler adapter, must FAIL (spec: "未运行不能算通过")
        assert result.status == StageStatus.FAILED
        assert result.error_code == "NO_COMPILER_AVAILABLE"
        assert len(result.warnings) > 0

    def test_fails_without_firmware(self):
        ctx = RunContext(run_id="r1", design_draft_id="d1")
        stage = CompileValidationStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.FAILED
        assert result.error_code == "MISSING_FIRMWARE"
