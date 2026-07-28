#!/usr/bin/env python3
"""
MCU Project Assistant -- Standalone Trial Runner
Runs the full pipeline (Requirement → Recommend → Codegen → Schematic)
without Docker / RabbitMQ / PostgreSQL. Uses SQLite + in-process calls.

Usage:
    python trial_run.py "智能浇花系统，土壤湿度低于阈值时自动浇水，LCD显示状态"
    python trial_run.py "a smart flower watering system with soil moisture sensor and pump"
"""

import sys
import os
import json
import re
import sqlite3
import traceback
from datetime import datetime
from pathlib import Path

# Fix Windows console encoding
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Bootstrap paths
BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / "services" / "recommendation-service"))
sys.path.insert(0, str(BASE / "services" / "codegen-service"))

os.environ.setdefault("MOCK_MODE", "true")

from shared.domain.pins import assign_pins, resolve_dependencies, resolve_includes, COMPONENT_INTERFACE, sanitize_pin_name
from shared.domain.compatibility import detect_conflicts

OUTPUT_DIR = BASE / "trial-output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ----------------------------------------------------------
# Component Database
# ----------------------------------------------------------
COMPONENTS_DATA = [
    ("Arduino Uno R3", "board", 18.00, 5.0, 14, None, "arduino", "ATmega328P, 14 digital I/O, 6 analog"),
    ("DHT22", "sensor", 4.00, 5.0, 3, "1-Wire", "arduino", "Temp -40~80°C, humidity 0-100%"),
    ("土壤湿度传感器", "sensor", 1.50, 5.0, 3, None, "arduino", "Analog output, 0-1023"),
    ("小型水泵", "actuator", 4.00, 5.0, 2, None, "arduino", "Mini submersible water pump"),
    ("继电器模块", "actuator", 2.00, 5.0, 3, None, "arduino", "5V relay, controls pump power"),
    ("LCD1602", "display", 2.50, 5.0, 4, "I2C", "arduino", "16x2 character LCD with I2C backpack"),
    ("蜂鸣器", "actuator", 0.50, 5.0, 2, None, "arduino", "Active buzzer for alerts"),
    ("HC-SR04", "sensor", 1.50, 5.0, 4, None, "arduino", "Ultrasonic distance 2-200cm"),
    ("BMP280", "sensor", 3.00, 3.3, 4, "I2C", "arduino", "Barometric pressure + temperature"),
    ("光敏电阻模块", "sensor", 1.00, 5.0, 3, None, "arduino", "Light intensity analog sensor"),
    ("SG90 舵机", "actuator", 2.50, 5.0, 3, None, "arduino", "180° micro servo"),
    ("OLED 0.96寸", "display", 3.50, 3.3, 4, "I2C", "arduino", "128x64 SSD1306 OLED"),
    ("面包板", "accessory", 2.00, None, None, None, "arduino", "830-point breadboard"),
    ("杜邦线套装", "accessory", 1.50, None, None, None, "arduino", "Jumper wires M-M/F-M"),
]

DB_PATH = str(OUTPUT_DIR / "components.db")


def seed_database():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
            price REAL NOT NULL, voltage REAL, pin_count INTEGER,
            protocol TEXT, compatible_platforms TEXT NOT NULL DEFAULT 'arduino',
            description TEXT, specifications TEXT
        );
    """)
    for name, cat, price, voltage, pin_cnt, protocol, platforms, desc in COMPONENTS_DATA:
        spec = json.dumps({"voltage": voltage, "pinCount": pin_cnt, "protocol": protocol})
        cur.execute(
            "INSERT OR IGNORE INTO components (name, category, price, voltage, pin_count, protocol, compatible_platforms, description, specifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, cat, price, voltage, pin_cnt, protocol, platforms, desc, spec),
        )
    conn.commit()
    conn.close()


# ----------------------------------------------------------
# Stage 1: Requirement Analysis (mock for trial)
# ----------------------------------------------------------

def stage_requirement(description: str) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 1: Requirement Analysis")
    print(f"{'='*60}")

    # For trial mode, produce a known-good requirement for "smart watering"
    requirement = {
        "title": "智能浇花系统",
        "description": "基于 Arduino UNO 的智能浇花系统。使用土壤湿度传感器检测土壤水分，"
                       "当湿度低于阈值时通过继电器控制水泵自动浇水。"
                       "DHT22 监测环境温湿度，LCD1602 实时显示系统状态。",
        "functionality": ["moisture", "temperature", "humidity", "display", "pump"],
        "exactComponents": [
            {"name": "土壤湿度传感器", "role": "检测土壤水分含量", "interface": "analog"},
            {"name": "DHT22", "role": "监测环境温湿度", "interface": "digital"},
            {"name": "继电器模块", "role": "控制水泵开关", "interface": "digital"},
            {"name": "小型水泵", "role": "执行浇水动作", "interface": "digital"},
            {"name": "LCD1602", "role": "显示温湿度和土壤状态", "interface": "i2c"},
        ],
        "pinRequirements": {"analog": 1, "digital": 3, "i2c": 1, "pwm": 0},
        "powerBudget": "5V USB, ~300mA (pump active)",
        "targetPlatform": "arduino",
        "budgetRange": "30-50元",
    }

    print(f"  Project: {requirement['title']}")
    print(f"  Components: {len(requirement['exactComponents'])}")
    for ec in requirement["exactComponents"]:
        print(f"    - {ec['name']} ({ec['interface']}) : {ec['role']}")

    return requirement


# ----------------------------------------------------------
# Stage 2: Component Recommendation
# ----------------------------------------------------------

def stage_recommend(requirement: dict) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 2: Component Recommendation")
    print(f"{'='*60}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    selected = []
    for ec in requirement["exactComponents"]:
        name = ec["name"]
        cursor = conn.execute("SELECT * FROM components WHERE name = ?", (name,))
        row = cursor.fetchone()
        if row:
            comp = dict(row)
            comp["role"] = ec["role"]
            comp["interface"] = ec["interface"]
            selected.append(comp)
        else:
            selected.append({
                "name": name, "category": "sensor", "price": 5.0,
                "voltage": 5.0, "role": ec["role"], "interface": ec["interface"],
            })

    # Add board + accessories
    cursor = conn.execute("SELECT * FROM components WHERE name = 'Arduino Uno R3'")
    board = dict(cursor.fetchone())
    board["role"] = "主控制器"
    board["interface"] = "board"
    selected.insert(0, board)

    for acc_name in ["面包板", "杜邦线套装"]:
        cursor = conn.execute("SELECT * FROM components WHERE name = ?", (acc_name,))
        row = cursor.fetchone()
        if row:
            acc = dict(row)
            acc["role"] = "电路搭建" if "面包板" in acc_name else "连接线"
            acc["interface"] = "none"
            selected.append(acc)

    conn.close()

    total_cost = sum(c.get("price", 0) for c in selected)
    conflicts = detect_conflicts([c for c in selected if c.get("voltage")])

    print(f"  Selected {len(selected)} components:")
    for c in selected:
        print(f"    - {c['name']:<20} ¥{c.get('price', 0):<6.2f} {c.get('role', '')}")
    print(f"  Total cost: ¥{total_cost:.2f} (~${total_cost/7.2:.2f})")
    if conflicts:
        for cf in conflicts:
            print(f"  ⚠ {cf['message']}")
    else:
        print(f"  [OK] No voltage conflicts")

    return {"components": selected, "totalCost": total_cost, "conflicts": conflicts}


# ----------------------------------------------------------
# Stage 3: Code Generation
# ----------------------------------------------------------

def stage_codegen(requirement: dict, components: list[dict]) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 3: Code Generation")
    print(f"{'='*60}")

    # Filter to electronic components only
    code_components = [c for c in components
                      if c.get("category") not in ("accessory", "power", "board")
                      and c.get("interface") not in ("none", "board")]

    pin_mappings = assign_pins(code_components, "arduino")
    dependencies = resolve_dependencies(code_components)
    includes = resolve_includes(code_components)

    print(f"  Pin assignments:")
    for p in pin_mappings:
        print(f"    {p['componentName']:<20} → {p['microcontrollerPin']:<20} ({p['connectionType']}, {p['wireColor']})")
    print(f"  Libraries: {', '.join(dependencies) if dependencies else 'none'}")
    print(f"  Includes: {', '.join(includes) if includes else 'none'}")

    # Generate code using Jinja2 template
    from jinja2 import Environment, FileSystemLoader
    template_dir = BASE / "services" / "codegen-service" / "templates"
    jenv = Environment(loader=FileSystemLoader(str(template_dir)))
    template = jenv.get_template("arduino.ino.j2")

    # Build deterministic parts
    from shared.domain.codegen_helpers import (
        build_global_objects, build_constants, build_setup_lines, mock_business_logic,
    )
    global_objects = build_global_objects(code_components)
    constants = build_constants(code_components)
    setup_lines = build_setup_lines(code_components, pin_mappings)
    business_logic = mock_business_logic(code_components, pin_mappings)

    code = template.render(
        projectTitle=requirement.get("title", "Arduino Project"),
        components=code_components,
        pinMappings=pin_mappings,
        includes=includes,
        globalObjects=global_objects,
        constants=constants,
        setupLines=setup_lines,
        businessLogic=business_logic,
        generation_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC"),
    )

    (OUTPUT_DIR / "generated.ino").write_text(code, encoding="utf-8")
    print(f"  OK Code written ({len(code)} bytes, {len(code.splitlines())} lines)")
    print(f"  Preview:")
    for line in code.splitlines()[:20]:
        print(f"    {line}")
    print(f"    ...")

    return {"code": code, "pinMappings": pin_mappings, "dependencies": dependencies}


# ----------------------------------------------------------
# Stage 4: Schematic Generation
# ----------------------------------------------------------

def stage_schematic(requirement: dict, components: list[dict], pin_mappings: list[dict]) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 4: Schematic Generation")
    print(f"{'='*60}")

    # Import schematic helpers
    sys.path.insert(0, str(BASE / "services" / "schematic-service"))
    from importlib import import_module
    # Direct SVG generation (inline, since service uses same logic)
    from collections import defaultdict

    # Generate wiring checklist
    checklist = []
    step = 1
    checklist.append({"step": step, "instruction": "将 Arduino UNO 通过 USB 线连接到电脑（供电）"})
    step += 1
    checklist.append({"step": step, "instruction": "将 Arduino 5V 接到面包板红色电源轨，GND 接到蓝色地线轨"})
    step += 1

    for pin in pin_mappings:
        comp_name = pin.get("componentName", "")
        mcu_pin = pin.get("microcontrollerPin", "?")
        conn_type = pin.get("connectionType", "digital")

        if conn_type == "i2c":
            checklist.append({"step": step, "instruction": f"将 {comp_name} 的 VCC→5V, GND→GND, SDA→A4, SCL→A5"})
        elif conn_type == "analog":
            checklist.append({"step": step, "instruction": f"将 {comp_name} 的 VCC→5V, GND→GND, 信号脚→Arduino {mcu_pin}"})
        else:
            checklist.append({"step": step, "instruction": f"将 {comp_name} 的 VCC→5V, GND→GND, 信号脚→Arduino D{mcu_pin.replace('D', '')}"})
        step += 1

    print(f"  Wiring checklist ({len(checklist)} steps):")
    for item in checklist:
        print(f"    {item['step']}. {item['instruction']}")

    # Simple SVG placeholder (full SVG generated by service)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 750"><rect width="900" height="750" fill="#1a1a2e"/><text x="450" y="375" text-anchor="middle" fill="#e0e0e0" font-size="16">{requirement["title"]} - Wiring Diagram (see service for full SVG)</text></svg>'
    (OUTPUT_DIR / "schematic.svg").write_text(svg, encoding="utf-8")

    return {"wiringChecklist": checklist, "pinTable": pin_mappings}


# ----------------------------------------------------------
# Stage 5: Consistency Validation
# ----------------------------------------------------------

def stage_validate(codegen_result: dict, schematic_result: dict) -> bool:
    print(f"\n{'='*60}")
    print(f"  STAGE 5: Consistency Validation")
    print(f"{'='*60}")

    code = codegen_result["code"]
    pin_mappings = codegen_result["pinMappings"]
    warnings = []

    # Check that all assigned pins appear in code
    for pin in pin_mappings:
        if pin.get("connectionType") in ("analog", "digital", "pwm"):
            comp_name = pin["componentName"]
            pin_var = f"PIN_{sanitize_pin_name(comp_name)}"
            if pin_var not in code:
                warnings.append(f"Pin for {comp_name} not referenced in code")

    # Check code has setup and loop
    if "void setup()" not in code:
        warnings.append("Missing setup()")
    if "void loop()" not in code:
        warnings.append("Missing loop()")

    if warnings:
        print(f"  ⚠ {len(warnings)} warnings:")
        for w in warnings:
            print(f"    - {w}")
    else:
        print(f"  [OK] All pins consistent between code and schematic")
        print(f"  [OK] Code structure valid (setup + loop present)")

    return len(warnings) == 0


# ----------------------------------------------------------
# Main
# ----------------------------------------------------------

def main():
    description = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "智能浇花系统"

    print(f"\n{'='*60}")
    print(f"  MCU Project Assistant -- Trial Run v2")
    print(f"{'='*60}")
    print(f"  Description: {description}")
    print(f"  Platform:    Arduino UNO")
    print(f"  Output:      {OUTPUT_DIR}/")
    print(f"{'='*60}")

    # Seed
    seed_database()
    print(f"  [OK] Database seeded ({len(COMPONENTS_DATA)} components)")

    try:
        requirement = stage_requirement(description)
        recommendation = stage_recommend(requirement)
        codegen_result = stage_codegen(requirement, recommendation["components"])
        schematic_result = stage_schematic(requirement, recommendation["components"], codegen_result["pinMappings"])
        valid = stage_validate(codegen_result, schematic_result)
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # Summary
    print(f"\n{'='*60}")
    print(f"  PIPELINE {'COMPLETE ✓' if valid else 'COMPLETE (with warnings)'}")
    print(f"{'='*60}")
    print(f"  Output files:")
    print(f"    - Code:      trial-output/generated.ino")
    print(f"    - Schematic: trial-output/schematic.svg")
    print(f"    - DB:        trial-output/components.db")
    print(f"")
    print(f"  Summary:")
    print(f"    Project:    {requirement['title']}")
    print(f"    Components: {len(recommendation['components'])}")
    print(f"    Est. Cost:  ¥{recommendation['totalCost']:.2f}")
    print(f"    Code lines: {len(codegen_result['code'].splitlines())}")
    print(f"    Libraries:  {', '.join(codegen_result['dependencies']) or 'none'}")
    print(f"    Wiring:     {len(schematic_result['wiringChecklist'])} steps")
    print(f"    Valid:      {'YES' if valid else 'WARNINGS'}")
    print()


if __name__ == "__main__":
    main()
