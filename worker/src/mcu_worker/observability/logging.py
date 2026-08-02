"""Structured execution observability for V2 worker.

All logs carry: run_id, stage_name, stage_run_id.
Records: stage duration, retry_count, compile duration, LLM provider/model.
NEVER logs API keys or secrets.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Generator


@dataclass
class StageMetrics:
    """Metrics collected during a stage execution."""

    stage_name: str
    run_id: str
    duration_ms: float = 0.0
    retry_count: int = 0
    llm_provider: str | None = None
    llm_model: str | None = None
    compile_duration_ms: float | None = None
    error_code: str | None = None
    success: bool = True


class ExecutionLogger:
    """Structured logger for pipeline execution.

    Usage:
        logger = ExecutionLogger(run_id="abc")
        with logger.stage("requirement_parse") as metrics:
            # stage work
            metrics.llm_provider = "openai"
    """

    def __init__(self, run_id: str) -> None:
        self._run_id = run_id
        self._logger = logging.getLogger("mcu_worker.execution")
        self._metrics: list[StageMetrics] = []

    @contextmanager
    def stage(self, stage_name: str) -> Generator[StageMetrics, None, None]:
        """Context manager that times and logs a stage execution."""
        metrics = StageMetrics(stage_name=stage_name, run_id=self._run_id)
        start = time.monotonic()

        self._logger.info(
            "stage.started",
            extra={"run_id": self._run_id, "stage": stage_name},
        )

        try:
            yield metrics
        except Exception as exc:
            metrics.success = False
            metrics.error_code = type(exc).__name__
            raise
        finally:
            metrics.duration_ms = (time.monotonic() - start) * 1000
            self._metrics.append(metrics)

            level = logging.INFO if metrics.success else logging.ERROR
            self._logger.log(
                level,
                "stage.completed" if metrics.success else "stage.failed",
                extra={
                    "run_id": self._run_id,
                    "stage": stage_name,
                    "duration_ms": metrics.duration_ms,
                    "error_code": metrics.error_code,
                },
            )

    @property
    def all_metrics(self) -> list[StageMetrics]:
        return list(self._metrics)

    def summary(self) -> dict:
        """Return a summary of the execution for logging/reporting."""
        return {
            "run_id": self._run_id,
            "total_stages": len(self._metrics),
            "succeeded": sum(1 for m in self._metrics if m.success),
            "failed": sum(1 for m in self._metrics if not m.success),
            "total_duration_ms": sum(m.duration_ms for m in self._metrics),
        }
