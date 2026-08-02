"""V2 canonical domain models.

All cross-module business objects are defined here.
Every schema includes schema_version for forward compatibility.
"""

from mcu_worker.domain.models.circuit_ir import (
    CircuitIR,
    ComponentInstance,
    Net,
    NetEndpoint,
    PinAllocationEntry,
    PowerDomain,
)
from mcu_worker.domain.models.common import Diagnostic, DiagnosticSeverity, DiagnosticSource
from mcu_worker.domain.models.compile_result import CompileDiagnostic, CompileResult
from mcu_worker.domain.models.component_selection import ComponentSelection, SelectionItem
from mcu_worker.domain.models.design_spec import (
    Budget,
    CapabilityRequirement,
    Clarification,
    DesignSpec,
    ExperienceLevel,
    PowerConstraints,
)
from mcu_worker.domain.models.pin_allocation import PinAllocation, PinAssignment, SharedBus
from mcu_worker.domain.models.stage import ArtifactPayload, StageResult, StageStatus

__all__ = [
    "Diagnostic",
    "DiagnosticSeverity",
    "DiagnosticSource",
    "Budget",
    "CapabilityRequirement",
    "Clarification",
    "DesignSpec",
    "ExperienceLevel",
    "PowerConstraints",
    "ArtifactPayload",
    "StageResult",
    "StageStatus",
    "CompileDiagnostic",
    "CompileResult",
    "CircuitIR",
    "ComponentInstance",
    "Net",
    "NetEndpoint",
    "PinAllocationEntry",
    "PowerDomain",
    "ComponentSelection",
    "SelectionItem",
    "PinAllocation",
    "PinAssignment",
    "SharedBus",
]
