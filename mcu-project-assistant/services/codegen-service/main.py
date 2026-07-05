import os
import json
import re
import time
import httpx
import traceback
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))
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


def call_llm(model_config, prompt, max_retries=2):
    headers = {
        "Authorization": f"Bearer {model_config['apiKey']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model_config.get("model", "gpt-3.5-turbo"),
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            resp = httpx.post(model_config["endpoint"], headers=headers, json=body, timeout=60)
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception as e:
            last_error = str(e)
            if attempt < max_retries:
                time.sleep(2 ** attempt)
    raise Exception(f"LLM call failed after {max_retries+1} attempts: {last_error}")


def generate_business_logic(requirement, components, pinMappings, model_config):
    prompt = f"""You are an Arduino code generator. Generate the loop() function body for a project.

Platform: {model_config.get('platform', 'arduino')}
Components: {json.dumps([c['name'] for c in components], ensure_ascii=False)}
Pin Mappings: {json.dumps(pinMappings, ensure_ascii=False)}
Requirement: {json.dumps(requirement, ensure_ascii=False)}

Return ONLY valid C++ code. No markdown. No explanation. The code will be inserted inside an existing loop() function.
Start directly with the code."""
    return call_llm(model_config, prompt)


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
            client.publish(queues.CODEGEN_OUTPUT, {
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
            business_logic = generate_business_logic(requirement, components, pin_mappings, model_config)

        code = template.render(
            components=components,
            pinMappings=pin_mappings,
            dependencies=dependencies,
            businessLogic=business_logic,
            generation_time=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        )

        validation = validate_code(code, platform)

        client.publish(queues.CODEGEN_OUTPUT, {
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
            client.publish(queues.CODEGEN_OUTPUT, {
                "designDraftId": json.loads(body).get("designDraftId"),
                "error": "Code generation failed",
            })
        except Exception:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.CODEGEN_INPUT)
    client.declare_queue(queues.CODEGEN_OUTPUT)
    client.channel.basic_consume(
        queue=queues.CODEGEN_INPUT,
        on_message_callback=generate_code,
        auto_ack=False,
    )
    print("CodegenService started. Waiting for messages...")
    client.channel.start_consuming()


if __name__ == "__main__":
    main()
