"""ConstraintValidation Stage: validates hardware feasibility.

Runs the ConstraintEngine and produces PinAllocation.
If infeasible, the pipeline stops — no firmware generation.
"""

from __future__ import annotations

from mcu_worker.domain.constraints.engine import ConstraintEngine
from mcu_worker.domain.models.component_selection import ComponentSelection
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


class ConstraintValidationStage:
    """Validates component selection against platform constraints."""

    @property
    def name(self) -> str:
        return "constraint_validation"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        # Get upstream artifacts
        sel_artifact = ctx.get_artifact("component_selection")

        if not sel_artifact or not sel_artifact.content_json:
            return StageResult(status=StageStatus.FAILED, error_code="MISSING_SELECTION")

        selection = ComponentSelection.model_validate(sel_artifact.content_json)
        platform_id = selection.platform_id

        # Get platform
        platform_registry = ctx.platform_registry
        if not platform_registry:
            return StageResult(status=StageStatus.FAILED, error_code="NO_PLATFORM_REGISTRY")

        platform = platform_registry.get(platform_id)

        # Resolve component definitions
        comp_registry = ctx.component_registry
        components = []
        for item in selection.items:
            comp_def = comp_registry.get(item.component_id)
            components.append((item.instance_id, comp_def))

        # Run constraint engine
        engine = ConstraintEngine(platform, components)
        result = engine.validate()

        if not result.is_feasible:
            return StageResult(
                status=StageStatus.FAILED,
                error_code="CONSTRAINT_VIOLATION",
                warnings=result.diagnostics,
            )

        # Output pin allocation
        allocation = result.pin_allocation
        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "pin_allocation": ArtifactPayload(
                    artifact_type="component_selection",
                    content_json=allocation.model_dump() if allocation else {},
                    content_hash=f"pins_{ctx.run_id}",
                )
            },
            warnings=result.warnings,
        )
