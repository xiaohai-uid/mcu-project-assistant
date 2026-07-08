import os
import json
import traceback
from datetime import datetime
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.domain.layout import WIRE_COLORS, layout_components, generate_bom, render_pin_table

client = make_rabbitmq_client()





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
