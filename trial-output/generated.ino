/*
 * 智能浇花系统
 * MCU Project Assistant - Generated Code
 * Platform: Arduino UNO
 * Generated: 2026-07-29 16:07:38 UTC
 *
 * Components:
 *   - 土壤湿度传感器 (检测土壤水分含量)
 *   - DHT22 (监测环境温湿度)
 *   - 继电器模块 (控制水泵开关)
 *   - 小型水泵 (执行浇水动作)
 *   - LCD1602 (显示温湿度和土壤状态)
 *
 * Wiring:
 *   土壤湿度传感器 -> Arduino A0 (Yellow wire)
 *   DHT22 -> Arduino 2 (Green wire)
 *   继电器模块 -> Arduino 3 (Green wire)
 *   小型水泵 -> Arduino 4 (Green wire)
 *   LCD1602 -> Arduino A4 (SDA) / A5 (SCL) (Blue (SDA) / Green (SCL) wire)
 */

// ===== Library Includes =====
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

// ===== Pin Definitions =====
const int PIN_SOIL_MOISTURE = A0;  // 土壤湿度传感器
const int PIN_DHT22 = 2;  // DHT22
const int PIN_RELAY = 3;  // 继电器模块
const int PIN_PUMP = 4;  // 小型水泵

// ===== Global Objects =====
DHT dht(PIN_DHT22, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // I2C address 0x27, 16 chars, 2 lines

// ===== Thresholds & Constants =====
const int MOISTURE_THRESHOLD = 400;  // Below this = dry soil (adjust for your sensor)
const float TEMP_THRESHOLD = 30.0;  // Temperature alert threshold (°C)
const float HUMIDITY_THRESHOLD = 60.0;  // Humidity alert threshold (%)

void setup() {
  Serial.begin(9600);
  Serial.println(F("=== 智能浇花系统 ==="));
  Serial.println(F("System initializing..."));
  dht.begin();
  pinMode(PIN_RELAY, OUTPUT);
  pinMode(PIN_PUMP, OUTPUT);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("System Ready");

  Serial.println(F("System ready."));
  delay(1000);
}

void loop() {
  // === 主循环逻辑 ===
  // 读取土壤湿度
  int moisture = analogRead(PIN_SOIL_MOISTURE);
  Serial.print(F("Soil Moisture: ")); Serial.println(moisture);
  // 读取温湿度
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  Serial.print(F("Temp: ")); Serial.print(temperature);
  Serial.print(F("C  Hum: ")); Serial.print(humidity); Serial.println(F("%"));
  // 控制执行器
  // digitalWrite(PIN_RELAY, HIGH);  // 开启
  // digitalWrite(PIN_RELAY, LOW);   // 关闭
  // 控制执行器
  // digitalWrite(PIN_PUMP, HIGH);  // 开启
  // digitalWrite(PIN_PUMP, LOW);   // 关闭

  // 判断与控制逻辑
  if (moisture < MOISTURE_THRESHOLD) {
    digitalWrite(PIN_RELAY, HIGH);  // 土壤干燥，开启水泵
    Serial.println(F("[ACTION] Watering ON"));
  } else {
    digitalWrite(PIN_RELAY, LOW);   // 土壤湿润，关闭水泵
  }

  delay(2000);  // 每2秒循环一次
}