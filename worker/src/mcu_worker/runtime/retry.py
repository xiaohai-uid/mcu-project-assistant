"""RabbitMQ queue declarations for V2 reliability.

Queues:
- design.run: main job queue
- design.run.retry.5s: delayed retry (5 second TTL)
- design.run.dlq: dead letter queue for exhausted retries

Message body: ONLY {run_id, delivery_attempt?}
"""

from __future__ import annotations

QUEUE_DESIGN_RUN = "design.run"
QUEUE_DESIGN_RUN_RETRY = "design.run.retry.5s"
QUEUE_DESIGN_RUN_DLQ = "design.run.dlq"

MAX_SYSTEM_RETRIES = 3
RETRY_TTL_MS = 5000


def declare_queues(channel) -> None:
    """Declare all V2 queues with proper DLX configuration.

    Args:
        channel: pika channel object.
    """
    # DLQ: final resting place for failed messages
    channel.queue_declare(queue=QUEUE_DESIGN_RUN_DLQ, durable=True)

    # Retry queue: messages expire after TTL and route back to main queue
    channel.queue_declare(
        queue=QUEUE_DESIGN_RUN_RETRY,
        durable=True,
        arguments={
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": QUEUE_DESIGN_RUN,
            "x-message-ttl": RETRY_TTL_MS,
        },
    )

    # Main queue: failed messages go to retry (or DLQ after max attempts)
    channel.queue_declare(
        queue=QUEUE_DESIGN_RUN,
        durable=True,
        arguments={
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": QUEUE_DESIGN_RUN_RETRY,
        },
    )


def should_retry(delivery_attempt: int) -> bool:
    """Determine if a message should be retried or sent to DLQ."""
    return delivery_attempt <= MAX_SYSTEM_RETRIES
