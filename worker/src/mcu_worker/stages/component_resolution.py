"""ComponentResolution Stage: resolves capabilities to concrete components.

Components come from the validated ComponentRegistry.
LLM is only used for ranking when multiple candidates exist.
LLM cannot return a component id not in the Registry.
"""

from __future__ import annotations

from mcu_worker.domain.models.common import Diagnostic, DiagnosticSeverity, DiagnosticSource
from mcu_worker.domain.models.component_selection import ComponentSelection, SelectionItem
from mcu_worker.domain.models.design_spec import DesignSpec
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus
from mcu_worker.runtime.context import RunContext


class ComponentResolutionStage:
    """Resolves DesignSpec capabilities to ComponentSelection via Registry."""

    @property
    def name(self) -> str:
        return "component_resolution"

    @property
    def version(self) -> str:
        return "1"

    def execute(self, ctx: RunContext) -> StageResult:
        # Get upstream DesignSpec
        spec_artifact = ctx.get_artifact("design_spec")
        if not spec_artifact or not spec_artifact.content_json:
            return StageResult(
                status=StageStatus.FAILED,
                error_code="MISSING_DESIGN_SPEC",
            )

        spec = DesignSpec.model_validate(spec_artifact.content_json)
        registry = ctx.component_registry

        if not registry:
            return StageResult(
                status=StageStatus.FAILED,
                error_code="NO_COMPONENT_REGISTRY",
            )

        items: list[SelectionItem] = []
        unresolved: list[str] = []
        warnings: list[Diagnostic] = []
        instance_counter = 0

        for cap_req in spec.capabilities:
            candidates = registry.find_by_capability(
                cap_req.capability, platform_id=spec.target_platform
            )

            if not candidates:
                unresolved.append(cap_req.capability)
                warnings.append(Diagnostic(
                    code="UNRESOLVED_CAPABILITY",
                    severity=DiagnosticSeverity.WARNING,
                    message=f"No component found for capability: {cap_req.capability}",
                    source=DiagnosticSource.DOMAIN,
                ))
                continue

            # Check user constraints for explicit component preference
            preferred = self._find_preferred(spec, candidates)
            selected = preferred or candidates[0]

            for _ in range(cap_req.quantity):
                instance_counter += 1
                items.append(SelectionItem(
                    instance_id=f"{selected.firmware.var_name.lower()}_{instance_counter}",
                    component_id=selected.id,
                    quantity=1,
                    matched_capabilities=[cap_req.capability],
                    selection_reason=(
                        "User specified" if preferred
                        else "First registry match"
                    ),
                ))

        selection = ComponentSelection(
            platform_id=spec.target_platform,
            items=items,
            unresolved_capabilities=unresolved,
            warnings=warnings,
        )

        return StageResult(
            status=StageStatus.SUCCEEDED,
            outputs={
                "component_selection": ArtifactPayload(
                    artifact_type="component_selection",
                    content_json=selection.model_dump(),
                    content_hash=f"sel_{ctx.run_id}",
                )
            },
            warnings=warnings,
        )

    def _find_preferred(self, spec: DesignSpec, candidates):
        """Check if user constraints specify a preferred component."""
        for constraint in spec.user_constraints:
            constraint_lower = constraint.lower()
            for comp in candidates:
                if comp.display_name.lower() in constraint_lower:
                    return comp
                for alias in comp.aliases:
                    if alias.lower() in constraint_lower:
                        return comp
        return None
