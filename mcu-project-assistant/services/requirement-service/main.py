import os
import json
import httpx
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def call_llm(model_config: dict, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {model_config['apiKey']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model_config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    resp = httpx.post(model_config["endpoint"], headers=headers, json=body, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def analyze_requirement(ch, method, _properties, body):
    message = json.loads(body)
    description = message["description"]
    model_config = message["modelConfig"]

    prompt = f"""Analyze this microcontroller project description and extract requirements.
Return JSON with: title, description, functionality (list), io (inputDevices, outputDevices),
communication (protocols, remoteControl), powerSupply, targetPlatform.

Description: {description}"""

    result = call_llm(model_config, prompt)
    client.publish(queues.REQUIREMENT_OUTPUT, {
        "designDraftId": message["designDraftId"],
        "requirement": json.loads(result),
        "modelUsed": model_config["level"],
    })
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.REQUIREMENT_INPUT)
    client.declare_queue(queues.REQUIREMENT_OUTPUT)
    client.consume(queues.REQUIREMENT_INPUT, analyze_requirement)


if __name__ == "__main__":
    main()
