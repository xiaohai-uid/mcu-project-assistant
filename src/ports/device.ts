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

export type DeviceStage = "none" | "detected" | "connected" | "flashing" | "disconnected";
export type SerialStage = "disconnected" | "opening" | "connected" | "error";

export interface SerialSession {
  sessionId: string;
  projectId: string;
  deviceId: string;
  executionReality: DeviceTruth["executionReality"];
  port: string;
  baudRate: number;
  adapter: string;
  openedAt: string;
  status: "connected" | "error" | "closed";
}

export type SerialSessionEvent =
  | { type: "line"; session: SerialSession; line: string; receivedAt: string }
  | { type: "error"; session: SerialSession; code: string; message: string; receivedAt: string }
  | { type: "closed"; session: SerialSession; reason: string; receivedAt: string };

export class SerialSessionNotFoundError extends Error {
  readonly code = "SERIAL_SESSION_NOT_FOUND";
  constructor() { super("Serial session not found"); this.name = "SerialSessionNotFoundError"; }
}

export class SerialSessionNotOpenError extends Error {
  readonly code = "SERIAL_SESSION_NOT_OPEN";
  constructor() { super("Serial session is not open"); this.name = "SerialSessionNotOpenError"; }
}

export class SerialDeviceNotFoundError extends Error {
  readonly code = "SERIAL_DEVICE_NOT_FOUND";
  constructor() { super("The requested device is not present in fresh discovery"); this.name = "SerialDeviceNotFoundError"; }
}

export class SerialDeviceChangedError extends Error {
  readonly code = "SERIAL_DEVICE_CHANGED";
  constructor() { super("The current physical device changed before serial open"); this.name = "SerialDeviceChangedError"; }
}

export class DeviceBusyError extends Error {
  readonly code = "DEVICE_BUSY";
  constructor() { super("Device is busy with another operation"); this.name = "DeviceBusyError"; }
}

export interface DeviceSession {
  device: DeviceInfo | null;
  stage: DeviceStage;
  truth: DeviceTruth;
  serialStage: SerialStage;
  serialSessionId: string | null;
  /** Legacy in-memory evidence buffer; live production SSE is session-scoped. */
  serialLines: string[];
}

export type FlashEvent =
  | { type: "progress"; percent: number; message?: string }
  | { type: "line"; line: string }
  | { type: "done"; exitCode: number };

export type FlashResult = FlashResultDto;
export type SerialResult = SerialResultDto;

export interface DevicePort {
  /** Discover a current device. This never opens a serial transport. */
  detectBoard(): Promise<DeviceInfo>;
  /** 断开（烧录中 → 中止；不留半成品证据） */
  disconnect(): Promise<void>;
  /** 烧录执行：只消费应用层已验证的构建证据；signal 中断 → 中止 */
  flash(input: {
    projectId?: string;
    operationId?: string;
    deviceId: string;
    buildId: string;
    artifactVersionId: string;
    outputDir: string;
    firmwarePath: string;
    firmwareSha256: string;
  }, onEvent: (e: FlashEvent) => void, signal: AbortSignal): Promise<FlashResult>;
  /** 运行时会话（内存态；非持久业务数据） */
  session(): DeviceSession;
  /** Explicit serial session; discovery and flash never create one. */
  openSerialSession(input: { projectId: string; deviceId: string; baudRate?: number }): Promise<SerialSession>;
  closeSerialSession(sessionId: string): Promise<void>;
  getSerialSession(projectId: string, sessionId: string): SerialSession | null;
  subscribeSerialSession(projectId: string, sessionId: string, listener: (event: SerialSessionEvent) => void): () => void;
  writeSerial(sessionId: string, command: string): Promise<SerialResult>;
  /** Legacy companion tick seam; only active companion sessions may emit. */
  tickSerial(): void;
  /** Close every live transport during process shutdown. */
  shutdown(): Promise<void>;
}
