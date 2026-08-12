// ports/device.ts — DevicePort（ADR-0009 Companion 边界；ISSUE-011 §3/§9）
// 隔离硬件外部系统；DeviceSession = **运行时状态**（适配器内存态；持久化仅 last_device → preferences）。
// companion-local 适配器（M1 最小：检测/烧录/串口；确定性模拟——禁止真实硬件作为完成前提）。
import type {
  DeviceInfoDto,
  DeviceTruthDto,
  FlashResultDto,
  SerialResultDto,
} from "@/src/shared-contracts/types";

export type DeviceTruth = DeviceTruthDto;
export type DeviceInfo = DeviceInfoDto;

export type DeviceStage = "none" | "connected" | "flashing" | "disconnected";

export interface DeviceSession {
  device: DeviceInfo | null;
  stage: DeviceStage;
  truth: DeviceTruth;
  /** 串口行缓冲（遥测/回显；SSE 流读取） */
  serialLines: string[];
}

export type FlashEvent =
  | { type: "progress"; percent: number; message?: string }
  | { type: "line"; line: string }
  | { type: "done"; exitCode: number };

export type FlashResult = FlashResultDto;
export type SerialResult = SerialResultDto;

export interface DevicePort {
  /** 检测 Companion profile（确定性虚拟元数据；真实硬件接入为后续项） */
  detectBoard(): Promise<DeviceInfo>;
  /** 断开（烧录中 → 中止；不留半成品证据） */
  disconnect(): void;
  /** 烧录执行：进度事件流；signal 中断 → 中止 */
  flash(input: { deviceId: string }, onEvent: (e: FlashEvent) => void, signal: AbortSignal): Promise<FlashResult>;
  /** 运行时会话（内存态；非持久业务数据） */
  session(): DeviceSession;
  /** 发送串口命令（回显 + 遥测响应） */
  sendSerial(command: string): SerialResult;
  /** 遥测生成（连接后周期调用；Moisture/Pump 行） */
  tickSerial(): void;
}
