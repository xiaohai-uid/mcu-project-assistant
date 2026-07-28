import os
import json
import traceback
from datetime import datetime
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.logging_config import get_logger

client = make_rabbitmq_client()
logger = get_logger("schematic")

# Wire color conventions (matching pins.py)
WIRE_COLORS = {
    "power": "#FF0000",
    "ground": "#333333",
    "analog": "#FFD700",
    "digital": "#22AA22",
    "i2c": "#4488FF",
    "spi": "#A52A2A",
    "pwm": "#FF8800",
    "uart": "#CCCCCC",
}

# Component category → position zone in SVG
CATEGORY_ZONE = {
    "board": {"x": 320, "y": 250, "label": "主控"},
    "sensor": {"x": 60, "y": 120, "label": "输入设备"},
    "actuator": {"x": 580, "y": 120, "label": "输出设备"},
    "display": {"x": 580, "y": 350, "label": "显示"},
    "communication": {"x": 60, "y": 350, "label": "通信"},
}


def generate_svg(pin_mappings: list[dict], components: list[dict], platform: str, project_title: str) -> str:
    """Generate a wiring diagram SVG with MCU centered, components grouped by function."""
    svg_parts = []
    svg_parts.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 750">')
    svg_parts.append(f'<rect width="900" height="750" fill="#1a1a2e" rx="8"/>')

    # Title bar
    svg_parts.append(f'<rect x="20" y="15" width="860" height="45" fill="#16213e" rx="6"/>')
    svg_parts.append(f'<text x="450" y="35" text-anchor="middle" font-size="16" font-weight="bold" fill="#e0e0e0" font-family="sans-serif">{project_title} - 接线图</text>')
    svg_parts.append(f'<text x="450" y="52" text-anchor="middle" font-size="10" fill="#888" font-family="sans-serif">Platform: Arduino UNO | {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}</text>')

    # Draw Arduino UNO (center)
    mcu_x, mcu_y = 350, 280
    svg_parts.append(f'<rect x="{mcu_x}" y="{mcu_y}" width="200" height="140" rx="8" fill="#0f3460" stroke="#0d9488" stroke-width="2"/>')
    svg_parts.append(f'<text x="{mcu_x+100}" y="{mcu_y+30}" text-anchor="middle" font-size="14" font-weight="bold" fill="#e0e0e0" font-family="sans-serif">Arduino UNO</text>')
    svg_parts.append(f'<text x="{mcu_x+100}" y="{mcu_y+50}" text-anchor="middle" font-size="10" fill="#94a3b8" font-family="sans-serif">ATmega328P</text>')
    # Pin labels on MCU
    svg_parts.append(f'<text x="{mcu_x+15}" y="{mcu_y+75}" font-size="9" fill="#06b6d4" font-family="monospace">D2-D13 (Digital)</text>')
    svg_parts.append(f'<text x="{mcu_x+15}" y="{mcu_y+90}" font-size="9" fill="#FFD700" font-family="monospace">A0-A5 (Analog)</text>')
    svg_parts.append(f'<text x="{mcu_x+15}" y="{mcu_y+105}" font-size="9" fill="#FF0000" font-family="monospace">5V / 3.3V / GND</text>')
    svg_parts.append(f'<text x="{mcu_x+15}" y="{mcu_y+120}" font-size="9" fill="#4488FF" font-family="monospace">A4=SDA / A5=SCL</text>')

    # Group components by category and draw them
    from collections import defaultdict
    by_category = defaultdict(list)
    for comp in components:
        cat = comp.get("category", "sensor")
        if cat not in ("board", "accessory", "power"):
            by_category[cat].append(comp)

    drawn_positions = {}  # name -> (x, y)
    y_offsets = defaultdict(int)

    for cat, comps in by_category.items():
        zone = CATEGORY_ZONE.get(cat, {"x": 60, "y": 500, "label": cat})
        base_x = zone["x"]
        base_y = zone["y"]

        # Category label
        svg_parts.append(f'<text x="{base_x}" y="{base_y - 10}" font-size="11" fill="#94a3b8" font-family="sans-serif">{zone["label"]}</text>')

        for i, comp in enumerate(comps):
            cx = base_x
            cy = base_y + i * 70
            w, h = 180, 55
            drawn_positions[comp["name"]] = (cx + w, cy + h // 2)  # right edge center

            color = "#1e3a5f" if cat == "sensor" else "#3d1f5c" if cat == "actuator" else "#1f3d2a"
            stroke = "#06b6d4" if cat == "sensor" else "#f59e0b" if cat == "actuator" else "#10b981"
            svg_parts.append(f'<rect x="{cx}" y="{cy}" width="{w}" height="{h}" rx="6" fill="{color}" stroke="{stroke}" stroke-width="1.5"/>')
            svg_parts.append(f'<text x="{cx+10}" y="{cy+22}" font-size="11" font-weight="bold" fill="#e0e0e0" font-family="sans-serif">{comp["name"]}</text>')
            svg_parts.append(f'<text x="{cx+10}" y="{cy+40}" font-size="9" fill="#94a3b8" font-family="sans-serif">{comp.get("role", comp.get("description", ""))}</text>')

    # Draw wires from components to MCU
    mcu_left = (mcu_x, mcu_y + 70)
    mcu_right = (mcu_x + 200, mcu_y + 70)

    for pin in pin_mappings:
        comp_name = pin.get("componentName", "")
        conn_type = pin.get("connectionType", "digital")
        color = WIRE_COLORS.get(conn_type, "#888888")
        mcu_pin = pin.get("microcontrollerPin", "?")

        pos = drawn_positions.get(comp_name)
        if not pos:
            continue

        # Determine connection side
        if pos[0] < mcu_x:  # component is left of MCU
            start = pos
            end = (mcu_x, mcu_y + 60 + pin_mappings.index(pin) * 8)
        else:  # component is right of MCU
            start = pos
            end = (mcu_x + 200, mcu_y + 60 + pin_mappings.index(pin) * 8)

        svg_parts.append(f'<line x1="{start[0]}" y1="{start[1]}" x2="{end[0]}" y2="{end[1]}" stroke="{color}" stroke-width="2" stroke-dasharray="4,2"/>')
        # Pin label at midpoint
        mid_x = (start[0] + end[0]) // 2
        mid_y = (start[1] + end[1]) // 2 - 5
        svg_parts.append(f'<text x="{mid_x}" y="{mid_y}" font-size="8" fill="{color}" text-anchor="middle" font-family="monospace">{mcu_pin}</text>')

    # Wire legend
    legend_x, legend_y = 700, 550
    svg_parts.append(f'<rect x="{legend_x-10}" y="{legend_y-15}" width="180" height="{len(WIRE_COLORS)*18+30}" rx="4" fill="#16213e"/>')
    svg_parts.append(f'<text x="{legend_x}" y="{legend_y}" font-size="11" font-weight="bold" fill="#e0e0e0" font-family="sans-serif">线缆颜色图例</text>')
    ly = legend_y + 18
    type_names = {"power": "电源(5V)", "ground": "地线(GND)", "analog": "模拟信号", "digital": "数字信号", "i2c": "I2C总线", "spi": "SPI总线", "pwm": "PWM输出", "uart": "串口"}
    for wtype, color in WIRE_COLORS.items():
        svg_parts.append(f'<line x1="{legend_x}" y1="{ly}" x2="{legend_x+25}" y2="{ly}" stroke="{color}" stroke-width="3"/>')
        svg_parts.append(f'<text x="{legend_x+32}" y="{ly+4}" font-size="9" fill="#ccc" font-family="sans-serif">{type_names.get(wtype, wtype)}</text>')
        ly += 18

    svg_parts.append('</svg>')
    return "\n".join(svg_parts)


def build_wiring_checklist(pin_mappings: list[dict], components: list[dict]) -> list[dict]:
    """Generate step-by-step wiring instructions for beginners."""
    checklist = []
    step = 1

    # Power connections first
    checklist.append({
        "step": step,
        "instruction": "将 Arduino UNO 通过 USB 线连接到电脑（供电）",
        "from": "USB",
        "to": "Arduino UNO USB口",
        "wire": "USB数据线",
    })
    step += 1

    # Breadboard power rail
    checklist.append({
        "step": step,
        "instruction": "将 Arduino 5V 接到面包板红色电源轨，GND 接到蓝色地线轨",
        "from": "Arduino 5V + GND",
        "to": "面包板电源轨",
        "wire": "红(5V) + 黑(GND)",
    })
    step += 1

    for pin in pin_mappings:
        comp_name = pin.get("componentName", "")
        mcu_pin = pin.get("microcontrollerPin", "?")
        conn_type = pin.get("connectionType", "digital")
        wire_color = pin.get("wireColor", "Gray")

        # Find component role
        comp = next((c for c in components if c.get("name") == comp_name), {})
        role = comp.get("role", "")

        if conn_type == "i2c":
            checklist.append({
                "step": step,
                "instruction": f"将 {comp_name} 的 VCC 接 5V，GND 接 GND，SDA 接 Arduino A4，SCL 接 Arduino A5",
                "from": f"Arduino A4/A5 + 5V/GND",
                "to": f"{comp_name} (SDA/SCL/VCC/GND)",
                "wire": "蓝(SDA) + 绿(SCL) + 红(VCC) + 黑(GND)",
            })
        elif conn_type == "analog":
            checklist.append({
                "step": step,
                "instruction": f"将 {comp_name} 的 VCC 接 5V，GND 接 GND，信号输出(S/AO)接 Arduino {mcu_pin}",
                "from": f"Arduino {mcu_pin}",
                "to": f"{comp_name} 信号脚",
                "wire": f"{wire_color}(信号) + 红(VCC) + 黑(GND)",
            })
        elif conn_type in ("digital", "pwm"):
            io_dir = "输入" if comp.get("category") == "sensor" else "输出"
            checklist.append({
                "step": step,
                "instruction": f"将 {comp_name} 的 VCC 接 5V，GND 接 GND，信号脚接 Arduino D{mcu_pin.replace('D', '')}",
                "from": f"Arduino D{mcu_pin.replace('D', '')}",
                "to": f"{comp_name} 信号脚",
                "wire": f"{wire_color}(信号) + 红(VCC) + 黑(GND)",
            })
        else:
            checklist.append({
                "step": step,
                "instruction": f"连接 {comp_name} 到 Arduino {mcu_pin}",
                "from": f"Arduino {mcu_pin}",
                "to": comp_name,
                "wire": wire_color,
            })
        step += 1

    return checklist


def generate_diagram(ch, method, _properties, body):
    try:
        message = json.loads(body)
        components = message.get("components", [])
        platform = message.get("platform", "arduino")
        pin_mappings = message.get("pinMappings", [])
        project_title = message.get("projectTitle", "Arduino Project")
        design_draft_id = message["designDraftId"]

        # If no pin mappings provided, generate from components
        if not pin_mappings:
            from shared.domain.pins import assign_pins
            code_components = [c for c in components
                              if c.get("category") not in ("accessory", "power")
                              and c.get("interface") != "none"]
            pin_mappings = assign_pins(code_components, platform)

        # Generate SVG
        svg_content = generate_svg(pin_mappings, components, platform, project_title)

        # Generate wiring checklist
        wiring_checklist = build_wiring_checklist(pin_mappings, components)

        # Build pin table for frontend display
        pin_table = []
        for pin in pin_mappings:
            pin_table.append({
                "microcontrollerPin": pin.get("microcontrollerPin", "?"),
                "componentName": pin.get("componentName", "?"),
                "connectionType": pin.get("connectionType", "?"),
                "wireColor": pin.get("wireColor", "Gray"),
                "ioType": pin.get("ioType", "?"),
            })

        # Power notes
        power_notes = [
            "所有模块通过 Arduino 5V 引脚供电（USB 最大 500mA）",
            "如果总功耗超过 500mA，请使用外部 5V 电源",
            "I2C 设备共享 A4(SDA)/A5(SCL)，地址不能冲突",
        ]

        client.publish(q.SCHEMATIC_OUTPUT, {
            "designDraftId": design_draft_id,
            "svgContent": svg_content,
            "pinTable": pin_table,
            "wiringChecklist": wiring_checklist,
            "powerNotes": power_notes,
        })
        logger.info(f"Draft {design_draft_id}: SVG {len(svg_content)} bytes, "
                    f"{len(wiring_checklist)} wiring steps",
                    extra={"design_draft_id": design_draft_id, "stage": "schematic"})
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.SCHEMATIC_OUTPUT, {
                "designDraftId": json.loads(body).get("designDraftId"),
                "error": "Schematic generation failed: " + traceback.format_exc(),
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
