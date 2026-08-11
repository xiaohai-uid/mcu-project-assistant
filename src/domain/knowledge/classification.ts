// domain/knowledge/classification.ts — V2 shared/domain/classification.py TS 移植（ISSUE-005 §3/§11）
// 纯函数；测试 1:1 搬运（tests/unit/domain/knowledge/classification.test.ts）。

export const CATEGORY_MAP: Record<string, string> = {
  temperature: "sensor",
  humidity: "sensor",
  light: "sensor",
  sound: "sensor",
  motion: "sensor",
  distance: "sensor",
  pressure: "sensor",
  gas: "sensor",
  moisture: "sensor",
  motor: "actuator",
  led: "actuator",
  servo: "actuator",
  relay: "actuator",
  buzzer: "actuator",
  pump: "actuator",
  fan: "actuator",
  valve: "actuator",
  display: "display",
  lcd: "display",
  oled: "display",
  seven_segment: "display",
  bluetooth: "communication",
  wifi: "communication",
  rfid: "communication",
  keypad: "communication",
  i2c: "communication",
  spi: "communication",
  uart: "communication",
  usb: "communication",
  ethernet: "communication",
  button: "input",
  switch: "input",
  potentiometer: "input",
  joystick: "input",
  encoder: "input",
};

export function mapFunctionalityToCategory(functionality: string): string {
  return CATEGORY_MAP[functionality.toLowerCase().trim()] ?? "other";
}
