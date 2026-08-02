"""CircuitGeneration Stage: produces CircuitIR from validated design."""

from __future__ import annotations

from mcu_worker.domain.circuit.generator import CircuitGenerator
from mcu_worker.domain.models.component_selection import ComponentSelection
from mcu_worker.domain.models.pin_allocation import PinAllocation
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


class CircuitGenerationStage:
    """Generates CircuitIR from ComponentSelection + PinAllocation."""

    @property
    def name(self) -> str:
        return "circuit_generation"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        sel_artifact = ctx.get_artifact("component_selection")
        pin_artifact = ctx.get_artifact("pin_allocation")

        if not sel_artifact or not sel_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_SELECTION")
        if not pin_artifact or not pin_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_PINS")

        selection = ComponentSelection.model_validate(sel_artifact.content_json)
        allocation = PinAllocation.model_validate(pin_artifact.content_json)

        generator = CircuitGenerator(ctx.component_registry)
        circuit_ir = generator.generate(selection, allocation)

        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "circuit_ir": ArtifactPayload(
                    artifact_type="circuit_ir",
                    content_json=circuit_ir.model_dump(),
                    content_hash=f"circuit_{ctx.run_id}",
                )
            },
        )
