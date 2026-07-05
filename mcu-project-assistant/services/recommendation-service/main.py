import os
import json
import sqlite3
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def get_db():
    conn = sqlite3.connect("components.db")
    conn.row_factory = sqlite3.Row
    return conn


def recommend_components(ch, method, _properties, body):
    message = json.loads(body)
    requirement = message["requirement"]
    membership = message["membership"]
    use_websearch = membership in ("subscription", "pay-as-you-go") or message.get("hasSearchKey")

    conn = get_db()
    cursor = conn.execute(
        "SELECT * FROM components WHERE category IN ("
        + ",".join("?" for _ in requirement.get("functionality", []))
        + ")",
        requirement.get("functionality", []),
    )
    components = [dict(row) for row in cursor.fetchall()]
    conn.close()

    tiers = {"budget": [], "standard": [], "premium": []}
    for c in components:
        if c["price"] < 5:
            tiers["budget"].append(c)
        elif c["price"] < 20:
            tiers["standard"].append(c)
        else:
            tiers["premium"].append(c)

    result = {"tiers": tiers, "useWebSearch": use_websearch}

    if use_websearch:
        client.publish(queues.WEBSERACH_INPUT, {
            "designDraftId": message["designDraftId"],
            "components": [c["name"] for c in components],
        })

    client.publish(queues.RECOMMENDATION_OUTPUT, {
        "designDraftId": message["designDraftId"],
        "componentList": result,
    })
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.RECOMMENDATION_INPUT)
    client.declare_queue(queues.RECOMMENDATION_OUTPUT)
    client.consume(queues.RECOMMENDATION_INPUT, recommend_components)


if __name__ == "__main__":
    main()
