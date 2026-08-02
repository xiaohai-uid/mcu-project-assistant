"""RabbitMQ consumer for design.run jobs.

Message body is ONLY {run_id, delivery_attempt?}.
No business payload in the message — all state is in PostgreSQL.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

QUEUE_DESIGN_RUN = "design.run"
QUEUE_DESIGN_RUN_RETRY = "design.run.retry.5s"
QUEUE_DESIGN_RUN_DLQ = "design.run.dlq"
MAX_SYSTEM_RETRIES = 3


@dataclass
class RunJobMessage:
    """Parsed message from design.run queue."""

    run_id: str
    delivery_attempt: int = 1

    @classmethod
    def from_body(cls, body: bytes) -> "RunJobMessage":
        """Parse and validate message body.

        Only accepts {run_id, delivery_attempt?}.
        Rejects messages with business payload.
        """
        try:
            data = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"Invalid message body: {e}") from e

        if not isinstance(data, dict):
            raise ValueError("Message body must be a JSON object")

        run_id = data.get("run_id")
        if not run_id or not isinstance(run_id, str):
            raise ValueError("Message must contain a string 'run_id'")

        # Reject legacy-style messages with business payload
        forbidden_keys = {"requirement", "components", "code", "description", "modelConfig"}
        present_forbidden = forbidden_keys & set(data.keys())
        if present_forbidden:
            raise ValueError(
                f"Message contains forbidden business payload keys: {present_forbidden}. "
                f"V2 messages must only contain run_id."
            )

        attempt = data.get("delivery_attempt", 1)
        return cls(run_id=run_id, delivery_attempt=int(attempt))


class DesignRunConsumer:
    """Consumes design.run jobs and dispatches to PipelineRuntime.

    This is the entry point for the V2 worker.
    Full RabbitMQ connection is wired in Phase 8 (reliability).
    """

    def __init__(self, pipeline_executor=None):
        """
        Args:
            pipeline_executor: callable(run_id: str) -> PipelineResult
        """
        self._executor = pipeline_executor

    def handle_message(self, body: bytes) -> bool:
        """Process a single message. Returns True if ack, False if nack/requeue.

        Args:
            body: Raw message body from RabbitMQ.
        """
        try:
            msg = RunJobMessage.from_body(body)
        except ValueError as e:
            logger.error("Rejecting invalid message: %s", e)
            return True  # ack (don't requeue poison messages)

        logger.info(
            "Received run job: run_id=%s attempt=%d",
            msg.run_id, msg.delivery_attempt,
        )

        if msg.delivery_attempt > MAX_SYSTEM_RETRIES:
            logger.error(
                "Run %s exceeded max retries (%d), sending to DLQ",
                msg.run_id, MAX_SYSTEM_RETRIES,
            )
            return False  # nack without requeue -> DLQ

        if self._executor:
            try:
                self._executor(msg.run_id)
            except Exception:
                logger.exception("Pipeline execution failed for run %s", msg.run_id)
                return False  # nack -> retry

        return True  # ack
