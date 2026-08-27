import os
import json
import traceback
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from shared.llm_client import LLMClient, LLMError
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client

client = make_rabbitmq_client()
env = Environment(loader=FileSystemLoader("templates"))

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
    "sensor": "analog",
    "actuator": "signal",
    "display": "i2c",
    "communication": "uart",
    "power": "power",
    "board": "board",
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


def generate_business_logic(requirement, components, pinMappings, platform, model_config):
    prompt = f"""You are an Arduino code generator. Generate the loop() function body for a project.

Platform: {platform}
Components: {json.dumps([c['name'] for c in components], ensure_ascii=False)}
Pin Mappings: {json.dumps(pinMappings, ensure_ascii=False)}
Requirement: {json.dumps(requirement, ensure_ascii=False)}

Return ONLY valid C++ code. No markdown. No explanation. The code will be inserted inside an existing loop() function.
Start directly with the code."""
    llm = LLMClient(
        api_key=model_config.get("apiKey"),
        base_url=model_config.get("endpoint"),
        model=model_config.get("model"),
    )
    try:
        return llm.chat(
            system_prompt="You are an Arduino code generator. Generate only the loop() function body.",
            user_prompt=prompt,
            temperature=0.2,
        )
    except LLMError:
        return ""


def validate_code(code, platform):
    warnings = []
    if "void setup()" not in code and "int main(void)" not in code:
        warnings.append("Missing setup() or main() function")
    if "void loop()" not in code and "int main(void)" not in code:
        warnings.append("Missing loop() or main() function")
    return {"valid": len(warnings) == 0, "warnings": warnings}


def generate_code(ch, method, _properties, body):
    try:
        message = json.loads(body)
        platform = message.get("platform", "arduino")
        components = message.get("components", [])
        requirement = message.get("requirement", {})
        model_config = message.get("modelConfig", {})

        if not components:
            client.publish(q.CODEGEN_OUTPUT, {
                "designDraftId": message["designDraftId"],
                "error": "No components provided for code generation",
            })
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        pin_mappings = assign_pins(components, platform)
        dependencies = resolve_dependencies(components)

        template_name = f"{platform}.ino.j2"
        try:
            template = env.get_template(template_name)
        except Exception:
            template = env.get_template("arduino.ino.j2")

        business_logic = ""
        if model_config:
            business_logic = generate_business_logic(requirement, components, pin_mappings, platform, model_config)

        code = template.render(
            components=components,
            pinMappings=pin_mappings,
            dependencies=dependencies,
            businessLogic=business_logic,
            generation_time=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        )

        validation = validate_code(code, platform)

        client.publish(q.CODEGEN_OUTPUT, {
            "designDraftId": message["designDraftId"],
            "code": code,
            "platform": platform,
            "dependencies": dependencies,
            "pinMappings": pin_mappings,
            "validation": validation,
        })
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.CODEGEN_OUTPUT, {
                "designDraftId": json.loads(body).get("designDraftId"),
                "error": "Code generation failed",
            })
        except Exception:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    run_service(
        name="codegen",
        port=8004,
        declare_queues=[q.CODEGEN_OUTPUT],
        bindings=[
            QueueBinding(queue=q.CODEGEN_INPUT, callback=generate_code),
        ],
        client=client,
    )


if __name__ == "__main__":
    main()
