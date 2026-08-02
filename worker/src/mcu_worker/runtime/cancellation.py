"""Cancellation and Resume support for the pipeline runtime.

Cancellation:
- Each stage boundary checks cancel_requested_at from the database
- Compiler subprocess supports timeout/kill
- Once cancelled, no new stages are started

Resume:
- Unit of resume is Stage, not arbitrary code position
- On restart, pipeline continues from last succeeded stage
- If upstream input hash changed, downstream results are invalidated
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ResumePoint:
    """Describes where to resume a pipeline execution."""

    run_id: str
    last_succeeded_stage: str | None
    resume_from_index: int
    invalidated_stages: list[str]


class CancellationChecker:
    """Checks cancellation state at stage boundaries.

    In production, reads cancel_requested_at from PostgreSQL.
    In tests, uses a simple flag.
    """

    def __init__(self, check_fn=None):
        """
        Args:
            check_fn: callable(run_id: str) -> bool. Returns True if cancelled.
        """
        self._check_fn = check_fn

    def is_cancelled(self, run_id: str) -> bool:
        if self._check_fn:
            return self._check_fn(run_id)
        return False


def compute_resume_point(
    stage_names: list[str],
    succeeded_stages: list[str],
    invalidated: list[str] | None = None,
) -> ResumePoint:
    """Compute where to resume after a crash or explicit retry.

    Args:
        stage_names: Full ordered list of pipeline stage names.
        succeeded_stages: Stages that completed successfully.
        invalidated: Stages whose inputs changed and must be re-run.

    Returns:
        ResumePoint indicating the index to resume from.
    """
    invalidated_set = set(invalidated or [])

    # Find the first stage that needs to run
    resume_index = 0
    last_succeeded = None

    for i, name in enumerate(stage_names):
        if name in succeeded_stages and name not in invalidated_set:
            resume_index = i + 1
            last_succeeded = name
        else:
            break

    return ResumePoint(
        run_id="",  # Set by caller
        last_succeeded_stage=last_succeeded,
        resume_from_index=resume_index,
        invalidated_stages=list(invalidated_set),
    )
