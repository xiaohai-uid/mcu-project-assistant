# Tasks 2.24–2.31 — CodegenService

## Acceptance Criteria

### 2.24 — Platform-Specific Templates
- `templates/esp32.ino.j2`: ESP32 template with WiFi/BLE setup, dual-core loop
- `templates/stm32.ino.j2`: STM32 template with HAL init, pin config

### 2.25 — Pin Assignment
- `assign_pins(components, platform)`: auto-assign digital/analog/I2C/SPI pins per platform
- Returns `[{componentName, microcontrollerPin, connectionType}]`

### 2.26 — Library Dependency Resolution
- `resolve_dependencies(components, platform)`: map component to required libraries
- Returns list of Arduino library names

### 2.27 — LLM Code Generation
- `generate_business_logic(requirement, components, pinMappings, modelConfig)`: uses LLM for specific logic
- Structured prompt with JSON schema constraints

### 2.28 — Code Quality Check
- `validate_code(code, platform)`: basic checks (setup/loop present, no syntax errors, pin conflicts)
- Returns `{ valid: bool, warnings: [str] }`

### 2.29 — Error Handling / Retry
- `retry_llm_call(model_config, prompt, max_retries=2)`: retry on LLM failure
- 5s timeout per call

### 2.30 — Multi-Platform File Structure
- Template per platform (arduino + esp32 + stm32)

### 2.31 — Message Loop
- Manual ack, try/except, error publish

## Implementation files
- **Modify:** `services/codegen-service/main.py` — full rewrite
- **Create:** `services/codegen-service/templates/esp32.ino.j2`
- **Create:** `services/codegen-service/templates/stm32.ino.j2`

Working directory: `C:\Users\Administrator\Desktop\opencode\mcu-project-assistant`

## ESP32 Template
```jinja2
/*
 * MCU Project Assistant - Generated Code
 * Platform: ESP32
 */
#include <WiFi.h>
#include <BluetoothSerial.h>
{% for dep in dependencies %}
#include <{{ dep }}>
{% endfor %}

// Pin Definitions
{% for pin in pinMappings %}
const int PIN_{{ pin.componentName | upper }}_{{ pin.connectionType | upper }} = {{ pin.microcontrollerPin }};
{% endfor %}

// Global Variables
{% for comp in components %}
// {{ comp.name }}
{% endfor %}

BluetoothSerial SerialBT;

void setup() {
  Serial.begin(115200);
  SerialBT.begin("MCU-Project");
  Serial.println("ESP32 starting...");
  {% for pin in pinMappings %}
  {% if pin.connectionType == "signal" %}
  pinMode(PIN_{{ pin.componentName | upper }}_{{ pin.connectionType | upper }}, OUTPUT);
  {% endif %}
  {% endfor %}
  Serial.println("System ready.");
}

void loop() {
  {{ businessLogic }}
}
```

## STM32 Template
```jinja2
/*
 * MCU Project Assistant - Generated Code
 * Platform: STM32 (STM32F103C8T6)
 */
#include "stm32f1xx_hal.h"
{% for dep in dependencies %}
#include <{{ dep }}>
{% endfor %}

// Pin Definitions
{% for pin in pinMappings %}
#define PIN_{{ pin.componentName | upper }}_{{ pin.connectionType | upper }} GPIO_PIN_{{ pin.microcontrollerPin }}
{% endfor %}

// Global Variables
{% for comp in components %}
// {{ comp.name }}
{% endfor %}

void SystemClock_Config(void);
static void MX_GPIO_Init(void);

int main(void) {
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  Serial.begin(115200);
  {{ businessLogic }}
}

void SystemClock_Config(void) {
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState = RCC_HSE_ON;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL = RCC_PLL_MUL9;
  HAL_RCC_OscConfig(&RCC_OscInitStruct);
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK|RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;
  HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2);
}

static void MX_GPIO_Init(void) {
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();
  // User pin init here
}
```

## Pin Assignment Logic
```python
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

COMPONENT_PIN_TYPES = {
    "sensor": "analog" if "DHT" not in component_name else "digital",
    # etc.
}
```

## Library Dependencies
```python
COMPONENT_LIBRARIES: dict[str, list[str]] = {
    "DHT11": ["DHT sensor library"],
    "DHT22": ["DHT sensor library"],
    "HC-SR04": [],  # built-in pulseIn
    "LCD1602": ["LiquidCrystal_I2C"],
    "OLED 0.96寸": ["Adafruit_SSD1306", "Adafruit_GFX"],
    "HC-05 蓝牙模块": ["SoftwareSerial"],
    "RC522 RFID": ["MFRC522"],
    "BMP280": ["Adafruit_BMP280"],
    "SG90 舵机": ["Servo"],
}
```

## Validate
```powershell
cd C:\Users\Administrator\Desktop\opencode\mcu-project-assistant
python -c "import ast; ast.parse(open('services/codegen-service/main.py', encoding='utf-8').read()); print('main.py OK')"
```

Return files created/modified and syntax validation result.