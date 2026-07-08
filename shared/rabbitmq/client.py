import json
import pika
from typing import Callable, Optional


class RabbitMQClient:
    def __init__(self, url: str = "amqp://guest:guest@localhost:5672"):
        self.url = url
        self.connection: Optional[pika.BlockingConnection] = None
        self.channel: Optional[pika.adapters.blocking_connection.BlockingChannel] = None

    def connect(self):
        params = pika.URLParameters(self.url)
        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()

    def declare_queue(self, queue_name: str):
        self.channel.queue_declare(queue=queue_name, durable=True)

    def publish(self, queue_name: str, message: dict):
        self.channel.basic_publish(
            exchange="",
            routing_key=queue_name,
            body=json.dumps(message),
            properties=pika.BasicProperties(delivery_mode=2),
        )

    def consume(self, queue_name: str, callback: Callable):
        self.channel.basic_consume(
            queue=queue_name, on_message_callback=callback, auto_ack=True
        )
        self.channel.start_consuming()

    def close(self):
        if self.connection:
            self.connection.close()
