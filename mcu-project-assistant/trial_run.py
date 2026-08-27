#!/usr/bin/env python3
"""
MCU Project Assistant -- Standalone Trial Runner
Runs the full pipeline (Requirement → Recommend → WebSearch → Codegen → Schematic)
without Docker / RabbitMQ / PostgreSQL. Uses SQLite + in-process calls.

Usage:
    python trial_run.py "a smart flower watering system with temperature and soil moisture sensors"
"""

import sys
import os
import json
import re
import sqlite3
import traceback
from datetime import datetime
from collections import defaultdict
from pathlib import Path

# ----------------------------------------------------------
# 0. Bootstrap paths so services/ + shared/ are importable
# ----------------------------------------------------------
BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE / "services" / "requirement-service"))
sys.path.insert(0, str(BASE / "services" / "recommendation-service"))
sys.path.insert(0, str(BASE / "services" / "websearch-service"))
sys.path.insert(0, str(BASE / "services" / "codegen-service"))
sys.path.insert(0, str(BASE / "services" / "schematic-service"))

OUTPUT_DIR = BASE / "trial-output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ----------------------------------------------------------
# 1. Seed / use SQLite component database
# ----------------------------------------------------------
COMPONENTS_DATA = [
    ("Arduino Uno R3", "board", 18.00, 5.0, 14, None, "arduino", "ATmega328P, 14 digital I/O, 6 analog"),
    ("Arduino Nano", "board", 12.00, 5.0, 14, None, "arduino", "Compact version of Uno"),
    ("ESP32 DevKit V1", "board", 8.00, 3.3, 25, "WiFi,BLE", "arduino,esp32", "Dual-core, WiFi+BLE"),
    ("STM32F103C8T6", "board", 5.00, 3.3, 37, None, "arduino,stm32", "Blue Pill, 72MHz ARM"),
    ("Raspberry Pi Pico", "board", 4.00, 3.3, 26, None, "arduino", "RP2040, dual-core"),
    ("DHT11", "sensor", 2.00, 5.0, 3, "1-Wire", "arduino,esp32,stm32", "Temp 0-50C, humidity"),
    ("DHT22", "sensor", 4.00, 5.0, 3, "1-Wire", "arduino,esp32,stm32", "Temp -40-80C, humidity"),
    ("HC-SR04", "sensor", 1.50, 5.0, 4, None, "arduino,esp32,stm32", "Ultrasonic distance sensor"),
    ("BMP280", "sensor", 3.00, 3.3, 4, "I2C,SPI", "arduino,esp32,stm32", "Barometric pressure sensor"),
    ("MQ-135", "sensor", 2.50, 5.0, 4, None, "arduino,esp32", "Air quality sensor"),
    ("光敏电阻模块", "sensor", 1.00, 5.0, 3, None, "arduino,esp32,stm32", "Light intensity sensor"),
    ("土壤湿度传感器", "sensor", 1.50, 5.0, 3, None, "arduino,esp32", "Soil moisture sensor"),
    ("声音传感器", "sensor", 1.00, 5.0, 3, None, "arduino,esp32", "Sound detection module"),
    ("红外循迹传感器", "sensor", 1.00, 5.0, 3, None, "arduino,esp32", "IR tracking sensor"),
    ("水位传感器", "sensor", 1.50, 5.0, 3, None, "arduino,esp32", "Water level sensor"),
    ("SG90 舵机", "actuator", 2.50, 5.0, 3, None, "arduino,esp32,stm32", "180 rotation servo"),
    ("L298N 电机驱动", "actuator", 3.00, 12.0, 6, None, "arduino,esp32,stm32", "Dual H-bridge motor driver"),
    ("继电器模块", "actuator", 2.00, 5.0, 3, None, "arduino,esp32,stm32", "5V relay switch"),
    ("小型水泵", "actuator", 4.00, 5.0, 2, None, "arduino,esp32", "Mini water pump"),
    ("LED 灯带", "actuator", 3.00, 5.0, 3, None, "arduino,esp32", "RGB LED strip"),
    ("蜂鸣器", "actuator", 0.50, 5.0, 2, None, "arduino,esp32,stm32", "Passive/active buzzer"),
    ("电磁锁", "actuator", 8.00, 12.0, 2, None, "arduino,esp32", "12V electromagnetic lock"),
    ("LCD1602", "display", 2.50, 5.0, 16, "I2C", "arduino,esp32,stm32", "16x2 character LCD"),
    ("OLED 0.96寸", "display", 3.50, 3.3, 4, "I2C", "arduino,esp32,stm32", "128x64 OLED display"),
    ("LED 数码管", "display", 1.50, 5.0, 8, None, "arduino,esp32", "4-digit 7-segment display"),
    ("HC-05 蓝牙模块", "communication", 3.00, 5.0, 6, "UART", "arduino,esp32", "Bluetooth 2.0 module"),
    ("RC522 RFID", "communication", 2.00, 3.3, 8, "SPI", "arduino,esp32,stm32", "RFID card reader"),
    ("矩阵键盘 4x4", "communication", 1.50, 5.0, 8, None, "arduino,esp32,stm32", "16-key matrix pad"),
    ("5V 电源模块", "power", 3.00, None, None, None, "arduino,esp32,stm32", "AC-DC 5V power supply"),
    ("电池组 18650", "power", 5.00, None, None, None, "arduino,esp32", "3.7V 18650 battery holder"),
    ("面包板", "power", 2.00, None, None, None, "arduino,esp32,stm32", "830-point breadboard"),
    ("杜邦线套装", "power", 1.50, None, None, None, "arduino,esp32,stm32", "Male-male/female-male wires"),
]

DB_PATH = str(OUTPUT_DIR / "components.db")


def seed_database():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS component_categories (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT
        );
        CREATE TABLE IF NOT EXISTS components (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, category TEXT NOT NULL,
            price REAL NOT NULL, voltage REAL, pin_count INTEGER,
            protocol TEXT, compatible_platforms TEXT NOT NULL DEFAULT 'arduino',
            description TEXT, specifications TEXT
        );
        INSERT OR IGNORE INTO component_categories VALUES
        ('board', '主控板', 'Microcontroller boards'),
        ('sensor', '传感器', 'Environmental and physical sensors'),
        ('actuator', '执行器', 'Motors, relays, solenoids'),
        ('display', '显示模块', 'LCD, OLED, LED displays'),
        ('communication', '通信模块', 'Bluetooth, WiFi, RF modules'),
        ('power', '电源模块', 'Power supplies, batteries, regulators');
    """)
    for name, cat, price, voltage, pin_cnt, protocol, platforms, desc in COMPONENTS_DATA:
        spec = json.dumps({"voltage": voltage, "pinCount": pin_cnt, "protocol": protocol})
        cur.execute(
            "INSERT OR IGNORE INTO components (name, category, price, voltage, pin_count, protocol, compatible_platforms, description, specifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, cat, price, voltage, pin_cnt, protocol, platforms, desc, spec),
        )
    conn.commit()
    conn.close()
    print(f"  OK Database seeded ({len(COMPONENTS_DATA)} components)")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ----------------------------------------------------------
# 2. Pipeline stages
# ----------------------------------------------------------

# --- Stage 1: Requirement Analysis (mocked AI) ---

MOCK_REQUIREMENT = {
    "title": "Smart Plant Watering System",
    "description": "A smart watering system that monitors soil moisture and temperature, automatically waters plants when dry, and displays status on an LCD.",
    "functionality": ["temperature", "humidity", "moisture", "display"],
    "io": {
        "inputDevices": ["soil moisture sensor", "temperature sensor"],
        "outputDevices": ["water pump", "LCD display", "LED indicator"],
    },
    "communication": {"protocols": [], "remoteControl": False},
    "powerSupply": "USB 5V",
    "targetPlatform": "arduino",
    "budgetRange": "$15-30",
}


def stage_requirement(description: str, platform: str = "arduino") -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 1: Requirement Analysis")
    print(f"{'='*60}")

    chinese_chars = sum(1 for c in description if '\u4e00' <= c <= '\u9fff')
    lang = "zh" if chinese_chars > len(description) * 0.1 else "en"
    print(f"  Language: {lang}  |  Platform: {platform}")

    # In a real run we'd call an LLM here. For trial, use the preset mock.
    requirement = dict(MOCK_REQUIREMENT)
    requirement["targetPlatform"] = platform
    requirement["budgetRange"] = "$15-30 (budget)"

    print(f"  Project: {requirement['title']}")
    print(f"  Functions: {', '.join(requirement['functionality'])}")
    print(f"  Inputs: {', '.join(requirement['io']['inputDevices'])}")
    print(f"  Outputs: {', '.join(requirement['io']['outputDevices'])}")

    return requirement


# --- Stage 2: Component Recommendation ---

CATEGORY_MAP = {
    "temperature": "sensor", "humidity": "sensor",
    "light": "sensor", "sound": "sensor",
    "motion": "sensor", "distance": "sensor",
    "motor": "actuator", "led": "actuator",
    "display": "display", "lcd": "display", "oled": "display",
    "bluetooth": "communication", "wifi": "communication",
    "rfid": "communication", "keypad": "communication",
    "moisture": "sensor",
}


def check_compatibility(component: dict, platform: str) -> dict:
    platforms = component.get("compatible_platforms", "").lower()
    compatible = platform.lower() in platforms
    reasons = []
    if not compatible:
        reasons.append(f"'{component['name']}' not compatible with {platform}")
    return {"compatible": compatible, "reasons": reasons}


def allocate_tiers(components: list[dict]) -> dict:
    tiers = {"budget": [], "standard": [], "premium": []}
    for c in components:
        price = c["price"]
        if price < 3:
            tiers["budget"].append(c)
        elif price < 15:
            tiers["standard"].append(c)
        else:
            tiers["premium"].append(c)
    return tiers


def detect_conflicts(components: list[dict]) -> list[dict]:
    conflicts = []
    for i, a in enumerate(components):
        for b in components[i + 1:]:
            va = a.get("voltage")
            vb = b.get("voltage")
            if va and vb and abs(va - vb) > 1.0:
                conflicts.append({
                    "type": "voltage_mismatch",
                    "severity": "warning",
                    "message": f"{a['name']} ({va}V) and {b['name']} ({vb}V) voltage mismatch",
                })
    return conflicts


def stage_recommend(requirement: dict, platform: str = "arduino") -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 2: Component Recommendation")
    print(f"{'='*60}")

    conn = get_db()
    categories = set()
    for func in requirement.get("functionality", []):
        cat = CATEGORY_MAP.get(func.lower().strip())
        if cat:
            categories.add(cat)
    categories.add("board")  # always include boards
    if not categories:
        categories = {"sensor", "actuator", "board"}

    placeholders = ",".join("?" for _ in categories)
    cursor = conn.execute(
        f"SELECT * FROM components WHERE category IN ({placeholders})",
        list(categories),
    )
    all_components = [dict(row) for row in cursor.fetchall()]
    conn.close()

    compatible = [c for c in all_components if check_compatibility(c, platform)["compatible"]]
    tiers = allocate_tiers(compatible)
    all_selected = []
    for tlist in tiers.values():
        all_selected.extend(tlist)
    conflicts = detect_conflicts(all_selected) if len(all_selected) > 1 else []

    result = {
        "tiers": tiers,
        "conflicts": conflicts,
        "source": "database",
        "totalCosts": {
            tier: round(sum(c["price"] for c in comps), 2)
            for tier, comps in tiers.items()
        },
    }

    board_count = len(tiers.get("premium", [])) + len(tiers.get("standard", []))
    print(f"  Platform: {platform}")
    print(f"  Budget tier: {len(tiers['budget'])} components (${result['totalCosts']['budget']:.2f})")
    print(f"  Standard tier: {len(tiers['standard'])} components (${result['totalCosts']['standard']:.2f})")
    print(f"  Premium tier: {len(tiers['premium'])} components (${result['totalCosts']['premium']:.2f})")
    # Only check conflicts on a preview set (avoid O(n^2) noise on 39 components)
    selected = []
    # Always include a board
    for t in ["budget", "standard", "premium"]:
        board = next((c for c in tiers.get(t, []) if c["category"] == "board"), None)
        if board:
            selected.append(board)
            break
    # Pick one component per functional category from budget tier
    func_cats = set()
    for func in requirement.get("functionality", []):
        cat = CATEGORY_MAP.get(func.lower().strip())
        if cat:
            func_cats.add(cat)
    pool = tiers.get("budget", []) + tiers.get("standard", [])
    for cat in ["board", "sensor", "actuator", "display", "communication"]:
        if cat in func_cats or (not selected and cat == "sensor"):
            for c in pool:
                if c["category"] == cat and c not in selected:
                    selected.append(c)
                    break
    result["selected"] = selected[:8]
    # Run conflict detection ONLY on the selected subset
    sel_conflicts = detect_conflicts(result["selected"]) if len(result["selected"]) > 1 else []
    if sel_conflicts:
        for c in sel_conflicts:
            print(f"  !  {c['message']}")
    else:
        print(f"  [OK] No voltage conflicts detected")
    result["allComponents"] = all_components

    print(f"  Selected {len(result['selected'])} components for generation:")
    for c in result["selected"]:
        print(f"    - {c['name']} (${c['price']:.2f}, {c['category']})")

    return result


# --- Stage 3: WebSearch (mock -- prints what would happen) ---

def stage_websearch(components: list[dict]) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 3: Web Price Search (trial mode -- skipped)")
    print(f"{'='*60}")
    print(f"  Would search {len(components)} components on 1688 / LCSC / DuckDuckGo")
    for c in components:
        print(f"    - {c['name']} (estimated: ${c['price']:.2f})")
    return {"prices": {}, "note": "Web search skipped in trial mode (requires network)"}


# --- Stage 4: Code Generation ---

PLATFORM_PINS = {
    "arduino": {
        "digital": list(range(2, 14)),
        "analog": ["A0", "A1", "A2", "A3", "A4", "A5"],
        "i2c": ["A4 (SDA)", "A5 (SCL)"],
        "spi": ["10 (SS)", "11 (MOSI)", "12 (MISO)", "13 (SCK)"],
        "uart": [0, 1],
    },
    "esp32": {
        "digital": [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
        "analog": [32, 33, 34, 35, 36, 39],
        "i2c": [21, 22],
        "spi": [5, 18, 19, 23],
        "uart": [1, 2, 3],
    },
    "stm32": {
        "digital": ["PA0","PA1","PA2","PA3","PA4","PA5","PA6","PA7","PB0","PB1","PB10","PB11","PB12","PB13","PB14","PB15"],
        "analog": ["PA0","PA1","PA2","PA3","PA4","PA5","PA6","PA7"],
        "i2c": ["PB6 (SCL)", "PB7 (SDA)"],
        "spi": ["PA5 (SCK)", "PA6 (MISO)", "PA7 (MOSI)", "PA4 (SS)"],
        "uart": ["PA9","PA10"],
    },
}

COMPONENT_LIBRARIES = {
    "DHT11": ["DHT sensor library"],
    "DHT22": ["DHT sensor library"],
    "HC-SR04": [],
    "LCD1602": ["LiquidCrystal_I2C"],
    "OLED 0.96寸": ["Adafruit_SSD1306", "Adafruit_GFX"],
    "HC-05 蓝牙模块": ["SoftwareSerial"],
    "RC522 RFID": ["MFRC522"],
    "BMP280": ["Adafruit_BMP280"],
    "SG90 舵机": ["Servo"],
}

PIN_TYPE_MAP = {
    "sensor": "analog", "actuator": "signal",
    "display": "i2c", "communication": "uart",
    "power": "power", "board": "board",
}


def assign_pins(components, platform):
    if platform not in PLATFORM_PINS:
        platform = "arduino"
    pool = {k: list(v) for k, v in PLATFORM_PINS[platform].items()}
    assigned = []
    used_pins = set()
    for comp in components:
        cat = comp.get("category", "sensor")
        pin_type = PIN_TYPE_MAP.get(cat, "digital")
        avail = pool.get(pin_type, pool.get("digital", []))
        pin = None
        for p in avail:
            if str(p) not in used_pins:
                pin = p
                used_pins.add(str(p))
                break
        assigned.append({
            "componentName": comp.get("name", "unknown"),
            "microcontrollerPin": str(pin) if pin else "N/A",
            "connectionType": pin_type,
        })
    return assigned


def resolve_dependencies(components):
    deps = set()
    for comp in components:
        name = comp.get("name", "")
        if name in COMPONENT_LIBRARIES:
            for lib in COMPONENT_LIBRARIES[name]:
                deps.add(lib)
        for key, libs in COMPONENT_LIBRARIES.items():
            if key.lower() in name.lower():
                for lib in libs:
                    deps.add(lib)
    return sorted(deps)


def generate_business_logic_mock(requirement, components, pin_mappings):
    lines = []
    lines.append("  // === Auto-generated business logic ===")
    for pin in pin_mappings:
        pname = re.sub(r'[^A-Z0-9_]', '_', pin["componentName"].upper().replace(" ", "_"))
        ptype = pin["connectionType"]
        if ptype == "analog":
            lines.append(f"  int val_{pin['componentName'][:4]} = analogRead(PIN_{pname}_SIG);")
    lines.append("")
    if any(c.get("name", "").startswith("DHT") for c in components):
        lines.append("  // Read DHT sensor")
        lines.append("  float h = dht.readHumidity();")
        lines.append("  float t = dht.readTemperature();")
    lines.append("")
    lines.append("  // Main logic")
    lines.append('  Serial.println("System running...");')
    lines.append("  delay(1000);")
    lines.append("  // === End business logic ===")
    return "\n".join(lines)


def stage_codegen(requirement: dict, components: list[dict], platform: str) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 4: Code Generation")
    print(f"{'='*60}")

    pin_mappings = assign_pins(components, platform)
    dependencies = resolve_dependencies(components)

    print(f"  Platform: {platform}")
    print(f"  Pin assignments ({len(pin_mappings)}):")
    for p in pin_mappings:
        print(f"    {p['componentName']} → Pin {p['microcontrollerPin']} ({p['connectionType']})")
    if dependencies:
        print(f"  Libraries: {', '.join(dependencies)}")

    business_logic = generate_business_logic_mock(requirement, components, pin_mappings)

    try:
        from jinja2 import Environment, FileSystemLoader
        template_dir = BASE / "services" / "codegen-service" / "templates"
        jenv = Environment(loader=FileSystemLoader(str(template_dir)))
        template = jenv.get_template(f"{platform}.ino.j2")
    except Exception:
        template = None

    if template:
        code = template.render(
            components=components,
            pinMappings=pin_mappings,
            dependencies=dependencies,
            businessLogic=business_logic,
            generation_time=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        )
    else:
        code = _generate_code_fallback(platform, pin_mappings, dependencies, business_logic)

    # Write output
    (OUTPUT_DIR / "generated.ino").write_text(code, encoding="utf-8")
    print(f"  OK Code written to trial-output/generated.ino ({len(code)} bytes)")

    # Brief preview
    preview_lines = code.strip().split("\n")
    print(f"  Preview ({min(15, len(preview_lines))} lines):")
    for line in preview_lines[:15]:
        print(f"    {line}")

    return {"code": code, "pinMappings": pin_mappings, "dependencies": dependencies}


def _generate_code_fallback(platform, pin_mappings, dependencies, business_logic):
    lines = []
    lines.append(f"// MCU Project Assistant -- Generated Code")
    lines.append(f"// Platform: {platform}")
    lines.append("")
    for pin in pin_mappings:
        pname = re.sub(r'[^A-Z0-9_]', '_', pin["componentName"].upper().replace(" ", "_"))
        clean_pin = str(pin['microcontrollerPin']).split()[0]  # "A4 (SDA)" -> "A4"
        lines.append(f"const int PIN_{pname}_SIG = {clean_pin};")
    lines.append("")
    for dep in dependencies:
        lines.append(f"#include <{dep}>")
    lines.append("")
    lines.append("void setup() {")
    lines.append("  Serial.begin(9600);")
    for pin in pin_mappings:
        if pin["connectionType"] == "signal":
            pname = re.sub(r'[^A-Z0-9_]', '_', pin["componentName"].upper().replace(" ", "_"))
            lines.append(f"  pinMode(PIN_{pname}_SIG, OUTPUT);")
    lines.append("}")
    lines.append("")
    lines.append("void loop() {")
    lines.append(business_logic)
    lines.append("}")
    return "\n".join(lines)


# --- Stage 5: Schematic Generation ---

WIRE_COLORS = {
    "power": "#FF0000", "ground": "#000000", "signal": "#FFD700",
    "data": "#0000FF", "i2c": "#FF69B4", "spi": "#A52A2A", "pwm": "#00AA00",
}


def layout_components(components, pinTable):
    by_category = defaultdict(list)
    for comp in components:
        by_category[comp.get("category", "sensor")].append(comp)
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
        svg += f'<circle cx="250" cy="{y}" r="4" fill="{WIRE_COLORS.get(pin.get("wireColor", "signal").lower(), "#888")}"/>\n'
        svg += f'<text x="265" y="{y+4}" font-size="10">{pin.get("wireColor", "signal")}</text>\n'
        svg += f'<text x="380" y="{y+4}" font-size="10">{pin.get("connectionType", "?")}</text>\n'
    svg += '</g>\n'
    return svg


def stage_schematic(components: list[dict], platform: str) -> dict:
    print(f"\n{'='*60}")
    print(f"  STAGE 5: Schematic Generation")
    print(f"{'='*60}")

    pin_types = ["power", "ground", "signal"]
    pinTable = []
    for comp in components:
        color_map = {"power": "Red", "ground": "Black", "signal": "Yellow"}
        pin_map = {"power": "VCC", "ground": "GND", "signal": "SIG"}
        for pt in pin_types:
            suffix = {"power": "VCC", "ground": "GND", "signal": "SIG"}[pt]
            pinTable.append({
                "microcontrollerPin": f"D{len(pinTable)}" if pt != "ground" else "GND",
                "componentName": comp.get("name", "?"),
                "componentPin": pin_map[pt],
                "wireColor": color_map[pt],
                "connectionType": pt,
            })

    svg_content = _generate_svg(pinTable, components, platform)
    (OUTPUT_DIR / "schematic.svg").write_text(svg_content, encoding="utf-8")
    print(f"  OK SVG written to trial-output/schematic.svg ({len(svg_content)} bytes)")

    return {"svgContent": svg_content, "pinTable": pinTable}


def _generate_svg(pinTable, components, platform):
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 700">\n'
    svg += '<rect width="800" height="700" fill="#ffffff"/>\n'
    svg += '<rect x="20" y="20" width="760" height="50" fill="#f8f9fa" rx="5"/>\n'
    svg += '<text x="400" y="42" text-anchor="middle" font-size="18" font-weight="bold">MCU Project Assistant -- Wiring Diagram</text>\n'
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


# ----------------------------------------------------------
# Main
# ----------------------------------------------------------

def main():
    description = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "a smart plant watering system with temperature and soil moisture sensors"
    platform = "arduino"

    print(f"\n{'='*60}")
    print(f"  MCU Project Assistant -- Trial Run")
    print(f"{'='*60}")
    print(f"  Description: {description}")
    print(f"  Platform:    {platform}")
    print(f"  Output:      {OUTPUT_DIR}/")
    print(f"{'='*60}")

    # 1. Seed DB
    print(f"\n{'-'*60}")
    print(f"  [Setup] Seeding component database...")
    seed_database()

    # 2. Run pipeline
    try:
        requirement = stage_requirement(description, platform)
        recommendation = stage_recommend(requirement, platform)
        websearch = stage_websearch(recommendation["selected"])
        codegen = stage_codegen(requirement, recommendation["selected"], platform)
        schematic = stage_schematic(recommendation["selected"], platform)
    except Exception:
        traceback.print_exc()
        sys.exit(1)

    # 3. Summary
    print(f"\n{'='*60}")
    print(f"  [OK] PIPELINE COMPLETE")
    print(f"{'='*60}")
    print(f"  Output files:")
    print(f"    - Schematic: trial-output/schematic.svg")
    print(f"    - Code:      trial-output/generated.ino")
    print(f"    - DB:        trial-output/components.db")
    print()

    total_cost = sum(c["price"] for c in recommendation["selected"])
    print(f"  Summary:")
    print(f"    Project:    {requirement['title']}")
    print(f"    Platform:   {platform}")
    print(f"    Components: {len(recommendation['selected'])} selected")
    print(f"    Est. Cost:  ${total_cost:.2f}")
    code_lines = len(codegen['code'].split('\n'))
    print(f"    Code lines: {code_lines}")
    print(f"    SVG size:   {len(schematic['svgContent'])} bytes")
    print()

    # 4. Print selected components
    print(f"{'-'*60}")
    print(f"  Component List:")
    print(f"{'-'*60}")
    print(f"  {'Name':<25} {'Category':<15} {'Price':<8} {'Pin':<8}")
    print(f"  {'-'*56}")
    for c in recommendation["selected"]:
        print(f"  {c['name']:<25} {c['category']:<15} ${c['price']:<5.2f}  {c.get('pin_count', '--'):<8}")


if __name__ == "__main__":
    main()
