# Tasks 1.22–1.24 — ProjectTemplate

## Acceptance Criteria
1. **1.22:** GET /api/templates — list all public templates (id, title, description, tags, created_at)
2. **1.23:** Seed script with 8 starter templates (see list below)
3. **1.24:** Seed data applied via migration/init, templates listing returns them
4. All public (is_public=true), no auth required for listing

## Template Data Format
Each template's `template_data` stores:
```json
{
  "rawDescription": "项目描述",
  "experienceLevel": "beginner" | "intermediate",
  "platform": "arduino",
  "components": ["Arduino Uno", "DHT11", ...],
  "tags": ["温度", "湿度", "传感器"]
}
```

## 8 Starter Templates

| # | Title | Description | Platform | Components |
|---|-------|-------------|----------|------------|
| 1 | 数字温度计 | 用DHT11温湿度传感器测量环境温度并显示在LCD上 | arduino | Arduino Uno, DHT11, LCD1602, 面包板, 杜邦线 |
| 2 | 智能灯控 | 声控+光控智能灯，根据环境亮度自动开关 | arduino | Arduino Nano, 光敏电阻, 声音传感器, 继电器, LED灯带 |
| 3 | 门禁系统 | RFID刷卡+密码门禁系统，支持记录查询 | arduino | Arduino Uno, RC522 RFID模块, 电磁锁, 矩阵键盘, LCD1602 |
| 4 | 循迹小车 | 红外循迹自动行驶小车，两驱底盘 | arduino | Arduino Uno, L298N电机驱动, 红外循迹传感器, 双电机底盘, 电池组 |
| 5 | 超声波测距仪 | 超声波测距+LED显示，精确到厘米 | arduino | Arduino Uno, HC-SR04超声波, LED数码管, 蜂鸣器 |
| 6 | 蓝牙遥控车 | 手机蓝牙控制小车前进后退转向 | arduino | Arduino Nano, HC-05蓝牙模块, L298N, 四驱底盘, 电池 |
| 7 | 智能浇花系统 | 土壤湿度检测+自动浇水，带水位警报 | arduino | Arduino Uno, 土壤湿度传感器, 水泵, 继电器, 水位传感器 |
| 8 | 环境监测站 | 温湿度+气压+空气质量四合一监测站 | esp32 | ESP32, DHT22, BMP280, MQ-135, OLED显示屏 |

## Implementation files
- **Create:** `gateway/src/app/api/templates/route.ts` — GET (list all public templates)
- **Create:** `gateway/scripts/seed-templates.ts` — seed script
- **Create:** `gateway/__tests__/templates.test.ts` — template listing tests

## Route pattern
- `gateway/src/app/api/keys/route.ts` — simple GET route pattern (no auth for templates since they're public)
- No x-user-id check needed for listing templates

## Output
Return files created and test results (npx vitest run).