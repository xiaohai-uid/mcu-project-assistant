"""Deterministic code generation helpers for Arduino projects.

These functions generate the non-LLM parts of Arduino code:
- Global object declarations (DHT dht(...), LiquidCrystal_I2C lcd(...), etc.)
- Threshold constants
- setup() initialization lines
- Mock business logic (fallback when LLM unavailable)
- Code validation
- Upload instructions

Shared between codegen-service and trial_run.py.
"""

import re
from shared.domain.pins import COMPONENT_INTERFACE, sanitize_pin_name


def build_global_objects(components: list[dict]) -> list[str]:
    """Generate global object declarations based on component types."""
    objects = []
    for comp in components:
        name = comp.get("name", "")
        if "DHT11" in name or "DHT22" in name:
            dtype = "DHT22" if "22" in name else "DHT11"
            pin_var = f"PIN_{sanitize_pin_name(name)}"
            objects.append(f"DHT dht({pin_var}, {dtype});")
        elif "LCD1602" in name:
            objects.append("LiquidCrystal_I2C lcd(0x27, 16, 2);  // I2C address 0x27, 16 chars, 2 lines")
        elif "OLED" in name or "SSD1306" in name:
            objects.append("Adafruit_SSD1306 display(128, 64, &Wire);")
        elif "SG90" in name or "舵机" in name:
            objects.append("Servo servo;")
        elif "HC-SR04" in name:
            pin_var = f"PIN_{sanitize_pin_name(name)}"
            objects.append(f"NewPing sonar({pin_var}_TRIG, {pin_var}_ECHO, 200);  // max 200cm")
        elif "BMP280" in name:
            objects.append("Adafruit_BMP280 bmp;  // I2C")
        elif "NeoPixel" in name or "LED 灯带" in name:
            pin_var = f"PIN_{sanitize_pin_name(name)}"
            objects.append(f"Adafruit_NeoPixel strip(30, {pin_var}, NEO_GRB + NEO_KHZ800);")
        elif "HC-05" in name or "蓝牙" in name:
            objects.append("SoftwareSerial btSerial(2, 3);  // RX, TX")
        elif "RC522" in name or "RFID" in name:
            objects.append("MFRC522 rfid(10, 9);  // SS, RST")
    return objects


def build_constants(components: list[dict]) -> list[str]:
    """Generate threshold constants based on project context."""
    constants = []
    for comp in components:
        name = comp.get("name", "")
        if "土壤湿度" in name:
            constants.append("const int MOISTURE_THRESHOLD = 400;  // Below this = dry soil (adjust for your sensor)")
        elif "DHT" in name:
            constants.append("const float TEMP_THRESHOLD = 30.0;  // Temperature alert threshold (°C)")
            constants.append("const float HUMIDITY_THRESHOLD = 60.0;  // Humidity alert threshold (%)")
        elif "HC-SR04" in name:
            constants.append("const int DISTANCE_THRESHOLD = 20;  // Distance alert threshold (cm)")
        elif "光敏" in name:
            constants.append("const int LIGHT_THRESHOLD = 500;  // Below this = dark (0-1023)")
        elif "声音" in name:
            constants.append("const int SOUND_THRESHOLD = 600;  // Above this = loud (0-1023)")
    if not constants:
        constants.append("const int LOOP_DELAY = 2000;  // Main loop delay (ms)")
    return constants


def build_setup_lines(components: list[dict], pin_mappings: list[dict]) -> list[str]:
    """Generate setup() initialization lines deterministically."""
    lines = []
    for comp in components:
        name = comp.get("name", "")
        iface = comp.get("interface", "")
        info = COMPONENT_INTERFACE.get(name, {})
        io_type = info.get("type", "input")

        # Pin mode for digital/pwm outputs
        if iface in ("digital", "pwm") and io_type == "output":
            pin_var = f"PIN_{sanitize_pin_name(name)}"
            lines.append(f"pinMode({pin_var}, OUTPUT);")

        # Component-specific init
        if "DHT" in name:
            lines.append("dht.begin();")
        elif "LCD1602" in name:
            lines.append("lcd.init();")
            lines.append("lcd.backlight();")
            lines.append('lcd.setCursor(0, 0);')
            lines.append('lcd.print("System Ready");')
        elif "OLED" in name:
            lines.append("display.begin(SSD1306_SWITCHCAPVCC, 0x3C);")
            lines.append("display.clearDisplay();")
            lines.append("display.display();")
        elif "SG90" in name or "舵机" in name:
            pin_var = f"PIN_{sanitize_pin_name(name)}"
            lines.append(f"servo.attach({pin_var});")
        elif "NeoPixel" in name or "LED 灯带" in name:
            lines.append("strip.begin();")
            lines.append("strip.show();")
        elif "HC-05" in name or "蓝牙" in name:
            lines.append("btSerial.begin(9600);")
        elif "RC522" in name:
            lines.append("SPI.begin();")
            lines.append("rfid.PCD_Init();")
        elif "BMP280" in name:
            lines.append("bmp.begin(0x76);  // or 0x77 depending on module")

    return lines


def mock_business_logic(components: list[dict], pin_mappings: list[dict]) -> str:
    """Generate a deterministic fallback business logic when LLM is unavailable."""
    lines = []
    lines.append("  // === 主循环逻辑 ===")

    for comp in components:
        name = comp.get("name", "")
        if comp.get("category") in ("board", "accessory", "power"):
            continue
        pin_var = f"PIN_{sanitize_pin_name(name)}"

        if "土壤湿度" in name:
            lines.append(f"  // 读取土壤湿度")
            lines.append(f"  int moisture = analogRead({pin_var});")
            lines.append(f'  Serial.print(F("Soil Moisture: ")); Serial.println(moisture);')
        elif "DHT" in name:
            lines.append(f"  // 读取温湿度")
            lines.append(f"  float humidity = dht.readHumidity();")
            lines.append(f"  float temperature = dht.readTemperature();")
            lines.append(f'  Serial.print(F("Temp: ")); Serial.print(temperature);')
            lines.append(f'  Serial.print(F("C  Hum: ")); Serial.print(humidity); Serial.println(F("%"));')
        elif "光敏" in name:
            lines.append(f"  int light = analogRead({pin_var});")
            lines.append(f'  Serial.print(F("Light: ")); Serial.println(light);')
        elif "HC-SR04" in name:
            lines.append(f"  int distance = sonar.ping_cm();")
            lines.append(f'  Serial.print(F("Distance: ")); Serial.print(distance); Serial.println(F("cm"));')
        elif "继电器" in name or "小型水泵" in name:
            lines.append(f"  // 控制执行器")
            lines.append(f"  // digitalWrite({pin_var}, HIGH);  // 开启")
            lines.append(f"  // digitalWrite({pin_var}, LOW);   // 关闭")

    # Add decision logic if we have both sensors and actuators
    sensors = [c for c in components if c.get("category") == "sensor"]
    actuators = [c for c in components if c.get("category") == "actuator"]
    if sensors and actuators:
        lines.append("")
        lines.append("  // 判断与控制逻辑")
        if any("土壤湿度" in c.get("name", "") for c in sensors) and \
           any("水泵" in c.get("name", "") or "继电器" in c.get("name", "") for c in actuators):
            act = next((c for c in actuators if "水泵" in c.get("name", "") or "继电器" in c.get("name", "")), None)
            if act:
                act_pin = f"PIN_{sanitize_pin_name(act['name'])}"
                lines.append(f"  if (moisture < MOISTURE_THRESHOLD) {{")
                lines.append(f"    digitalWrite({act_pin}, HIGH);  // 土壤干燥，开启水泵")
                lines.append(f'    Serial.println(F("[ACTION] Watering ON"));')
                lines.append(f"  }} else {{")
                lines.append(f"    digitalWrite({act_pin}, LOW);   // 土壤湿润，关闭水泵")
                lines.append(f"  }}")

    lines.append("")
    lines.append("  delay(2000);  // 每2秒循环一次")
    return "\n".join(lines)


def validate_code(code: str, pin_mappings: list[dict]) -> dict:
    """Validate generated code for common issues."""
    warnings = []
    if "void setup()" not in code:
        warnings.append("Missing setup() function")
    if "void loop()" not in code:
        warnings.append("Missing loop() function")

    # Check pin consistency
    for pin in pin_mappings:
        if pin.get("connectionType") in ("analog", "digital", "pwm"):
            pin_name = pin["microcontrollerPin"].split()[0]
            comp_name = pin["componentName"]
            sanitized = sanitize_pin_name(comp_name)
            if f"PIN_{sanitized}" not in code and pin_name not in code:
                warnings.append(f"Pin for {comp_name} ({pin_name}) not referenced in code")

    return {"valid": len(warnings) == 0, "warnings": warnings}


def build_upload_instructions(components: list[dict], dependencies: list[str]) -> dict:
    """Generate step-by-step upload instructions for beginners."""
    steps = [
        "下载安装 Arduino IDE: https://www.arduino.cc/en/software",
        "用 USB 数据线连接 Arduino UNO 到电脑",
        "打开 Arduino IDE → 工具 → 开发板 → 选择 'Arduino Uno'",
        "工具 → 端口 → 选择出现的 COM 口",
    ]
    if dependencies:
        steps.append(f"安装库: 工具 → 管理库 → 搜索并安装: {', '.join(dependencies)}")
    steps.append("将生成的代码复制到 Arduino IDE 编辑器中")
    steps.append("点击 '上传' 按钮 (→ 箭头图标)")
    steps.append("等待编译和上传完成，看到 'Done uploading' 即成功")
    steps.append("打开串口监视器 (工具 → 串口监视器, 波特率 9600) 查看运行状态")

    lib_commands = []
    for dep in dependencies:
        lib_commands.append(f"arduino-cli lib install \"{dep}\"")

    return {
        "steps": steps,
        "libraryCommands": lib_commands,
        "ideUrl": "https://www.arduino.cc/en/software",
    }
