import os
import json
import traceback
from pydantic import BaseModel
from shared.llm_client import LLMClient, LLMError
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client

client = make_rabbitmq_client()


class RequirementOutput(BaseModel):
    title: str
    description: str
    functionality: list[str]
    io: dict
    communication: dict
    powerSupply: str
    targetPlatform: str = "arduino"
    budgetRange: str = ""


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
            client.publish(q.CLARIFICATION_REQUEST, {
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

        llm = LLMClient(
            api_key=model_config.get("apiKey") or os.getenv("OPENAI_API_KEY", ""),
            base_url=model_config.get("endpoint") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            model=model_config.get("model") or os.getenv("LLM_MODEL", "gpt-4o-mini"),
        )
        try:
            result = llm.chat(
                system_prompt="You are an embedded/microcontroller project requirements analyst.",
                user_prompt=prompt,
                response_model=RequirementOutput,
            )
            parsed = result.model_dump()
        except LLMError as e:
            raise Exception(f"LLM analysis failed: {e}")

        client.publish(q.REQUIREMENT_OUTPUT, {
            "designDraftId": message["designDraftId"],
            "requirement": parsed,
            "lang": lang,
            "modelUsed": model_config["level"],
        })
        print(f"Requirement analyzed for draft {message['designDraftId']}")

    except Exception:
        traceback.print_exc()
        client.publish(q.REQUIREMENT_OUTPUT, {
            "designDraftId": message.get("designDraftId", "unknown"),
            "error": traceback.format_exc(),
        })
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def handle_clarification_response(ch, method, properties, body):
    print(f"Clarification response received (not yet wired): {body[:100]}")
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    run_service(
        name="requirement",
        port=8001,
        declare_queues=[q.REQUIREMENT_OUTPUT, q.CLARIFICATION_REQUEST],
        bindings=[
            QueueBinding(queue=q.REQUIREMENT_INPUT, callback=analyze_requirement),
            QueueBinding(queue=q.CLARIFICATION_RESPONSE, callback=handle_clarification_response),
        ],
        client=client,
    )


if __name__ == "__main__":
    main()
