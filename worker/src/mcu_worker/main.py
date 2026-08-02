"""Design Worker entry point.

Consumes design.run jobs from RabbitMQ and executes the V2 pipeline.
Connects to PostgreSQL for persistence and RabbitMQ for job consumption.
"""

from __future__ import annotations

import logging
import os
import sys

import pika

from mcu_worker.domain.components.registry import ComponentRegistry
from mcu_worker.domain.platforms.registry import PlatformRegistry
from mcu_worker.jobs.consumer import QUEUE_DESIGN_RUN, DesignRunConsumer
from mcu_worker.persistence.pg_repository import PgStageRunRepository
from mcu_worker.adapters.compiler.arduino_cli import ArduinoCLICompiler
from mcu_worker.pipeline_definition import build_v2_pipeline
from mcu_worker.runtime.context import RunContext
from mcu_worker.runtime.pipeline import PipelineRuntime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def create_pipeline_executor(database_url: str):
    """Create a pipeline executor with all dependencies wired."""
    component_registry = ComponentRegistry()
    platform_registry = PlatformRegistry()
    pipeline = build_v2_pipeline()
    repository = PgStageRunRepository(database_url)

    logger.info(
        "Worker initialized: %d components, %d platforms, %d stages",
        component_registry.count,
        platform_registry.count,
        len(pipeline.stages),
    )

    def execute_run(run_id: str) -> None:
        """Execute a full pipeline for a given run_id."""
        logger.info("Executing run: %s", run_id)

        # Load run input from database
        run_data = repository.load_run(run_id)
        if run_data is None:
            logger.error("Run %s not found in database", run_id)
            return

        ctx = RunContext(
            run_id=run_id,
            design_draft_id=run_data.get("design_draft_id", ""),
            input_snapshot=run_data.get("input_snapshot", {}),
        )
        ctx.component_registry = component_registry
        ctx.platform_registry = platform_registry
        ctx.compiler = ArduinoCLICompiler(fqbn="arduino:avr:uno")

        runtime = PipelineRuntime(pipeline, repository=repository)
        result = runtime.execute(ctx)

        # Update run status in database
        repository.update_run_status(
            run_id=run_id,
            status=result.status.value,
            current_stage=result.current_stage,
            error_code=result.error_code,
            error_message=result.error_message,
        )

        logger.info(
            "Run %s completed: status=%s stages=%s",
            run_id, result.status, result.completed_stages,
        )

    return execute_run


def main() -> None:
    """Start the design worker consumer loop."""
    logger.info("MCU Design Worker V2 starting...")

    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://mcu:mcu_secret@localhost:5432/mcu_assistant",
    )
    rabbitmq_url = os.environ.get(
        "RABBITMQ_URL",
        "amqp://mcu_service:mcu_mq_secret@localhost:5672/",
    )

    executor = create_pipeline_executor(database_url)
    consumer = DesignRunConsumer(pipeline_executor=executor)

    # Parse RabbitMQ URL for pika
    params = pika.URLParameters(rabbitmq_url)
    params.heartbeat = 600
    params.blocked_connection_timeout = 300

    logger.info("Connecting to RabbitMQ: %s", rabbitmq_url.split("@")[-1])

    # Retry connection loop
    import time
    max_connect_attempts = 10
    for attempt in range(1, max_connect_attempts + 1):
        try:
            connection = pika.BlockingConnection(params)
            break
        except pika.exceptions.AMQPConnectionError as e:
            if attempt == max_connect_attempts:
                logger.error("Cannot connect to RabbitMQ after %d attempts: %s", attempt, e)
                sys.exit(1)
            logger.warning(
                "RabbitMQ connection attempt %d/%d failed, retrying in 5s...",
                attempt, max_connect_attempts,
            )
            time.sleep(5)

    channel = connection.channel()

    # Declare queues (idempotent)
    from mcu_worker.runtime.retry import declare_queues
    declare_queues(channel)

    # Set prefetch
    channel.basic_qos(prefetch_count=1)

    def on_message(ch, method, properties, body):
        """Handle incoming message."""
        ack = consumer.handle_message(body)
        if ack:
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            # Nack without requeue -> goes to DLQ via DLX
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    channel.basic_consume(queue=QUEUE_DESIGN_RUN, on_message_callback=on_message)

    logger.info("Worker ready. Consuming from '%s' queue. Waiting for jobs...", QUEUE_DESIGN_RUN)

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        channel.stop_consuming()
    finally:
        connection.close()


if __name__ == "__main__":
    main()
