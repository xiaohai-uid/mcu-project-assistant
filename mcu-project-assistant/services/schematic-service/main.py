import os
import json
import traceback
from datetime import datetime
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client

client = make_rabbitmq_client()

WIRE_COLORS = {
    "power": "#FF0000",
    "ground": "#000000",
    "signal": "#FFD700",
    "data": "#0000FF",
    "i2c": "#FF69B4",
    "spi": "#A52A2A",
    "pwm": "#00AA00",
}


def layout_components(components, pinTable):
    from collections import defaultdict
    by_category = defaultdict(list)
    for comp in components:
        cat = comp.get("category", "sensor")
        by_category[cat].append(comp)

    category_order = ["board", "sensor", "display", "communication", "actuator", "power"]
    layout = []
    x, y = 80, 120
    for cat in category_order:
        items = by_category.get(cat, [])
        for comp in items:
            name = comp.get("name", "Component")
            layout.append({"name": name, "x": x, "y": y, "width": 200, "height": 80, "category": cat})
            x += 220
            if x > 700:
                x = 80
                y += 100
        x = 80
        if items:
            y += 100
    return layout


def generate_bom(components):
    svg = '<g transform="translate(80, 450)">\n'
    svg += '<rect x="0" y="0" width="640" height="20" fill="#e9ecef" rx="3"/>\n'
    headers = ["Qty", "Name", "Category", "Price", "Notes"]
    for i, h in enumerate(headers):
        svg += f'<text x="{10 + i*128}" y="14" font-size="11" font-weight="bold">{h}</text>\n'
    for idx, comp in enumerate(components):
        y = 25 + idx * 20
        svg += f'<line x1="0" y1="{y-5}" x2="640" y2="{y-5}" stroke="#dee2e6"/>\n'
        qty = comp.get("qty", 1)
        name = comp.get("name", "?")
        cat = comp.get("category", "?")
        price = comp.get("price", "?")
        svg += f'<text x="10" y="{y+4}" font-size="10">{qty}</text>\n'
        svg += f'<text x="50" y="{y+4}" font-size="10">{name}</text>\n'
        svg += f'<text x="200" y="{y+4}" font-size="10">{cat}</text>\n'
        svg += f'<text x="330" y="{y+4}" font-size="10">${price}</text>\n'
    svg += '</g>\n'
    return svg


def render_pin_table(pinTable):
    svg = '<g transform="translate(80, 300)">\n'
    svg += '<rect x="0" y="0" width="500" height="20" fill="#e9ecef" rx="3"/>\n'
    headers = ["MCU Pin", "Component", "Wire", "Type"]
    for i, h in enumerate(headers):
        svg += f'<text x="{10 + i*122}" y="14" font-size="11" font-weight="bold">{h}</text>\n'
    for idx, pin in enumerate(pinTable):
        y = 25 + idx * 18
        svg += f'<line x1="0" y1="{y-3}" x2="500" y2="{y-3}" stroke="#dee2e6"/>\n'
        mcu = pin.get("microcontrollerPin", "?")
        comp = pin.get("componentName", "?")
        color = pin.get("wireColor", "gray")
        ctype = pin.get("connectionType", "?")
        svg += f'<text x="10" y="{y+4}" font-size="10">{mcu}</text>\n'
        svg += f'<text x="100" y="{y+4}" font-size="10">{comp}</text>\n'
        svg += f'<circle cx="250" cy="{y}" r="4" fill="{WIRE_COLORS.get(color.lower(), "#888")}"/>\n'
        svg += f'<text x="265" y="{y+4}" font-size="10">{color}</text>\n'
        svg += f'<text x="380" y="{y+4}" font-size="10">{ctype}</text>\n'
    svg += '</g>\n'
    return svg


def generate_svg(pinTable, components, platform):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 700">\n'
    svg += f'<rect width="800" height="700" fill="#ffffff"/>\n'

    svg += f'<rect x="20" y="20" width="760" height="50" fill="#f8f9fa" rx="5"/>\n'
    svg += f'<text x="400" y="42" text-anchor="middle" font-size="18" font-weight="bold">Wiring Diagram</text>\n'
    svg += f'<text x="400" y="60" text-anchor="middle" font-size="11" fill="#666">Platform: {platform} | Generated: {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}</text>\n'

    layout = layout_components(components, pinTable)
    for item in layout:
        svg += f'<rect x="{item["x"]}" y="{item["y"]}" width="{item["width"]}" height="{item["height"]}" rx="5" fill="#e3f2fd" stroke="#1976d2" stroke-width="1.5"/>\n'
        svg += f'<text x="{item["x"]+10}" y="{item["y"]+18}" font-size="11" font-weight="bold">{item["name"]}</text>\n'
        svg += f'<text x="{item["x"]+10}" y="{item["y"]+32}" font-size="9" fill="#666">{item["category"]}</text>\n'

    wire_start_y = 120
    for idx, pin in enumerate(pinTable):
        comp_name = pin.get("componentName", "")
        ctype = pin.get("connectionType", "power")
        color = WIRE_COLORS.get(ctype.lower(), "#888888")
        target = next((l for l in layout if l["name"] == comp_name), None)
        if target:
            x1, y1 = 50, wire_start_y + idx * 12
            x2 = target["x"] - 10
            y2 = target["y"] + 40
            svg += f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5"/>\n'

    svg += render_pin_table(pinTable)
    svg += generate_bom(components)

    svg += '<g transform="translate(630, 295)">\n'
    svg += '<text x="0" y="10" font-size="11" font-weight="bold">Wire Legend</text>\n'
    legend_y = 25
    for name, color in WIRE_COLORS.items():
        svg += f'<line x1="0" y1="{legend_y}" x2="20" y2="{legend_y}" stroke="{color}" stroke-width="2"/>\n'
        svg += f'<text x="25" y="{legend_y+4}" font-size="9">{name}</text>\n'
        legend_y += 16
    svg += '</g>\n'

    svg += '</svg>\n'
    return svg


def generate_diagram(ch, method, _properties, body):
    try:
        message = json.loads(body)
        components = message.get("components", [])
        platform = message.get("platform", "arduino")

        from itertools import cycle
        pin_types = ["power", "ground", "signal"]
        pinTable = []
        for comp in components:
            name = comp.get("name", "?")
            for pt in pin_types:
                color_map = {"power": "Red", "ground": "Black", "signal": "Yellow"}
                pin_map = {"power": "VCC", "ground": "GND", "signal": "SIG"}
                pinTable.append({
                    "microcontrollerPin": f"D{len(pinTable)}" if pt != "ground" else "GND",
                    "componentName": name,
                    "componentPin": pin_map[pt],
                    "wireColor": color_map[pt],
                    "connectionType": pt,
                })

        svg_content = generate_svg(pinTable, components, platform)

        client.publish(q.SCHEMATIC_OUTPUT, {
            "designDraftId": message["designDraftId"],
            "svgContent": svg_content,
            "pinTable": pinTable,
            "powerNotes": ["5V power required", "Check voltage compatibility"],
        })
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.SCHEMATIC_OUTPUT, {
                "designDraftId": json.loads(body).get("designDraftId"),
                "error": "Schematic generation failed",
            })
        except Exception:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    run_service(
        name="schematic",
        port=8005,
        declare_queues=[q.SCHEMATIC_OUTPUT],
        bindings=[
            QueueBinding(queue=q.SCHEMATIC_INPUT, callback=generate_diagram),
        ],
        client=client,
    )


if __name__ == "__main__":
    main()
