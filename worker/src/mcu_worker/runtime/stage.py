"""Stage protocol: the interface every pipeline stage must implement."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from mcu_worker.domain.models.stage import StageResult
    from mcu_worker.runtime.context import RunContext


@runtime_checkable
class Stage(Protocol):
    """Protocol for a pipeline stage.

    Each stage:
    - Has a stable name and version
    - Receives a RunContext with upstream artifacts and adapters
    - Returns a StageResult (succeeded / waiting_for_user / failed)
    - Does NOT publish to RabbitMQ or decide the next stage
    """

    @property
    def name(self) -> str:
        """Stable stage name, e.g. 'requirement_parse'."""
        ...

    @property
    def version(self) -> str:
        """Stage version for idempotency key computation."""
        ...

    def execute(self, ctx: "RunContext") -> "StageResult":
        """Execute the stage logic."""
        ...
