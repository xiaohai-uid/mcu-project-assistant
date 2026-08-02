"""RunContext: provides stages with validated upstream data and adapters."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from mcu_worker.domain.models.stage import ArtifactPayload


@dataclass
class RunContext:
    """Execution context passed to each Stage.

    Contains:
    - run_id and design_draft_id for persistence
    - Accumulated artifacts from upstream stages
    - Access to registries and adapters (injected)
    - Cancellation check callback
    """

    run_id: str
    design_draft_id: str
    input_snapshot: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, ArtifactPayload] = field(default_factory=dict)
    cancel_requested: bool = False

    # Injected dependencies (set by PipelineRuntime before execution)
    component_registry: Any = None
    platform_registry: Any = None
    llm_provider: Any = None
    persistence: Any = None

    def get_artifact(self, artifact_type: str) -> ArtifactPayload | None:
        """Get an upstream artifact by type."""
        return self.artifacts.get(artifact_type)

    def set_artifact(self, key: str, payload: ArtifactPayload) -> None:
        """Store an artifact produced by the current stage."""
        self.artifacts[key] = payload

    @property
    def is_cancelled(self) -> bool:
        """Check if cancellation has been requested."""
        return self.cancel_requested
