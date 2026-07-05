import os
import json
import httpx
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def search_taobao(component: str) -> list:
    return []


def search_distributor(component: str) -> list:
    try:
        resp = httpx.get(
            f"https://www.lcsc.com/search?q={component}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        resp.raise_for_status()
        return [{"source": "LCSC", "component": component, "url": str(resp.url)}]
    except Exception:
        return []


def search_general(component: str) -> list:
    try:
        resp = httpx.get(
            f"https://html.duckduckgo.com/html/?q={component}+price",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        resp.raise_for_status()
        return [{"source": "web", "component": component, "url": str(resp.url)}]
    except Exception:
        return []


def handle_websearch(ch, method, _properties, body):
    message = json.loads(body)
    components = message.get("components", [])

    results = {}
    for comp in components:
        results[comp] = {
            "taobao": search_taobao(comp),
            "distributors": search_distributor(comp),
            "general": search_general(comp),
        }

    client.publish(queues.WEBSERACH_OUTPUT, {
        "designDraftId": message["designDraftId"],
        "prices": results,
    })
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.WEBSERACH_INPUT)
    client.declare_queue(queues.WEBSERACH_OUTPUT)
    client.consume(queues.WEBSERACH_INPUT, handle_websearch)


if __name__ == "__main__":
    main()
