import os
import json
import re
import traceback
from datetime import datetime
from jinja2 import Environment, FileSystemLoader
from shared.llm_client import LLMClient, LLMError, MOCK_MODE
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.logging_config import get_logger
from shared.domain.pins import (
    assign_pins, resolve_dependencies, resolve_includes,
    COMPONENT_INTERFACE, COMPONENT_LIBRARIES,
)
from shared.domain.codegen_helpers import (
    sanitize_pin_name as _sanitize_pin_name,
    build_global_objects,
    build_constants,
    build_setup_lines,
    mock_business_logic as _mock_business_logic,
    validate_code,
    build_upload_instructions,
)

client = make_rabbitmq_client()
logger = get_logger("codegen")
env = Environment(loader=FileSystemLoader(os.path.join(os.path.dirname(__file__), "templates")))


def generate_business_logic(requirement: dict, components: list[dict],
                            pin_mappings: list[dict], model_config: dict) -> str:
    """Use LLM to generate loop() business logic. Falls back to template if unavailable."""
    if MOCK_MODE:
        return _mock_business_logic(components, pin_mappings)

    comp_summary = []
    for comp in components:
        if comp.get("category") in ("board", "accessory", "power"):
            continue
        pin_info = next((p for p in pin_mappings if p["componentName"] == comp["name"]), None)
        pin_str = pin_info["microcontrollerPin"] if pin_info else "?"
        comp_summary.append(f"- {comp['name']} (pin: {pin_str}, role: {comp.get('role', '?')})")

    prompt = f"""Generate the loop() function body for an Arduino project.

Project: {requirement.get('title', 'Unknown')}
Description: {requirement.get('description', '')}

Components and their pins:
{chr(10).join(comp_summary)}

Rules:
1. Use the exact pin variable names defined above (PIN_XXX format)
2. Read sensors, make decisions, control actuators
3. Add Serial.println() for debugging output
4. Add appropriate delay() at the end (typically 1000-2000ms)
5. Use Chinese comments to explain each section
6. Return ONLY the C++ code for loop() body. No markdown. No explanation.
7. Indent with 2 spaces
8. Keep it practical and working - this code will be compiled directly"""

    llm = LLMClient(
        api_key=model_config.get("apiKey"),
        base_url=model_config.get("endpoint"),
        model=model_config.get("model"),
    )
    try:
        result = llm.chat(
            system_prompt="You are an expert Arduino programmer. Generate clean, working C++ code.",
            user_prompt=prompt,
            temperature=0.2,
        )
        # Clean markdown fences if present
        result = result.strip()
        if result.startswith("```"):
            result = re.sub(r'^```[a-z]*\n?', '', result)
            result = re.sub(r'\n?```$', '', result)
        return result
    except LLMError:
        return _mock_business_logic(components, pin_mappings)


def generate_code(ch, method, _properties, body):
    try:
        message = json.loads(body)
        platform = message.get("platform", "arduino")
        components = message.get("components", [])
        requirement = message.get("requirement", {})
        model_config = message.get("modelConfig", {})
        design_draft_id = message["designDraftId"]

        if not components:
            client.publish(q.CODEGEN_OUTPUT, {
                "designDraftId": design_draft_id,
                "error": "No components provided for code generation",
            })
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        # Filter out non-electronic items for code generation
        code_components = [c for c in components
                          if c.get("category") not in ("accessory", "power")
                          and c.get("interface") != "none"]

        # Assign pins based on component interfaces
        pin_mappings = assign_pins(code_components, platform)
        dependencies = resolve_dependencies(code_components)
        includes = resolve_includes(code_components)

        # Build deterministic code parts
        global_objects = build_global_objects(code_components)
        constants = build_constants(code_components)
        setup_lines = build_setup_lines(code_components, pin_mappings)

        # Generate business logic (LLM or fallback)
        business_logic = generate_business_logic(
            requirement, code_components, pin_mappings, model_config
        )

        # Render template
        project_title = requirement.get("title", "Arduino Project")
        template = env.get_template("arduino.ino.j2")
        code = template.render(
            projectTitle=project_title,
            components=code_components,
            pinMappings=pin_mappings,
            includes=includes,
            globalObjects=global_objects,
            constants=constants,
            setupLines=setup_lines,
            businessLogic=business_logic,
            generation_time=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC"),
        )

        # Validate
        validation = validate_code(code, pin_mappings)

        # Upload instructions
        upload_info = build_upload_instructions(code_components, dependencies)

        client.publish(q.CODEGEN_OUTPUT, {
            "designDraftId": design_draft_id,
            "code": code,
            "platform": platform,
            "dependencies": dependencies,
            "pinMappings": pin_mappings,
            "validation": validation,
            "uploadInstructions": upload_info,
        })
        logger.info(f"Draft {design_draft_id}: {len(code)} bytes, "
                    f"{len(pin_mappings)} pins, valid={validation['valid']}",
                    extra={"design_draft_id": design_draft_id, "stage": "codegen"})
        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception:
        traceback.print_exc()
        try:
            client.publish(q.CODEGEN_OUTPUT, {
                "designDraftId": json.loads(body).get("designDraftId"),
                "error": "Code generation failed: " + traceback.format_exc(),
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
