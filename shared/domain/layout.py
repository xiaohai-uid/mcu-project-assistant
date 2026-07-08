from collections import defaultdict

WIRE_COLORS = {
    "power": "#FF0000", "ground": "#000000", "signal": "#FFD700",
    "data": "#0000FF", "i2c": "#FF69B4", "spi": "#A52A2A", "pwm": "#00AA00",
}

CATEGORY_ORDER = ["board", "sensor", "display", "communication", "actuator", "power"]


def layout_components(components, pinTable):
    by_category = defaultdict(list)
    for comp in components:
        by_category[comp.get("category", "sensor")].append(comp)
    layout = []
    x, y = 80, 120
    for cat in CATEGORY_ORDER:
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
        svg += f'<text x="10" y="{y+4}" font-size="10">{comp.get("qty", 1)}</text>\n'
        svg += f'<text x="50" y="{y+4}" font-size="10">{comp.get("name", "?")}</text>\n'
        svg += f'<text x="200" y="{y+4}" font-size="10">{comp.get("category", "?")}</text>\n'
        svg += f'<text x="330" y="{y+4}" font-size="10">${comp.get("price", "?")}</text>\n'
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
        svg += f'<text x="10" y="{y+4}" font-size="10">{pin.get("microcontrollerPin", "?")}</text>\n'
        svg += f'<text x="100" y="{y+4}" font-size="10">{pin.get("componentName", "?")}</text>\n'
        svg += f'<text x="240" y="{y+4}" font-size="10">{pin.get("wireColor", "gray")}</text>\n'
        svg += f'<text x="330" y="{y+4}" font-size="10">{pin.get("connectionType", "?")}</text>\n'
    svg += '</g>\n'
    return svg
