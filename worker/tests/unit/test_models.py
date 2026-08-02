"""Unit tests for V2 canonical Pydantic contracts.

Verifies:
- Valid data passes
- Invalid enum/missing fields are rejected
- No Any abuse (free JSON only in explicit extension fields)
- schema_version present on all major models
"""

import pytest
from pydantic import ValidationError

from mcu_worker.domain.models import (
    ArtifactPayload,
    Budget,
    CapabilityRequirement,
    CircuitIR,
    Clarification,
    CompileResult,
    ComponentInstance,
    ComponentSelection,
    DesignSpec,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticSource,
    ExperienceLevel,
    Net,
    NetEndpoint,
    PinAllocation,
    PinAssignment,
    PowerConstraints,
    SelectionItem,
    SharedBus,
    StageResult,
    StageStatus,
)


class TestDesignSpec:
    def test_minimal_valid(self):
        spec = DesignSpec(title="Blink", description="Blink an LED")
        assert spec.schema_version == "2.0"
        assert spec.target_platform == "arduino_uno"
        assert spec.experience_level == ExperienceLevel.BEGINNER

    def test_full_spec(self):
        spec = DesignSpec(
            title="Smart Watering",
            description="Auto water plants when soil is dry",
            target_platform="arduino_uno",
            experience_level=ExperienceLevel.INTERMEDIATE,
            capabilities=[
                CapabilityRequirement(
                    capability="soil_moisture_sensing", quantity=1, required=True
                ),
                CapabilityRequirement(capability="water_pump_control", quantity=1),
            ],
            communication=["i2c"],
            power_constraints=PowerConstraints(source="usb", max_voltage=5.0),
            budget=Budget(currency="CNY", max_amount=50.0),
            user_constraints=["must use DHT22"],
            assumptions=["indoor use"],
        )
        assert len(spec.capabilities) == 2
        assert spec.capabilities[0].capability == "soil_moisture_sensing"

    def test_invalid_experience_level_rejected(self):
        with pytest.raises(ValidationError):
            DesignSpec(title="X", description="Y", experience_level="expert")

    def test_schema_version_frozen(self):
        spec = DesignSpec(title="X", description="Y")
        with pytest.raises(ValidationError):
            spec.schema_version = "3.0"

    def test_clarification(self):
        spec = DesignSpec(
            title="Vague",
            description="make something",
            clarification=Clarification(
                required=True, questions=["What do you want to sense?"]
            ),
        )
        assert spec.clarification.required is True
        assert len(spec.clarification.questions) == 1


class TestDiagnostic:
    def test_valid(self):
        d = Diagnostic(
            code="PIN_BUDGET_EXCEEDED",
            severity=DiagnosticSeverity.ERROR,
            message="Not enough digital pins",
            source=DiagnosticSource.DOMAIN,
        )
        assert d.retryable is False

    def test_invalid_severity_rejected(self):
        with pytest.raises(ValidationError):
            Diagnostic(code="X", severity="critical", message="bad")


class TestStageResult:
    def test_succeeded(self):
        result = StageResult(status=StageStatus.SUCCEEDED)
        assert result.outputs == {}
        assert result.warnings == []
        assert result.error_code is None

    def test_failed_with_error(self):
        result = StageResult(
            status=StageStatus.FAILED,
            error_code="LLM_TIMEOUT",
            retryable=True,
        )
        assert result.retryable is True

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            StageResult(status="unknown")

    def test_artifact_payload(self):
        payload = ArtifactPayload(
            artifact_type="design_spec",
            content_json={"title": "test"},
            content_hash="abc123",
        )
        result = StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={"design_spec": payload},
        )
        assert result.outputs["design_spec"].artifact_type == "design_spec"


class TestCompileResult:
    def test_success(self):
        cr = CompileResult(success=True, exit_code=0, duration_ms=1200)
        assert cr.compiler == "arduino-cli"
        assert cr.fqbn == "arduino:avr:uno"
        assert cr.schema_version == "1"

    def test_failure_with_diagnostics(self):
        cr = CompileResult(
            success=False,
            exit_code=1,
            stderr_excerpt="error: DHT.h not found",
            diagnostics=[
                {
                    "code": "missing_include",
                    "file": "sketch.ino",
                    "line": 1,
                    "message": "DHT.h not found",
                    "category": "error",
                }
            ],
        )
        assert cr.diagnostics[0].line == 1


class TestCircuitIR:
    def test_minimal(self):
        cir = CircuitIR(platform_id="arduino_uno")
        assert cir.schema_version == "1"
        assert cir.components == []

    def test_with_components_and_nets(self):
        cir = CircuitIR(
            platform_id="arduino_uno",
            components=[
                ComponentInstance(
                    instance_id="temp_1", component_id="sensor.dht22", quantity=1
                )
            ],
            nets=[
                Net(
                    net_id="net_data",
                    endpoints=[
                        NetEndpoint(
                            instance_id="temp_1", pin_role="data", physical_pin="D2"
                        )
                    ],
                    signal_type="digital",
                    voltage_domain="5V",
                )
            ],
        )
        assert len(cir.components) == 1
        assert cir.nets[0].endpoints[0].physical_pin == "D2"


class TestComponentSelection:
    def test_valid(self):
        sel = ComponentSelection(
            platform_id="arduino_uno",
            items=[
                SelectionItem(
                    instance_id="temp_1",
                    component_id="sensor.dht22",
                    matched_capabilities=["temperature_sensing"],
                    selection_reason="Only registry match",
                )
            ],
        )
        assert sel.schema_version == "1"
        assert sel.items[0].component_id == "sensor.dht22"

    def test_unresolved(self):
        sel = ComponentSelection(
            unresolved_capabilities=["lidar_sensing"],
        )
        assert "lidar_sensing" in sel.unresolved_capabilities


class TestPinAllocation:
    def test_valid(self):
        pa = PinAllocation(
            assignments=[
                PinAssignment(
                    instance_id="temp_1",
                    signal="data",
                    physical_pin="D2",
                    interface="digital",
                )
            ],
            shared_buses=[
                SharedBus(
                    type="i2c",
                    pins={"sda": "A4", "scl": "A5"},
                    participants=["display_1"],
                )
            ],
        )
        assert pa.assignments[0].physical_pin == "D2"
        assert pa.shared_buses[0].pins["sda"] == "A4"


class TestJsonSchemaGeneration:
    """Verify models can generate JSON Schema (for contract testing)."""

    def test_design_spec_schema(self):
        schema = DesignSpec.model_json_schema()
        assert "properties" in schema
        assert "schema_version" in schema["properties"]
        assert "capabilities" in schema["properties"]

    def test_circuit_ir_schema(self):
        schema = CircuitIR.model_json_schema()
        assert "components" in schema["properties"]
        assert "nets" in schema["properties"]

    def test_compile_result_schema(self):
        schema = CompileResult.model_json_schema()
        assert "success" in schema["properties"]
        assert "diagnostics" in schema["properties"]
