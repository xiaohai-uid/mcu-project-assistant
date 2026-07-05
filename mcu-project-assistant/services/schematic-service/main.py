import os
import json
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def assign_pins(components: list) -> list:
    pins = []
    available = {"digital": list(range(2, 14)), "analog": list(range(14, 20)),
                 "pwm": [3, 5, 6, 9, 10, 11], "i2c": ["A4(SDA)", "A5(SCL)"],
                 "uart": [0, 1]}
    idx = {"digital": 0, "pwm": 0, "analog": 0}

    for comp in components:
        pin_type = "digital"
        if "pwm" in comp.get("specifications", "").lower():
            pin_type = "pwm"
        elif "analog" in comp.get("specifications", "").lower():
            pin_type = "analog"

        pool = available[pin_type]
        pin = pool[idx[pin_type]] if idx[pin_type] < len(pool) else "N/A"
        idx[pin_type] += 1

        pins.append({
            "microcontrollerPin": str(pin),
            "componentName": comp["name"],
            "componentPin": "VCC",
            "wireColor": "Red",
            "connectionType": "power",
        })
        pins.append({
            "microcontrollerPin": "GND",
            "componentName": comp["name"],
            "componentPin": "GND",
            "wireColor": "Black",
            "connectionType": "ground",
        })
        pins.append({
            "microcontrollerPin": str(pin) if pin_type != "digital" else f"D{pin}",
            "componentName": comp["name"],
            "componentPin": "SIG",
            "wireColor": "Yellow",
            "connectionType": "signal",
        })

    return pins


def generate_svg(pin_mappings: list) -> str:
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">\n'
    svg += '  <rect x="50" y="50" width="700" height="500" fill="#f8f9fa" stroke="#ccc" />\n'
    svg += '  <text x="400" y="40" text-anchor="middle" font-size="20">Wiring Diagram</text>\n'

    y = 100
    for mapping in pin_mappings:
        color = mapping.get("wireColor", "gray")
        svg += f'  <line x1="100" y1="{y}" x2="700" y2="{y}" stroke="{color}" stroke-width="2" />\n'
        svg += f'  <text x="110" y="{y+4}" font-size="12">{mapping["microcontrollerPin"]}</text>\n'
        svg += f'  <text x="350" y="{y+4}" text-anchor="middle" font-size="12">{mapping["componentName"]} → {mapping["componentPin"]}</text>\n'
        y += 30

    svg += "</svg>"
    return svg


def generate_diagram(ch, method, _properties, body):
    message = json.loads(body)
    components = message.get("components", [])

    pin_mappings = assign_pins(components)
    svg_content = generate_svg(pin_mappings)

    client.publish(queues.SCHEMATIC_OUTPUT, {
        "designDraftId": message["designDraftId"],
        "svgContent": svg_content,
        "pinTable": pin_mappings,
        "powerNotes": ["5V power required", "Check voltage compatibility"],
    })
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.SCHEMATIC_INPUT)
    client.declare_queue(queues.SCHEMATIC_OUTPUT)
    client.consume(queues.SCHEMATIC_INPUT, generate_diagram)


if __name__ == "__main__":
    main()
