"""Test the full V2 pipeline definition and end-to-end stage flow."""

import pytest

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.models.design_spec import CapabilityRequirement, DesignSpec
from mcu_worker.domain.models.stage import ArtifactPayload, StageStatus
from mcu_worker.domain.platforms.registry import PlatformRegistry
from mcu_worker.pipeline_definition import V2_STAGE_ORDER, build_v2_pipeline
from mcu_worker.runtime.context import RunContext
from mcu_worker.runtime.pipeline import PipelineRuntime


@pytest.fixture(scope="module")
def comp_registry():
    return ComponentRegistry()


@pytest.fixture(scope="module")
def plat_registry():
    return PlatformRegistry()


class TestPipelineDefinition:
    def test_stage_order_matches_spec(self):
        pipeline = build_v2_pipeline()
        assert pipeline.stage_names == V2_STAGE_ORDER

    def test_pipeline_version(self):
        pipeline = build_v2_pipeline()
        assert pipeline.version == "2.0"

    def test_six_stages(self):
        pipeline = build_v2_pipeline()
        assert len(pipeline.stages) == 7


class TestEndToEndPipeline:
    def test_full_run_with_preseeded_spec(self, comp_registry, plat_registry):
        """Run the full pipeline (skipping LLM) with a pre-seeded DesignSpec.

        This simulates what happens after RequirementParse produces a DesignSpec.
        We start from ComponentResolution onwards.
        """
        from mcu_worker.runtime.pipeline import PipelineDefinition
        from mcu_worker.stages.circuit_generation import CircuitGenerationStage
        from mcu_worker.stages.compile_validation import CompileValidationStage
        from mcu_worker.stages.component_resolution import ComponentResolutionStage
        from mcu_worker.stages.constraint_validation import ConstraintValidationStage
        from mcu_worker.stages.firmware_generation import FirmwareGenerationStage

        # Pre-seed a DesignSpec (simulating LLM output from RequirementParse)
        spec = DesignSpec(
            title="Smart Watering",
            description="Auto water plants when soil is dry",
            target_platform="arduino_uno",
            capabilities=[
                CapabilityRequirement(capability="soil_moisture_sensing"),
                CapabilityRequirement(capability="water_pump_control"),
            ],
        )

        # Build pipeline from stage 2 onwards
        definition = PipelineDefinition(
            version="2.0",
            stages=[
                ComponentResolutionStage(),
                ConstraintValidationStage(),
                FirmwareGenerationStage(),
                CompileValidationStage(),
                CircuitGenerationStage(),
            ],
        )

        ctx = RunContext(
            run_id="e2e_test_run",
            design_draft_id="draft_e2e",
            input_snapshot={"description": "Auto water plants"},
        )
        ctx.component_registry = comp_registry
        ctx.platform_registry = plat_registry

        # Inject a mock compiler so CompileValidation can pass
        class MockCompiler:
            def compile(self, source_code, **kwargs):
                from mcu_worker.domain.models.compile_result import CompileResult
                return CompileResult(success=True, exit_code=0, duration_ms=100)
        ctx.compiler = MockCompiler()

        ctx.set_artifact("design_spec", ArtifactPayload(
            artifact_type="design_spec",
            schema_version="2.0",
            content_json=spec.model_dump(),
            content_hash="e2e_spec",
        ))

        runtime = PipelineRuntime(definition)
        result = runtime.execute(ctx)

        # Verify full pipeline success
        assert result.status == StageStatus.SUCCEEDED
        assert len(result.completed_stages) == 5

        # Verify all artifacts produced
        assert "component_selection" in ctx.artifacts
        assert "pin_allocation" in ctx.artifacts
        assert "firmware_source" in ctx.artifacts
        assert "compile_result" in ctx.artifacts
        assert "circuit_ir" in ctx.artifacts

        # Verify firmware is a complete sketch
        fw = ctx.artifacts["firmware_source"].content_text
        assert "void setup()" in fw
        assert "void loop()" in fw

        # Verify circuit IR has components
        ir = ctx.artifacts["circuit_ir"].content_json
        assert len(ir["components"]) >= 2
        assert ir["platform_id"] == "arduino_uno"

    def test_vague_input_stops_at_clarification(self, comp_registry, plat_registry):
        """Full pipeline with vague input stops at RequirementParse."""
        pipeline = build_v2_pipeline()
        ctx = RunContext(
            run_id="vague_run",
            design_draft_id="draft_vague",
            input_snapshot={"description": "hi", "target_platform": "arduino_uno"},
        )
        ctx.component_registry = comp_registry
        ctx.platform_registry = plat_registry

        runtime = PipelineRuntime(pipeline)
        result = runtime.execute(ctx)

        assert result.status == StageStatus.WAITING_FOR_USER
        assert result.completed_stages == ["requirement_parse"]
