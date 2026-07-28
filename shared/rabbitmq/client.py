import json
import time
import logging
import pika
from typing import Callable, Optional

logger = logging.getLogger("rabbitmq")

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds


class RabbitMQClient:
    """Reliable RabbitMQ client with explicit ack, DLQ, and retry support."""

    def __init__(self, url: str = "amqp://guest:guest@localhost:5672"):
        self.url = url
        self.connection: Optional[pika.BlockingConnection] = None
        self.channel: Optional[pika.adapters.blocking_connection.BlockingChannel] = None
        self._processed_ids: set[str] = set()  # Idempotency tracking
        self._max_processed_cache = 10000

    def connect(self):
        params = pika.URLParameters(self.url)
        params.heartbeat = 600
        params.blocked_connection_timeout = 300
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()
        # Fair dispatch: only 1 unacked message per consumer
        self.channel.basic_qos(prefetch_count=1)

    def declare_queue(self, queue_name: str, with_dlq: bool = True):
        """Declare a durable queue, optionally with a dead letter queue."""
        if with_dlq:
            dlq_name = f"{queue_name}.dlq"
            # Declare DLX (dead letter exchange)
            self.channel.exchange_declare(
                exchange=f"{queue_name}.dlx",
                exchange_type="direct",
                durable=True,
            )
            # Declare DLQ bound to DLX
            self.channel.queue_declare(queue=dlq_name, durable=True)
            self.channel.queue_bind(
                queue=dlq_name,
                exchange=f"{queue_name}.dlx",
                routing_key=queue_name,
            )
            # Main queue with DLX policy
            self.channel.queue_declare(
                queue=queue_name,
                durable=True,
                arguments={
                    "x-dead-letter-exchange": f"{queue_name}.dlx",
                    "x-dead-letter-routing-key": queue_name,
                },
            )
        else:
            self.channel.queue_declare(queue=queue_name, durable=True)

    def publish(self, queue_name: str, message: dict):
        """Publish a persistent message with message_id for idempotency."""
        msg_id = message.get("designDraftId", "") + f":{queue_name}:{time.time_ns()}"
        self.channel.basic_publish(
            exchange="",
            routing_key=queue_name,
            body=json.dumps(message),
            properties=pika.BasicProperties(
                delivery_mode=2,  # persistent
                message_id=msg_id,
                content_type="application/json",
                timestamp=int(time.time()),
            ),
        )

    def consume(self, queue_name: str, callback: Callable):
        """Consume with explicit ack (auto_ack=False). Wraps callback with retry + idempotency."""
        def _wrapper(ch, method, properties, body):
            msg_id = properties.message_id or ""

            # Idempotency: skip already-processed messages
            if msg_id and msg_id in self._processed_ids:
                logger.info(f"[skip] Duplicate message {msg_id}")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            # Retry logic
            retries = 0
            while retries <= MAX_RETRIES:
                try:
                    callback(ch, method, properties, body)
                    # Mark as processed for idempotency
                    if msg_id:
                        self._processed_ids.add(msg_id)
                        # Evict old entries if cache too large
                        if len(self._processed_ids) > self._max_processed_cache:
                            self._processed_ids.clear()
                    return  # callback is responsible for ack
                except Exception as e:
                    retries += 1
                    if retries > MAX_RETRIES:
                        logger.error(
                            f"[nack] Message failed after {MAX_RETRIES} retries: {e}"
                        )
                        # Nack without requeue -> goes to DLQ
                        ch.basic_nack(
                            delivery_tag=method.delivery_tag, requeue=False
                        )
                        return
                    logger.warning(
                        f"[retry {retries}/{MAX_RETRIES}] {e}"
                    )
                    time.sleep(RETRY_DELAY * retries)

        self.channel.basic_consume(
            queue=queue_name, on_message_callback=_wrapper, auto_ack=False
        )
        logger.info(f"Consuming queue: {queue_name} (auto_ack=False, DLQ enabled)")
        self.channel.start_consuming()

    def close(self):
        if self.connection and not self.connection.is_closed:
            self.connection.close()
