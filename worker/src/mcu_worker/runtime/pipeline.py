"""PipelineRuntime: executes stages in defined order with persistence.

The PipelineRuntime is the ONLY object that decides:
- Stage order
- Whether to retry
- Whether to resume
- Whether to stop on cancellation

Stages do NOT publish to queues or invoke other stages.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from mcu_worker.domain.models.stage import StageResult, StageStatus
from mcu_worker.runtime.context import RunContext
from mcu_worker.runtime.stage import Stage

logger = logging.getLogger(__name__)


@dataclass
class PipelineDefinition:
    """Ordered list of stages that form the V2 pipeline."""

    stages: list[Stage] = field(default_factory=list)
    version: str = "2.0"

    @property
    def stage_names(self) -> list[str]:
        return [s.name for s in self.stages]


@dataclass
class PipelineResult:
    """Final result of a pipeline execution."""

    run_id: str
    status: StageStatus
    current_stage: str | None = None
    completed_stages: list[str] = field(default_factory=list)
    failed_stage: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class StageRunRepository:
    """Interface for persisting stage run state.

    Production implementation uses PostgreSQL.
    Tests use FakeStageRunRepository.
    """

    def create_stage_run(
        self, run_id: str, stage_name: str, stage_version: str, attempt: int
    ) -> str:
        """Create a stage_run record, return its id."""
        raise NotImplementedError

    def mark_running(self, stage_run_id: str) -> None:
        raise NotImplementedError

    def mark_succeeded(self, stage_run_id: str, output_json: dict | None) -> None:
        raise NotImplementedError

    def mark_failed(
        self, stage_run_id: str, error_code: str | None, error_message: str | None
    ) -> None:
        raise NotImplementedError

    def find_succeeded_by_idempotency_key(self, key: str) -> dict | None:
        """Return output_json if a succeeded stage_run with this key exists."""
        raise NotImplementedError


class FakeStageRunRepository(StageRunRepository):
    """In-memory fake for testing."""

    def __init__(self) -> None:
        self.stage_runs: list[dict] = []
        self._counter = 0

    def create_stage_run(
        self, run_id: str, stage_name: str, stage_version: str, attempt: int
    ) -> str:
        self._counter += 1
        stage_run_id = f"sr_{self._counter}"
        self.stage_runs.append({
            "id": stage_run_id,
            "run_id": run_id,
            "stage_name": stage_name,
            "stage_version": stage_version,
            "attempt": attempt,
            "status": "pending",
            "output_json": None,
        })
        return stage_run_id

    def mark_running(self, stage_run_id: str) -> None:
        for sr in self.stage_runs:
            if sr["id"] == stage_run_id:
                sr["status"] = "running"

    def mark_succeeded(self, stage_run_id: str, output_json: dict | None) -> None:
        for sr in self.stage_runs:
            if sr["id"] == stage_run_id:
                sr["status"] = "succeeded"
                sr["output_json"] = output_json

    def mark_failed(
        self, stage_run_id: str, error_code: str | None, error_message: str | None
    ) -> None:
        for sr in self.stage_runs:
            if sr["id"] == stage_run_id:
                sr["status"] = "failed"
                sr["error_code"] = error_code
                sr["error_message"] = error_message

    def find_succeeded_by_idempotency_key(self, key: str) -> dict | None:
        return None


class PipelineRuntime:
    """Executes a pipeline definition against a RunContext.

    Responsibilities:
    - Execute stages in order
    - Check cancellation at each stage boundary
    - Persist stage run state via repository
    - Stop on failure or waiting_for_user
    - Accumulate artifacts in context
    """

    def __init__(
        self,
        definition: PipelineDefinition,
        repository: StageRunRepository | None = None,
    ) -> None:
        self._definition = definition
        self._repo = repository or FakeStageRunRepository()

    def execute(self, ctx: RunContext) -> PipelineResult:
        """Run the full pipeline."""
        completed: list[str] = []

        for stage in self._definition.stages:
            # Cancellation check at stage boundary
            if ctx.is_cancelled:
                logger.info("Run %s cancelled before stage %s", ctx.run_id, stage.name)
                return PipelineResult(
                    run_id=ctx.run_id,
                    status=StageStatus.FAILED,
                    current_stage=stage.name,
                    completed_stages=completed,
                    error_code="CANCELLED",
                    error_message="Run cancelled by user",
                )

            # Create stage run record
            stage_run_id = self._repo.create_stage_run(
                run_id=ctx.run_id,
                stage_name=stage.name,
                stage_version=stage.version,
                attempt=1,
            )
            self._repo.mark_running(stage_run_id)

            logger.info("Run %s: executing stage %s", ctx.run_id, stage.name)

            try:
                result: StageResult = stage.execute(ctx)
            except Exception as exc:
                logger.exception("Stage %s raised unexpected exception", stage.name)
                self._repo.mark_failed(stage_run_id, "UNEXPECTED_ERROR", str(exc))
                return PipelineResult(
                    run_id=ctx.run_id,
                    status=StageStatus.FAILED,
                    current_stage=stage.name,
                    completed_stages=completed,
                    failed_stage=stage.name,
                    error_code="UNEXPECTED_ERROR",
                    error_message=str(exc),
                )

            if result.status == StageStatus.SUCCEEDED:
                # Accumulate artifacts
                for key, payload in result.outputs.items():
                    ctx.set_artifact(key, payload)
                self._repo.mark_succeeded(stage_run_id, None)
                completed.append(stage.name)
                logger.info("Run %s: stage %s succeeded", ctx.run_id, stage.name)

            elif result.status == StageStatus.WAITING_FOR_USER:
                self._repo.mark_succeeded(stage_run_id, None)
                completed.append(stage.name)
                logger.info("Run %s: stage %s waiting for user", ctx.run_id, stage.name)
                return PipelineResult(
                    run_id=ctx.run_id,
                    status=StageStatus.WAITING_FOR_USER,
                    current_stage=stage.name,
                    completed_stages=completed,
                )

            else:  # FAILED
                self._repo.mark_failed(
                    stage_run_id, result.error_code, "Stage failed"
                )
                return PipelineResult(
                    run_id=ctx.run_id,
                    status=StageStatus.FAILED,
                    current_stage=stage.name,
                    completed_stages=completed,
                    failed_stage=stage.name,
                    error_code=result.error_code,
                )

        # All stages succeeded
        return PipelineResult(
            run_id=ctx.run_id,
            status=StageStatus.SUCCEEDED,
            completed_stages=completed,
        )
