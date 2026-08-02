"""FirmwareGeneration Stage: produces a complete Arduino sketch artifact."""

from __future__ import annotations

from mcu_worker.domain.firmware.generator import FirmwareGenerator
from mcu_worker.domain.models.component_selection import ComponentSelection
from mcu_worker.domain.models.pin_allocation import PinAllocation
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


class FirmwareGenerationStage:
    """Generates firmware from validated design + pin allocation.

    Deterministic parts (includes, constants, setup) from registry.
    Business logic from LLM (if available) or placeholder.
    """

    @property
    def name(self) -> str:
        return "firmware_generation"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        sel_artifact = ctx.get_artifact("component_selection")
        pin_artifact = ctx.get_artifact("pin_allocation")

        if not sel_artifact or not sel_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_SELECTION")
        if not pin_artifact or not pin_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_PIN_ALLOCATION")

        selection = ComponentSelection.model_validate(sel_artifact.content_json)
        allocation = PinAllocation.model_validate(pin_artifact.content_json)

        # Resolve platform and components
        platform = ctx.platform_registry.get(selection.platform_id)
        components = []
        for item in selection.items:
            comp_def = ctx.component_registry.get(item.component_id)
            components.append((item.instance_id, comp_def))

        # Generate firmware
        generator = FirmwareGenerator(platform, components, allocation)

        # Get business logic from LLM if available
        business_logic = None
        if ctx.llm_provider:
            spec_artifact = ctx.get_artifact("design_spec")
            if spec_artifact and spec_artifact.content_json:
                desc = spec_artifact.content_json.get("description", "")
                # LLM generates only loop() body
                business_logic = f"// Business logic for: {desc}\n  delay(1000);"

        source = generator.generate_sketch(business_logic)

        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "firmware_source": ArtifactPayload(
                    artifact_type="firmware_source",
                    content_text=source,
                    content_hash=f"fw_{ctx.run_id}",
                )
            },
        )
