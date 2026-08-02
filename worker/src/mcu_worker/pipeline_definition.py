"""V2 Pipeline Definition: the canonical stage ordering.

This is the single source of truth for which stages run and in what order.
PipelineRuntime executes these stages sequentially.

V2 Main Pipeline:
  ClarificationGate (inside RequirementParse)
  -> RequirementParse        -> DesignSpec
  -> ComponentResolution     -> ComponentSelection
  -> ConstraintValidation    -> PinAllocation
  -> FirmwareGeneration      -> FirmwareSource
  -> CompileValidation       -> CompileResult
  -> CircuitGeneration       -> CircuitIR
  -> ArtifactRender          -> SVG / BOM / Checklist (future)
"""

from __future__ import annotations

from mcu_worker.runtime.pipeline import PipelineDefinition
from mcu_worker.stages.artifact_render import ArtifactRenderStage
from mcu_worker.stages.circuit_generation import CircuitGenerationStage
from mcu_worker.stages.compile_validation import CompileValidationStage
from mcu_worker.stages.component_resolution import ComponentResolutionStage
from mcu_worker.stages.constraint_validation import ConstraintValidationStage
from mcu_worker.stages.firmware_generation import FirmwareGenerationStage
from mcu_worker.stages.requirement import RequirementParseStage


def build_v2_pipeline() -> PipelineDefinition:
    """Construct the V2 pipeline with all stages in canonical order."""
    return PipelineDefinition(
        version="2.0",
        stages=[
            RequirementParseStage(),
            ComponentResolutionStage(),
            ConstraintValidationStage(),
            FirmwareGenerationStage(),
            CompileValidationStage(),
            CircuitGenerationStage(),
            ArtifactRenderStage(),
        ],
    )


# Canonical stage order for reference
V2_STAGE_ORDER = [
    "requirement_parse",
    "component_resolution",
    "constraint_validation",
    "firmware_generation",
    "compile_validation",
    "circuit_generation",
    "artifact_render",
]
