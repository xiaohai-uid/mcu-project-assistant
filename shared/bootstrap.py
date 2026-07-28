import os
import threading
from dataclasses import dataclass, field
from typing import Callable

from fastapi import FastAPI
import uvicorn

from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues as q
from shared.logging_config import setup_logging


@dataclass
class QueueBinding:
    queue: str
    callback: Callable
    auto_ack: bool = False
    declare: bool = True


def create_health_app(service_name: str) -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok", "service": service_name}

    return app


def start_health_server(app: FastAPI, port: int) -> threading.Thread:
    t = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "0.0.0.0", "port": port, "log_level": "warning"},
        daemon=True,
    )
    t.start()
    return t


def make_rabbitmq_client() -> RabbitMQClient:
    return RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def run_service(
    *,
    name: str,
    port: int,
    bindings: list[QueueBinding],
    client: RabbitMQClient | None = None,
    before_consume: Callable[[], None] | None = None,
    declare_queues: list[str] | None = None,
) -> None:
    health_app = create_health_app(f"{name}-service")
    start_health_server(health_app, port)

    if client is None:
        client = make_rabbitmq_client()

    client.connect()

    for qname in (declare_queues or []):
        client.declare_queue(qname)

    for b in bindings:
        if b.declare:
            client.declare_queue(b.queue)
        client.channel.basic_consume(
            queue=b.queue,
            on_message_callback=b.callback,
            auto_ack=b.auto_ack,
        )

    if before_consume:
        before_consume()

    logger = setup_logging(name)
    logger.info(f"{name} service started. Waiting for messages...")
    client.channel.start_consuming()
