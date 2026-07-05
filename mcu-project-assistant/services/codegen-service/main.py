import os
import json
import httpx
from jinja2 import Environment, FileSystemLoader
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))
env = Environment(loader=FileSystemLoader("templates"))


def call_llm(model_config: dict, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {model_config['apiKey']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model_config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    resp = httpx.post(model_config["endpoint"], headers=headers, json=body, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def generate_code(ch, method, _properties, body):
    message = json.loads(body)
    platform = message.get("platform", "arduino")
    components = message.get("components", [])
    model_config = message.get("modelConfig", {})

    template = env.get_template(f"{platform}.ino.j2")
    pin_mappings = message.get("pinMappings", [])

    logic_prompt = f"""Generate Arduino loop() logic for: {json.dumps(components)}
Return only the C++ code for the main functionality."""

    business_logic = call_llm(model_config, logic_prompt)

    code = template.render(
        components=components,
        pinMappings=pin_mappings,
        businessLogic=business_logic,
    )

    client.publish(queues.CODEGEN_OUTPUT, {
        "designDraftId": message["designDraftId"],
        "code": code,
        "platform": platform,
        "dependencies": [],
    })
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.CODEGEN_INPUT)
    client.declare_queue(queues.CODEGEN_OUTPUT)
    client.consume(queues.CODEGEN_INPUT, generate_code)


if __name__ == "__main__":
    main()
