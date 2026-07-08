import os
import json
import time
from typing import Optional, Type, TypeVar
from openai import OpenAI
from pydantic import BaseModel

T = TypeVar('T', bound=BaseModel)

class LLMError(Exception):
    pass

MOCK_MODE = os.getenv("MOCK_MODE", "").lower() in ("true", "1", "yes")

MOCK_REQUIREMENT = {
    "title": "温湿度监测器",
    "description": "基于Arduino的温湿度监测与LCD显示系统，使用DHT22传感器采集数据，通过LCD1602显示屏实时显示温湿度信息",
    "functionality": ["temperature", "humidity", "display"],
    "io": {"inputDevices": ["DHT22温湿度传感器"], "outputDevices": ["LCD1602显示屏"]},
    "communication": {"protocols": ["I2C"], "remoteControl": False},
    "powerSupply": "5V USB供电",
    "targetPlatform": "arduino",
    "budgetRange": "30-50元",
}

MOCK_RECOMMENDATION = {
    "components": [
        {"name": "Arduino Uno R3", "quantity": 1, "purpose": "主控制器", "estimatedCost": 25.0},
        {"name": "DHT22温湿度传感器模块", "quantity": 1, "purpose": "温湿度采集", "estimatedCost": 8.0},
        {"name": "LCD1602 I2C模块", "quantity": 1, "purpose": "数据显示", "estimatedCost": 12.0},
        {"name": "杜邦线公对母", "quantity": 20, "purpose": "连接线", "estimatedCost": 3.0},
        {"name": "面包板400孔", "quantity": 1, "purpose": "电路搭建", "estimatedCost": 4.0},
        {"name": "USB数据线", "quantity": 1, "purpose": "供电与程序下载", "estimatedCost": 5.0},
    ],
    "totalCost": 57.0,
    "notes": "以上为参考价格，实际价格可能因购买渠道和地区有所不同",
}

MOCK_CODE = """#include <DHT.h>
#include <LiquidCrystal_I2C.h>

#define DHTPIN 2
#define DHTTYPE DHT22

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  Serial.begin(9600);
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Temp/Humidity");
  delay(2000);
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    lcd.setCursor(0, 0);
    lcd.print("Sensor Error! ");
    return;
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Temp: ");
  lcd.print(t);
  lcd.print(" C");

  lcd.setCursor(0, 1);
  lcd.print("Hum:  ");
  lcd.print(h);
  lcd.print(" %");

  delay(2000);
}"""

MOCK_SCHEMATIC = {
    "connections": [
        {"from": "Arduino Uno (5V)", "to": "DHT22 (VCC)", "wireColor": "red"},
        {"from": "Arduino Uno (GND)", "to": "DHT22 (GND)", "wireColor": "black"},
        {"from": "Arduino Uno (D2)", "to": "DHT22 (DATA)", "wireColor": "yellow"},
        {"from": "Arduino Uno (5V)", "to": "LCD1602 (VCC)", "wireColor": "red"},
        {"from": "Arduino Uno (GND)", "to": "LCD1602 (GND)", "wireColor": "black"},
        {"from": "Arduino Uno (A4/SDA)", "to": "LCD1602 (SDA)", "wireColor": "blue"},
        {"from": "Arduino Uno (A5/SCL)", "to": "LCD1602 (SCL)", "wireColor": "green"},
    ],
    "notes": "DHT22 DATA pin requires 4.7k-10k pull-up resistor to VCC",
}

MOCK_PINS = {
    "pins": [
        {"pin": "5V", "connectedTo": "DHT22 VCC, LCD1602 VCC", "type": "power"},
        {"pin": "GND", "connectedTo": "DHT22 GND, LCD1602 GND", "type": "ground"},
        {"pin": "D2", "connectedTo": "DHT22 DATA", "type": "digital"},
        {"pin": "A4 (SDA)", "connectedTo": "LCD1602 SDA", "type": "i2c"},
        {"pin": "A5 (SCL)", "connectedTo": "LCD1602 SCL", "type": "i2c"},
    ]
}

def _generate_mock_response(response_model):
    fields = {}
    for name, field in response_model.model_fields.items():
        ann = field.annotation
        if ann is str or ann == str:
            fields[name] = MOCK_REQUIREMENT.get(name, f"mock_{name}")
        elif getattr(ann, "__origin__", None) is list:
            inner = ann.__args__[0]
            if inner is str or inner == str:
                fields[name] = MOCK_REQUIREMENT.get(name, ["mock_item"])
            else:
                fields[name] = MOCK_REQUIREMENT.get(name, [{}])
        elif getattr(ann, "__origin__", None) is dict or ann is dict:
            fields[name] = MOCK_REQUIREMENT.get(name, {"key": "value"})
        else:
            fields[name] = MOCK_REQUIREMENT.get(name, "mock_value")
    return response_model(**fields)

class LLMClient:
    """OpenAI-compatible LLM client with structured output support."""

    def __init__(self, api_key=None, base_url=None, model=None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.model = model or os.getenv("LLM_MODEL", "gpt-4o-mini")
        self.max_retries = int(os.getenv("LLM_MAX_RETRIES", "2"))

    def chat(self, system_prompt: str, user_prompt: str, response_model: Optional[Type[T]] = None, temperature: float = 0.3) -> str | T:
        if MOCK_MODE:
            print(f"[Mock] LLM call: model={self.model}, prompt_len={len(user_prompt)}")
            if response_model is not None:
                return _generate_mock_response(response_model)
            return json.dumps(MOCK_REQUIREMENT, ensure_ascii=False)

        client = OpenAI(api_key=self.api_key, base_url=self.base_url)

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})

        last_error = None
        for attempt in range(self.max_retries + 1):
            try:
                if response_model:
                    completion = client.beta.chat.completions.parse(
                        model=self.model,
                        messages=messages,
                        response_format=response_model,
                        temperature=temperature,
                    )
                    return completion.choices[0].message.parsed
                else:
                    completion = client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        temperature=temperature,
                    )
                    return completion.choices[0].message.content
            except Exception as e:
                last_error = str(e)
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)

        raise LLMError(f"LLM call failed after {self.max_retries+1} attempts: {last_error}")
