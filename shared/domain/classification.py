CATEGORY_MAP = {
    "temperature": "sensor", "humidity": "sensor",
    "light": "sensor", "sound": "sensor",
    "motion": "sensor", "distance": "sensor",
    "pressure": "sensor", "gas": "sensor",
    "moisture": "sensor",
    "motor": "actuator", "led": "actuator",
    "servo": "actuator", "relay": "actuator",
    "buzzer": "actuator", "pump": "actuator",
    "fan": "actuator", "valve": "actuator",
    "display": "display", "lcd": "display", "oled": "display",
    "seven_segment": "display",
    "bluetooth": "communication", "wifi": "communication",
    "rfid": "communication", "keypad": "communication",
    "i2c": "communication", "spi": "communication",
    "uart": "communication", "usb": "communication",
    "ethernet": "communication",
    "button": "input", "switch": "input",
    "potentiometer": "input", "joystick": "input",
    "encoder": "input",
}


def map_functionality_to_category(functionality: str) -> str:
    return CATEGORY_MAP.get(functionality.lower().strip(), "other")
