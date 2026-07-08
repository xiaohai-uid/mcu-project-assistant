import { db } from "@/lib/database";
import { v4 as uuidv4 } from "uuid";

const TEMPLATES = [
  {
    title: "数字温度计",
    description: "用 DHT11 温湿度传感器测量环境温度并显示在 LCD 上",
    templateData: {
      rawDescription: "我想做一个数字温度计，用 DHT11 测量温度，显示在 LCD 屏幕上",
      experienceLevel: "beginner",
      platform: "arduino",
      components: ["Arduino Uno", "DHT11 温湿度传感器", "LCD1602 显示屏", "面包板", "杜邦线"],
      tags: ["温度", "湿度", "传感器", "LCD"],
    },
  },
  {
    title: "智能灯控",
    description: "声控加光控智能灯，根据环境亮度自动开关",
    templateData: {
      rawDescription: "做一个智能灯控系统，支持声控和光控，环境暗时自动开灯",
      experienceLevel: "beginner",
      platform: "arduino",
      components: ["Arduino Nano", "光敏电阻", "声音传感器", "继电器模块", "LED 灯带"],
      tags: ["灯光", "声控", "光控", "智能家居"],
    },
  },
  {
    title: "门禁系统",
    description: "RFID 刷卡加密码门禁系统，支持记录查询",
    templateData: {
      rawDescription: "做一个 RFID 刷卡和密码输入的门禁系统，刷卡或输密码开门",
      experienceLevel: "intermediate",
      platform: "arduino",
      components: ["Arduino Uno", "RC522 RFID 模块", "电磁锁", "矩阵键盘", "LCD1602 显示屏"],
      tags: ["门禁", "RFID", "安全", "密码"],
    },
  },
  {
    title: "循迹小车",
    description: "红外循迹自动行驶小车，两驱底盘",
    templateData: {
      rawDescription: "做一辆循迹小车，能自动沿着黑色轨迹线行驶",
      experienceLevel: "beginner",
      platform: "arduino",
      components: ["Arduino Uno", "L298N 电机驱动", "红外循迹传感器 x4", "双电机底盘", "电池组"],
      tags: ["小车", "循迹", "电机驱动", "机器人"],
    },
  },
  {
    title: "超声波测距仪",
    description: "超声波测距加 LED 显示，精确到厘米",
    templateData: {
      rawDescription: "做一个超声波测距仪，测量距离并在数码管上显示",
      experienceLevel: "beginner",
      platform: "arduino",
      components: ["Arduino Uno", "HC-SR04 超声波模块", "LED 数码管", "蜂鸣器"],
      tags: ["测距", "超声波", "传感器", "数码管"],
    },
  },
  {
    title: "蓝牙遥控车",
    description: "手机蓝牙控制小车前进后退转向",
    templateData: {
      rawDescription: "做一辆手机蓝牙遥控的小车，可以前进后退左右转向",
      experienceLevel: "beginner",
      platform: "arduino",
      components: ["Arduino Nano", "HC-05 蓝牙模块", "L298N 电机驱动", "四驱底盘", "电池组"],
      tags: ["遥控", "蓝牙", "小车", "手机控制"],
    },
  },
  {
    title: "智能浇花系统",
    description: "土壤湿度检测加自动浇水，带水位警报",
    templateData: {
      rawDescription: "做一个智能浇花系统，检测土壤湿度自动浇水，水箱水位过低时报警",
      experienceLevel: "intermediate",
      platform: "arduino",
      components: ["Arduino Uno", "土壤湿度传感器", "小型水泵", "继电器模块", "水位传感器", "蜂鸣器"],
      tags: ["浇花", "土壤湿度", "自动", "智能家居"],
    },
  },
  {
    title: "环境监测站",
    description: "温湿度加压加空气质量四合一监测站",
    templateData: {
      rawDescription: "做一个环境监测站，检测温湿度、气压和空气质量",
      experienceLevel: "intermediate",
      platform: "esp32",
      components: ["ESP32", "DHT22 温湿度传感器", "BMP280 气压传感器", "MQ-135 空气质量传感器", "OLED 显示屏"],
      tags: ["环境", "监测", "ESP32", "空气质量"],
    },
  },
];

async function seed() {
  console.log("Seeding templates...");
  for (const t of TEMPLATES) {
    await db.query(
      `INSERT INTO project_templates (id, title, description, template_data, is_public, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [uuidv4(), t.title, t.description, JSON.stringify(t.templateData)]
    );
    console.log(`  ✓ ${t.title}`);
  }
  console.log("Done!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
