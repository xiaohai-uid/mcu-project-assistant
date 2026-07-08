import os
import json
import traceback
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from shared.llm_client import LLMClient, LLMError
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.domain.pins import PLATFORM_PINS, COMPONENT_LIBRARIES, PIN_TYPE_MAP, assign_pins, resolve_dependencies

client = make_rabbitmq_client()
env = Environment(loader=FileSystemLoader("templates"))





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
