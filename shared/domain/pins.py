"""Arduino UNO pin assignment and component library resolution.

Pin assignment strategy for Arduino UNO:
- Analog sensors → A0-A5 (analog input pins)
- Digital sensors (1-Wire, etc.) → D2-D7
- I2C devices → A4 (SDA) + A5 (SCL) — shared bus
- SPI devices → D10 (SS), D11 (MOSI), D12 (MISO), D13 (SCK)
- UART devices → D0 (RX), D1 (TX)
- Output/actuator (PWM preferred) → D3, D5, D6, D9, D10, D11
- Digital output (non-PWM) → D4, D7, D8

Reserved pins:
- D0/D1: Serial (avoid unless UART device)
- A4/A5: I2C bus (shared by all I2C devices)
"""

import re

PLATFORM_PINS = {
    "arduino": {
        "digital": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        "analog": ["A0", "A1", "A2", "A3", "A4", "A5"],
        "pwm": [3, 5, 6, 9, 10, 11],
        "i2c": ["A4", "A5"],  # SDA, SCL — shared bus
        "spi": [10, 11, 12, 13],  # SS, MOSI, MISO, SCK
        "uart": [0, 1],  # RX, TX
    },
}

# Component → required Arduino libraries (installed via Library Manager)
COMPONENT_LIBRARIES = {
    "DHT11": ["DHT sensor library"],
    "DHT22": ["DHT sensor library"],
    "HC-SR04": ["NewPing"],
    "LCD1602": ["LiquidCrystal_I2C"],
    "OLED 0.96寸": ["Adafruit_SSD1306", "Adafruit_GFX"],
    "HC-05 蓝牙模块": ["SoftwareSerial"],
    "RC522 RFID": ["MFRC522"],
    "BMP280": ["Adafruit_BMP280"],
    "SG90 舵机": ["Servo"],
    "土壤湿度传感器": [],
    "光敏电阻模块": [],
    "声音传感器": [],
    "水位传感器": [],
    "MQ-135": [],
    "继电器模块": [],
    "小型水泵": [],
    "蜂鸣器": [],
    "LED 灯带": ["Adafruit_NeoPixel"],
    "L298N 电机驱动": [],
    "红外循迹传感器": [],
    "矩阵键盘 4x4": ["Keypad"],
}

# Component → include header file name
COMPONENT_INCLUDES = {
    "DHT11": ["DHT.h"],
    "DHT22": ["DHT.h"],
    "HC-SR04": ["NewPing.h"],
    "LCD1602": ["LiquidCrystal_I2C.h"],
    "OLED 0.96寸": ["Adafruit_SSD1306.h", "Adafruit_GFX.h"],
    "HC-05 蓝牙模块": ["SoftwareSerial.h"],
    "RC522 RFID": ["MFRC522.h"],
    "BMP280": ["Adafruit_BMP280.h"],
    "SG90 舵机": ["Servo.h"],
    "LED 灯带": ["Adafruit_NeoPixel.h"],
    "矩阵键盘 4x4": ["Keypad.h"],
}

# How each component type connects — determines pin pool selection
# interface: "analog" | "digital" | "i2c" | "spi" | "uart" | "pwm"
COMPONENT_INTERFACE = {
    "DHT11": {"interface": "digital", "pins_needed": 1, "type": "input"},
    "DHT22": {"interface": "digital", "pins_needed": 1, "type": "input"},
    "HC-SR04": {"interface": "digital", "pins_needed": 2, "type": "input"},  # TRIG + ECHO
    "BMP280": {"interface": "i2c", "pins_needed": 2, "type": "input"},
    "MQ-135": {"interface": "analog", "pins_needed": 1, "type": "input"},
    "光敏电阻模块": {"interface": "analog", "pins_needed": 1, "type": "input"},
    "土壤湿度传感器": {"interface": "analog", "pins_needed": 1, "type": "input"},
    "声音传感器": {"interface": "analog", "pins_needed": 1, "type": "input"},
    "红外循迹传感器": {"interface": "digital", "pins_needed": 1, "type": "input"},
    "水位传感器": {"interface": "analog", "pins_needed": 1, "type": "input"},
    "SG90 舵机": {"interface": "pwm", "pins_needed": 1, "type": "output"},
    "L298N 电机驱动": {"interface": "pwm", "pins_needed": 2, "type": "output"},  # IN1 + IN2 (PWM)
    "继电器模块": {"interface": "digital", "pins_needed": 1, "type": "output"},
    "小型水泵": {"interface": "digital", "pins_needed": 1, "type": "output"},  # via relay/transistor
    "LED 灯带": {"interface": "digital", "pins_needed": 1, "type": "output"},
    "蜂鸣器": {"interface": "pwm", "pins_needed": 1, "type": "output"},
    "电磁锁": {"interface": "digital", "pins_needed": 1, "type": "output"},  # via relay
    "LCD1602": {"interface": "i2c", "pins_needed": 2, "type": "output"},
    "OLED 0.96寸": {"interface": "i2c", "pins_needed": 2, "type": "output"},
    "LED 数码管": {"interface": "digital", "pins_needed": 4, "type": "output"},
    "HC-05 蓝牙模块": {"interface": "uart", "pins_needed": 2, "type": "bidirectional"},
    "RC522 RFID": {"interface": "spi", "pins_needed": 4, "type": "input"},
    "矩阵键盘 4x4": {"interface": "digital", "pins_needed": 8, "type": "input"},
}

# Legacy compat
PIN_TYPE_MAP = {
    "sensor": "analog", "actuator": "digital",
    "display": "i2c", "communication": "uart",
    "power": "power", "board": "board",
}


def sanitize_pin_name(name: str) -> str:
    """Convert component name to valid C identifier suffix.

    Uses COMPONENT_VAR_NAMES for known components to produce readable names,
    falls back to regex sanitization for unknown ones.
    """
    # Check exact match first
    if name in COMPONENT_VAR_NAMES:
        return COMPONENT_VAR_NAMES[name]
    # Check partial match (e.g. "DHT22温湿度传感器" contains "DHT22")
    for key, var in COMPONENT_VAR_NAMES.items():
        if key in name:
            return var
    # Fallback: regex sanitize
    result = re.sub(r'[^A-Z0-9_]', '_', name.upper().replace(" ", "_"))
    # Collapse multiple underscores
    result = re.sub(r'_+', '_', result).strip('_')
    return result if result else "COMPONENT"


# Readable C variable name suffixes for known components
COMPONENT_VAR_NAMES = {
    "土壤湿度传感器": "SOIL_MOISTURE",
    "DHT11": "DHT11",
    "DHT22": "DHT22",
    "HC-SR04": "ULTRASONIC",
    "BMP280": "BMP280",
    "MQ-135": "MQ135",
    "光敏电阻模块": "LIGHT",
    "声音传感器": "SOUND",
    "红外循迹传感器": "IR_TRACKER",
    "水位传感器": "WATER_LEVEL",
    "SG90 舵机": "SERVO",
    "L298N 电机驱动": "MOTOR",
    "继电器模块": "RELAY",
    "小型水泵": "PUMP",
    "LED 灯带": "LED_STRIP",
    "蜂鸣器": "BUZZER",
    "电磁锁": "LOCK",
    "LCD1602": "LCD",
    "OLED 0.96寸": "OLED",
    "LED 数码管": "DIGIT_TUBE",
    "HC-05 蓝牙模块": "BT",
    "RC522 RFID": "RFID",
    "矩阵键盘 4x4": "KEYPAD",
}


def assign_pins(components: list[dict], platform: str = "arduino") -> list[dict]:
    """Assign Arduino UNO pins to components based on their interface requirements.

    Returns a list of pin mapping dicts:
    [{
        "componentName": str,
        "microcontrollerPin": str,  # e.g. "A0", "3", "A4/A5"
        "connectionType": str,      # "analog"|"digital"|"i2c"|"pwm"|"uart"|"spi"
        "ioType": str,              # "input"|"output"|"bidirectional"
        "wireColor": str,           # standard wire color for this connection
        "pinVarName": str,          # C variable name e.g. "PIN_DHT22"
    }]
    """
    pool = {k: list(v) for k, v in PLATFORM_PINS["arduino"].items()}
    used_pins: set[str] = set()
    assigned: list[dict] = []
    i2c_used = False

    # Wire color conventions
    WIRE_BY_TYPE = {
        "analog": "Yellow",
        "digital": "Green",
        "i2c": "Blue",
        "pwm": "Orange",
        "uart": "White",
        "spi": "Brown",
    }

    for comp in components:
        name = comp.get("name", "unknown")
        info = COMPONENT_INTERFACE.get(name)

        if not info:
            # Fallback: guess from category
            cat = comp.get("category", "sensor")
            if cat == "sensor":
                info = {"interface": "analog", "pins_needed": 1, "type": "input"}
            elif cat == "actuator":
                info = {"interface": "digital", "pins_needed": 1, "type": "output"}
            elif cat == "display":
                info = {"interface": "i2c", "pins_needed": 2, "type": "output"}
            elif cat == "communication":
                info = {"interface": "uart", "pins_needed": 2, "type": "bidirectional"}
            else:
                continue  # power/board/accessories don't need signal pins

        iface = info["interface"]
        io_type = info["type"]

        if iface == "i2c":
            # I2C is a shared bus — all devices use A4 (SDA) + A5 (SCL)
            pin_str = "A4 (SDA) / A5 (SCL)"
            i2c_used = True
            assigned.append({
                "componentName": name,
                "microcontrollerPin": pin_str,
                "connectionType": "i2c",
                "ioType": io_type,
                "wireColor": "Blue (SDA) / Green (SCL)",
                "pinVarName": f"PIN_{sanitize_pin_name(name)}",
            })
            continue

        if iface == "spi":
            pin_str = "D10 (SS) / D11 (MOSI) / D12 (MISO) / D13 (SCK)"
            assigned.append({
                "componentName": name,
                "microcontrollerPin": pin_str,
                "connectionType": "spi",
                "ioType": io_type,
                "wireColor": "Brown (multi-wire)",
                "pinVarName": f"PIN_{sanitize_pin_name(name)}",
            })
            continue

        if iface == "uart":
            pin_str = "D2 (RX) / D3 (TX)"  # SoftwareSerial on D2/D3
            assigned.append({
                "componentName": name,
                "microcontrollerPin": pin_str,
                "connectionType": "uart",
                "ioType": io_type,
                "wireColor": "White (RX/TX)",
                "pinVarName": f"PIN_{sanitize_pin_name(name)}",
            })
            used_pins.add("2")
            used_pins.add("3")
            continue

        # Analog or digital or PWM — assign from pool
        pins_needed = info.get("pins_needed", 1)
        if iface == "analog":
            avail = [p for p in pool["analog"] if str(p) not in used_pins]
        elif iface == "pwm":
            avail = [p for p in pool["pwm"] if str(p) not in used_pins]
        else:  # digital
            avail = [p for p in pool["digital"] if str(p) not in used_pins]

        assigned_pins = []
        for _ in range(pins_needed):
            if avail:
                p = avail.pop(0)
                used_pins.add(str(p))
                assigned_pins.append(str(p))

        pin_str = " / ".join(assigned_pins) if assigned_pins else "N/A"
        assigned.append({
            "componentName": name,
            "microcontrollerPin": pin_str,
            "connectionType": iface,
            "ioType": io_type,
            "wireColor": WIRE_BY_TYPE.get(iface, "Gray"),
            "pinVarName": f"PIN_{sanitize_pin_name(name)}",
        })

    return assigned


def resolve_dependencies(components: list[dict]) -> list[str]:
    """Resolve Arduino library dependencies for the given component list."""
    deps: set[str] = set()
    for comp in components:
        name = comp.get("name", "")
        # Exact match
        if name in COMPONENT_LIBRARIES:
            deps.update(COMPONENT_LIBRARIES[name])
            continue
        # Fuzzy match (e.g. "DHT22温湿度传感器模块" contains "DHT22")
        for key, libs in COMPONENT_LIBRARIES.items():
            if key in name or name in key:
                deps.update(libs)
    return sorted(deps)


def resolve_includes(components: list[dict]) -> list[str]:
    """Resolve #include header files for the given component list."""
    includes: set[str] = set()
    for comp in components:
        name = comp.get("name", "")
        if name in COMPONENT_INCLUDES:
            includes.update(COMPONENT_INCLUDES[name])
            continue
        for key, headers in COMPONENT_INCLUDES.items():
            if key in name or name in key:
                includes.update(headers)
    return sorted(includes)
