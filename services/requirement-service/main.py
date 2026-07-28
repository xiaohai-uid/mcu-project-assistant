import os
import json
import traceback
from pydantic import BaseModel, Field
from shared.llm_client import LLMClient, LLMError
from shared.rabbitmq import queues as q
from shared.bootstrap import run_service, QueueBinding, make_rabbitmq_client
from shared.logging_config import get_logger

client = make_rabbitmq_client()
logger = get_logger("requirement")


class ExactComponent(BaseModel):
    """A specific hardware component with exact model number."""
    name: str = Field(description="Exact model name, e.g. 'DHT22', 'HC-SR04', 'LCD1602 I2C'")
    role: str = Field(description="What this component does in the project")
    interface: str = Field(description="Connection interface: analog|digital|i2c|spi|uart|pwm")


class RequirementOutput(BaseModel):
    """Structured requirement analysis output with exact component specifications."""
    title: str = Field(description="Project title in the user's language")
    description: str = Field(description="Detailed functional description (2-3 sentences)")
    functionality: list[str] = Field(description="List of functional keywords: temperature, humidity, moisture, display, motor, etc.")
    exactComponents: list[ExactComponent] = Field(description="Exact components needed with model numbers")
    pinRequirements: dict = Field(description="Pin usage summary: {digital: N, analog: N, i2c: N, pwm: N}")
    powerBudget: str = Field(description="Power requirement estimate, e.g. '5V USB, ~200mA total'")
    targetPlatform: str = "arduino"
    budgetRange: str = ""


def detect_language(text: str) -> str:
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    return "zh" if chinese_chars > len(text) * 0.1 else "en"


SYSTEM_PROMPT_ZH = """你是一位资深嵌入式系统工程师，专精 Arduino 生态。你的任务是分析用户的项目描述，输出精确到具体型号的硬件方案。

关键原则：
1. 元器件必须给出具体型号（不是"温度传感器"而是"DHT22"）
2. 优先选择 Arduino 生态中最常用、文档最丰富的模块
3. 所有模块必须兼容 Arduino UNO（5V 逻辑电平）
4. 引脚总数不能超过 Arduino UNO 的可用数（14数字 + 6模拟，其中 A4/A5 为 I2C 共用）
5. 考虑功耗：USB 供电最大 500mA

常用 Arduino 模块参考（优先从这里选）：
- 温湿度: DHT11(基础) / DHT22(精确)
- 超声波测距: HC-SR04
- 气压: BMP280 (I2C)
- 空气质量: MQ-135
- 光照: 光敏电阻模块
- 土壤湿度: 土壤湿度传感器(模拟输出)
- 声音: 声音传感器模块
- 水位: 水位传感器
- 红外循迹: 红外循迹传感器
- 舵机: SG90
- 电机驱动: L298N
- 继电器: 5V继电器模块
- 水泵: 小型水泵(配合继电器)
- LED灯带: WS2812B(Adafruit_NeoPixel)
- 蜂鸣器: 有源/无源蜂鸣器
- LCD: LCD1602 I2C模块
- OLED: 0.96寸 OLED (I2C, SSD1306)
- 蓝牙: HC-05
- RFID: RC522 (SPI)
- 键盘: 4x4矩阵键盘"""

SYSTEM_PROMPT_EN = """You are a senior embedded systems engineer specializing in the Arduino ecosystem. Your task is to analyze the user's project description and output a precise hardware bill of materials with exact model numbers.

Key principles:
1. Components must have exact model numbers (not "temperature sensor" but "DHT22")
2. Prefer the most common, well-documented modules in the Arduino ecosystem
3. All modules must be compatible with Arduino UNO (5V logic level)
4. Total pin count must not exceed Arduino UNO available pins (14 digital + 6 analog, A4/A5 shared for I2C)
5. Consider power budget: USB supply max 500mA

Common Arduino modules (prefer these):
- Temp/Humidity: DHT11 (basic) / DHT22 (precise)
- Ultrasonic: HC-SR04
- Pressure: BMP280 (I2C)
- Air quality: MQ-135
- Light: Photoresistor module
- Soil moisture: Soil moisture sensor (analog)
- Sound: Sound sensor module
- Water level: Water level sensor
- IR tracking: IR tracking sensor
- Servo: SG90
- Motor driver: L298N
- Relay: 5V relay module
- Pump: Mini water pump (with relay)
- LED strip: WS2812B (Adafruit_NeoPixel)
- Buzzer: Active/passive buzzer
- LCD: LCD1602 I2C module
- OLED: 0.96" OLED (I2C, SSD1306)
- Bluetooth: HC-05
- RFID: RC522 (SPI)
- Keypad: 4x4 matrix keypad"""


def build_user_prompt(description: str, lang: str) -> str:
    if lang == "zh":
        return f"""分析以下项目描述，输出结构化需求。注意：
- exactComponents 中每个元器件必须有具体型号
- interface 字段必须是: analog / digital / i2c / spi / uart / pwm 之一
- pinRequirements 统计所有元器件需要的引脚数

项目描述：{description}"""
    else:
        return f"""Analyze the following project description and output structured requirements. Note:
- Each component in exactComponents must have an exact model number
- interface field must be one of: analog / digital / i2c / spi / uart / pwm
- pinRequirements should summarize total pins needed by type

Project description: {description}"""


def is_vague(description: str) -> bool:
    """Detect inputs too vague to produce a meaningful hardware design."""
    if len(description.strip()) < 10:
        return True
    generic = [
        "智能家居", "a project", "something with arduino", "something",
        "物联网", "iot", "a device", "some device", "test", "项目",
        "做个东西", "随便", "demo", "hello", "hi",
    ]
    stripped = description.strip().lower()
    return stripped in generic or len(stripped.split()) <= 2


def build_clarification_questions(description: str, lang: str) -> list[str]:
    """Generate targeted clarification questions for vague inputs."""
    if lang == "zh":
        return [
            "你的项目想实现什么具体功能？（例如：自动浇花、温湿度监测、避障小车）",
            "你希望项目有哪些输入？（传感器类型：温度、湿度、距离、光照等）",
            "你希望项目有哪些输出？（显示屏、电机、蜂鸣器、LED等）",
        ]
    return [
        "What specific function should your project perform? (e.g., auto-watering, temperature monitoring, obstacle-avoiding car)",
        "What inputs do you need? (sensor types: temperature, humidity, distance, light, etc.)",
        "What outputs do you want? (display, motor, buzzer, LED, etc.)",
    ]


def analyze_requirement(ch, method, properties, body):
    try:
        message = json.loads(body)
        description = message["description"]
        model_config = message.get("modelConfig", {})
        design_draft_id = message["designDraftId"]

        lang = detect_language(description)

        if is_vague(description):
            questions = build_clarification_questions(description, lang)
            client.publish(q.CLARIFICATION_REQUEST, {
                "designDraftId": design_draft_id,
                "description": description,
                "questions": questions,
            })
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logger.info(f"Clarification requested for draft {design_draft_id}",
                        extra={"design_draft_id": design_draft_id, "stage": "requirement"})
            return

        system_prompt = SYSTEM_PROMPT_ZH if lang == "zh" else SYSTEM_PROMPT_EN
        user_prompt = build_user_prompt(description, lang)

        llm = LLMClient(
            api_key=model_config.get("apiKey") or os.getenv("OPENAI_API_KEY", ""),
            base_url=model_config.get("endpoint") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            model=model_config.get("model") or os.getenv("LLM_MODEL", "gpt-4o-mini"),
        )

        try:
            result = llm.chat(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                response_model=RequirementOutput,
                temperature=0.2,
            )
            parsed = result.model_dump()
        except LLMError as e:
            raise Exception(f"LLM analysis failed: {e}")

        # Ensure platform is always arduino (this version only supports it)
        parsed["targetPlatform"] = "arduino"

        client.publish(q.REQUIREMENT_OUTPUT, {
            "designDraftId": design_draft_id,
            "requirement": parsed,
            "lang": lang,
            "modelUsed": model_config.get("level", "unknown"),
        })
        logger.info(f"Analyzed draft {design_draft_id}: {parsed.get('title', '?')} "
                    f"({len(parsed.get('exactComponents', []))} components)",
                    extra={"design_draft_id": design_draft_id, "stage": "requirement"})

    except Exception:
        traceback.print_exc()
        client.publish(q.REQUIREMENT_OUTPUT, {
            "designDraftId": message.get("designDraftId", "unknown"),
            "error": traceback.format_exc(),
        })
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def handle_clarification_response(ch, method, properties, body):
    """Handle user's answers to clarification questions, then re-run analysis."""
    try:
        message = json.loads(body)
        answers = message.get("answers", [])
        original_description = message.get("description", "")
        design_draft_id = message.get("designDraftId", "unknown")

        # Combine original description with answers for a richer prompt
        combined = original_description
        if answers:
            combined += "\n\nUser clarifications:\n" + "\n".join(f"- {a}" for a in answers)

        # Re-publish to requirement input with enriched description
        client.publish(q.REQUIREMENT_INPUT, {
            "designDraftId": design_draft_id,
            "description": combined,
            "modelConfig": message.get("modelConfig", {}),
        })
        logger.info(f"Clarification answers received, re-analyzing draft {design_draft_id}",
                    extra={"design_draft_id": design_draft_id, "stage": "requirement"})

    except Exception:
        traceback.print_exc()
    finally:
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
