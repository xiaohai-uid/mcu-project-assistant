import sqlite3
import json

COMPONENTS = [
    ("Arduino Uno R3", "board", 18.00, 5.0, 14, None, "arduino", "ATmega328P, 14 digital I/O, 6 analog"),
    ("Arduino Nano", "board", 12.00, 5.0, 14, None, "arduino", "Compact version of Uno"),
    ("ESP32 DevKit V1", "board", 8.00, 3.3, 25, "WiFi,BLE", "arduino,esp32", "Dual-core, WiFi+BLE"),
    ("STM32F103C8T6", "board", 5.00, 3.3, 37, None, "arduino,stm32", "Blue Pill, 72MHz ARM"),
    ("Raspberry Pi Pico", "board", 4.00, 3.3, 26, None, "arduino", "RP2040, dual-core"),
    ("DHT11", "sensor", 2.00, 5.0, 3, "1-Wire", "arduino,esp32,stm32", "Temp 0-50°C, humidity"),
    ("DHT22", "sensor", 4.00, 5.0, 3, "1-Wire", "arduino,esp32,stm32", "Temp -40-80°C, humidity"),
    ("HC-SR04", "sensor", 1.50, 5.0, 4, None, "arduino,esp32,stm32", "Ultrasonic distance sensor"),
    ("BMP280", "sensor", 3.00, 3.3, 4, "I2C,SPI", "arduino,esp32,stm32", "Barometric pressure sensor"),
    ("MQ-135", "sensor", 2.50, 5.0, 4, None, "arduino,esp32", "Air quality sensor"),
    ("光敏电阻模块", "sensor", 1.00, 5.0, 3, None, "arduino,esp32,stm32", "Light intensity sensor"),
    ("土壤湿度传感器", "sensor", 1.50, 5.0, 3, None, "arduino,esp32", "Soil moisture sensor"),
    ("声音传感器", "sensor", 1.00, 5.0, 3, None, "arduino,esp32", "Sound detection module"),
    ("红外循迹传感器", "sensor", 1.00, 5.0, 3, None, "arduino,esp32", "IR tracking sensor"),
    ("水位传感器", "sensor", 1.50, 5.0, 3, None, "arduino,esp32", "Water level sensor"),
    ("SG90 舵机", "actuator", 2.50, 5.0, 3, None, "arduino,esp32,stm32", "180° rotation servo"),
    ("L298N 电机驱动", "actuator", 3.00, 12.0, 6, None, "arduino,esp32,stm32", "Dual H-bridge motor driver"),
    ("继电器模块", "actuator", 2.00, 5.0, 3, None, "arduino,esp32,stm32", "5V relay switch"),
    ("小型水泵", "actuator", 4.00, 5.0, 2, None, "arduino,esp32", "Mini water pump"),
    ("LED 灯带", "actuator", 3.00, 5.0, 3, None, "arduino,esp32", "RGB LED strip"),
    ("蜂鸣器", "actuator", 0.50, 5.0, 2, None, "arduino,esp32,stm32", "Passive/active buzzer"),
    ("电磁锁", "actuator", 8.00, 12.0, 2, None, "arduino,esp32", "12V electromagnetic lock"),
    ("LCD1602", "display", 2.50, 5.0, 16, "I2C", "arduino,esp32,stm32", "16x2 character LCD"),
    ("OLED 0.96寸", "display", 3.50, 3.3, 4, "I2C", "arduino,esp32,stm32", "128x64 OLED display"),
    ("LED 数码管", "display", 1.50, 5.0, 8, None, "arduino,esp32", "4-digit 7-segment display"),
    ("HC-05 蓝牙模块", "communication", 3.00, 5.0, 6, "UART", "arduino,esp32", "Bluetooth 2.0 module"),
    ("RC522 RFID", "communication", 2.00, 3.3, 8, "SPI", "arduino,esp32,stm32", "RFID card reader"),
    ("矩阵键盘 4x4", "communication", 1.50, 5.0, 8, None, "arduino,esp32,stm32", "16-key matrix pad"),
    ("5V 电源模块", "power", 3.00, None, None, None, "arduino,esp32,stm32", "AC-DC 5V power supply"),
    ("电池组 18650", "power", 5.00, None, None, None, "arduino,esp32", "3.7V 18650 battery holder"),
    ("面包板", "power", 2.00, None, None, None, "arduino,esp32,stm32", "830-point breadboard"),
    ("杜邦线套装", "power", 1.50, None, None, None, "arduino,esp32,stm32", "Male-male/female-male wires"),
]


def seed():
    conn = sqlite3.connect("components.db")
    cur = conn.cursor()

    cur.executescript(open("schema.sql").read())

    for name, cat, price, voltage, pin_cnt, protocol, platforms, desc in COMPONENTS:
        spec = json.dumps({"voltage": voltage, "pinCount": pin_cnt, "protocol": protocol})
        cur.execute(
            "INSERT OR IGNORE INTO components (name, category, price, voltage, pin_count, protocol, compatible_platforms, description, specifications) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, cat, price, voltage, pin_cnt, protocol, platforms, desc, spec),
        )

    conn.commit()
    conn.close()
    print(f"Seeded {len(COMPONENTS)} components.")


if __name__ == "__main__":
    seed()
