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
        "digital": ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7",
                     "PB0", "PB1", "PB10", "PB11", "PB12", "PB13", "PB14", "PB15"],
        "analog": ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7"],
        "i2c": ["PB6 (SCL)", "PB7 (SDA)"],
        "spi": ["PA5 (SCK)", "PA6 (MISO)", "PA7 (MOSI)", "PA4 (SS)"],
        "uart": ["PA9", "PA10"],
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
