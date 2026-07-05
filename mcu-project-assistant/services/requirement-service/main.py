import os
import json
import re
import traceback
import httpx
from shared.rabbitmq.client import RabbitMQClient
from shared.rabbitmq import queues

client = RabbitMQClient(os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672"))


def call_llm(model_config: dict, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {model_config['apiKey']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model_config["model"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
    }
    resp = httpx.post(model_config["endpoint"], headers=headers, json=body, timeout=60)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def detect_language(text: str) -> str:
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    return "zh" if chinese_chars > len(text) * 0.1 else "en"


def build_prompt(description: str, lang: str) -> str:
    schema = {
        "title": "项目标题 (str)",
        "description": "详细功能描述 (str)",
        "functionality": ["功能1", "功能2"],
        "io": {"inputDevices": ["输入设备1"], "outputDevices": ["输出设备1"]},
        "communication": {"protocols": ["协议1"], "remoteControl": True},
        "powerSupply": "供电方式 (str)",
        "targetPlatform": "目标平台 (str, optional)",
        "budgetRange": "预算范围 (str, optional)",
    }

    if lang == "zh":
        return f"""你是一个嵌入式/单片机项目需求分析专家。请分析以下项目描述，提取结构化的需求信息。

请严格按以下 JSON 格式返回，不要添加额外文字：

```json
{json.dumps(schema, ensure_ascii=False, indent=2)}
```

项目描述：{description}"""
    else:
        return f"""You are an embedded/microcontroller project requirements analyst. Analyze the following project description and extract structured requirements.

Return ONLY valid JSON in the following format, with no additional text:

```json
{json.dumps(schema, indent=2)}
```

Description: {description}"""


def parse_llm_response(raw: str) -> dict:
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        raise ValueError("No JSON block found in LLM response")
    parsed = json.loads(match.group())
    required = {"title", "description", "functionality", "io", "communication", "powerSupply"}
    missing = required - set(parsed.keys())
    if missing:
        raise ValueError(f"Missing required fields: {missing}")
    if not isinstance(parsed.get("functionality"), list):
        raise ValueError("functionality must be a list")
    io = parsed.get("io", {})
    if not isinstance(io.get("inputDevices"), list) or not isinstance(io.get("outputDevices"), list):
        raise ValueError("io.inputDevices and io.outputDevices must be lists")
    comm = parsed.get("communication", {})
    if not isinstance(comm.get("protocols"), list):
        raise ValueError("communication.protocols must be a list")
    return parsed


def is_vague(description: str) -> bool:
    if len(description) < 15:
        return True
    generic = [
        "智能家居", "a project", "something with arduino", "something with Arduino",
        "物联网", "iot", "a device", "some device", "test", "项目",
    ]
    return description.strip().lower() in generic or any(description.strip() == g for g in generic)


def analyze_requirement(ch, method, properties, body):
    try:
        message = json.loads(body)
        description = message["description"]
        model_config = message["modelConfig"]

        if is_vague(description):
            client.publish(queues.CLARIFICATION_REQUEST, {
                "designDraftId": message["designDraftId"],
                "description": description,
                "questions": [
                    "请详细描述你的项目目标和具体功能需求",
                    "你打算使用哪些硬件模块或传感器？",
                    "Please describe your project goals and specific functional requirements",
                    "What hardware modules or sensors do you plan to use?",
                ],
            })
            ch.basic_ack(delivery_tag=method.delivery_tag)
            print(f"Clarification requested for draft {message['designDraftId']}")
            return

        lang = detect_language(description)
        prompt = build_prompt(description, lang)
        raw = call_llm(model_config, prompt)
        parsed = parse_llm_response(raw)

        client.publish(queues.REQUIREMENT_OUTPUT, {
            "designDraftId": message["designDraftId"],
            "requirement": parsed,
            "lang": lang,
            "modelUsed": model_config["level"],
        })
        print(f"Requirement analyzed for draft {message['designDraftId']}")

    except Exception:
        traceback.print_exc()
        client.publish(queues.REQUIREMENT_OUTPUT, {
            "designDraftId": message.get("designDraftId", "unknown"),
            "error": traceback.format_exc(),
        })
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def handle_clarification_response(ch, method, properties, body):
    print(f"Clarification response received (not yet wired): {body[:100]}")
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    client.connect()
    client.declare_queue(queues.REQUIREMENT_INPUT)
    client.declare_queue(queues.REQUIREMENT_OUTPUT)
    client.declare_queue(queues.CLARIFICATION_REQUEST)
    client.declare_queue(queues.CLARIFICATION_RESPONSE)
    client.channel.basic_consume(
        queue=queues.REQUIREMENT_INPUT,
        on_message_callback=analyze_requirement,
        auto_ack=False,
    )
    client.channel.basic_consume(
        queue=queues.CLARIFICATION_RESPONSE,
        on_message_callback=handle_clarification_response,
        auto_ack=False,
    )
    print("RequirementService started. Waiting for messages...")
    client.channel.start_consuming()


if __name__ == "__main__":
    main()
