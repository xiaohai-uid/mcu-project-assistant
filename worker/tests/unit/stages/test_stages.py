"""Integration tests for V2 pipeline stages (T5.1-T5.4)."""

import pytest

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.models.stage import StageStatus
from mcu_worker.domain.platforms.registry import PlatformRegistry
from mcu_worker.runtime.context import RunContext
from mcu_worker.runtime.pipeline import PipelineDefinition, PipelineRuntime
from mcu_worker.stages.component_resolution import ComponentResolutionStage
from mcu_worker.stages.constraint_validation import ConstraintValidationStage
from mcu_worker.stages.requirement import RequirementParseStage


@pytest.fixture(scope="module")
def comp_registry():
    return ComponentRegistry()


@pytest.fixture(scope="module")
def plat_registry():
    return PlatformRegistry()


def make_ctx(description="Auto water plants when soil is dry", **kwargs):
    return RunContext(
        run_id="test_run_1",
        design_draft_id="draft_1",
        input_snapshot={
            "description": description,
            "target_platform": "arduino_uno",
            "experience_level": "beginner",
        },
        **kwargs,
    )


class TestRequirementParseStage:
    def test_valid_description_succeeds(self):
        stage = RequirementParseStage()
        ctx = make_ctx("Smart watering system with soil moisture sensor and pump")
        result = stage.execute(ctx)
        assert result.status == StageStatus.SUCCEEDED
        assert "design_spec" in result.outputs

    def test_vague_input_triggers_clarification(self):
        stage = RequirementParseStage()
        ctx = make_ctx("hi")
        result = stage.execute(ctx)
        assert result.status == StageStatus.WAITING_FOR_USER

    def test_empty_input_triggers_clarification(self):
        stage = RequirementParseStage()
        ctx = make_ctx("")
        result = stage.execute(ctx)
        assert result.status == StageStatus.WAITING_FOR_USER


class TestComponentResolutionStage:
    def test_resolves_from_registry(self, comp_registry):
        """Given a DesignSpec with capabilities, resolve components."""
        from mcu_worker.domain.models.design_spec import CapabilityRequirement, DesignSpec
        from mcu_worker.domain.models.stage import ArtifactPayload

        spec = DesignSpec(
            title="Test",
            description="test",
            capabilities=[
                CapabilityRequirement(capability="soil_moisture_sensing"),
                CapabilityRequirement(capability="water_pump_control"),
            ],
        )

        ctx = make_ctx()
        ctx.component_registry = comp_registry
        ctx.set_artifact("design_spec", ArtifactPayload(
            artifact_type="design_spec",
            content_json=spec.model_dump(),
            content_hash="test",
        ))

        stage = ComponentResolutionStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.SUCCEEDED
        assert "component_selection" in result.outputs

        selection = result.outputs["component_selection"].content_json
        assert len(selection["items"]) >= 2

    def test_missing_spec_fails(self, comp_registry):
        ctx = make_ctx()
        ctx.component_registry = comp_registry
        stage = ComponentResolutionStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.FAILED
        assert result.error_code == "MISSING_DESIGN_SPEC"


class TestConstraintValidationStage:
    def test_feasible_design_passes(self, comp_registry, plat_registry):
        """A simple DHT22 + soil moisture design should pass constraints."""
        from mcu_worker.domain.models.component_selection import ComponentSelection, SelectionItem
        from mcu_worker.domain.models.design_spec import CapabilityRequirement, DesignSpec
        from mcu_worker.domain.models.stage import ArtifactPayload

        spec = DesignSpec(title="T", description="D", capabilities=[
            CapabilityRequirement(capability="temperature_sensing"),
        ])
        selection = ComponentSelection(
            platform_id="arduino_uno",
            items=[SelectionItem(
                instance_id="dht_1",
                component_id="sensor.dht22",
                matched_capabilities=["temperature_sensing"],
            )],
        )

        ctx = make_ctx()
        ctx.component_registry = comp_registry
        ctx.platform_registry = plat_registry
        ctx.set_artifact("design_spec", ArtifactPayload(
            artifact_type="design_spec", content_json=spec.model_dump(), content_hash="s",
        ))
        ctx.set_artifact("component_selection", ArtifactPayload(
            artifact_type="component_selection", content_json=selection.model_dump(), content_hash="c",
        ))

        stage = ConstraintValidationStage()
        result = stage.execute(ctx)
        assert result.status == StageStatus.SUCCEEDED
        assert "pin_allocation" in result.outputs


class TestFullPipelineIntegration:
    def test_three_stage_pipeline(self, comp_registry, plat_registry):
        """Run requirement -> resolution -> constraint as a pipeline."""
        from mcu_worker.domain.models.design_spec import CapabilityRequirement, DesignSpec
        from mcu_worker.domain.models.stage import ArtifactPayload

        # Pre-seed a DesignSpec artifact (simulating LLM output)
        spec = DesignSpec(
            title="Watering",
            description="Auto water plants",
            capabilities=[
                CapabilityRequirement(capability="soil_moisture_sensing"),
                CapabilityRequirement(capability="water_pump_control"),
            ],
        )

        definition = PipelineDefinition(stages=[
            ComponentResolutionStage(),
            ConstraintValidationStage(),
        ])

        ctx = make_ctx()
        ctx.component_registry = comp_registry
        ctx.platform_registry = plat_registry
        ctx.set_artifact("design_spec", ArtifactPayload(
            artifact_type="design_spec", content_json=spec.model_dump(), content_hash="s",
        ))

        runtime = PipelineRuntime(definition)
        result = runtime.execute(ctx)

        assert result.status == StageStatus.SUCCEEDED
        assert "component_resolution" in result.completed_stages
        assert "constraint_validation" in result.completed_stages
        assert "component_selection" in ctx.artifacts
        assert "pin_allocation" in ctx.artifacts
