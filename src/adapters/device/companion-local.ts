// adapters/device/companion-local.ts — DevicePort companion-local 适配器（ADR-0009；ISSUE-011 §3）
// M1 最小五能力中的设备侧：检测/烧录/串口——确定性模拟（无真实硬件；ticket §14 允许 mock/模拟验收）。
// DeviceSession 为运行时内存态（不建表）；断线/烧录中断不留半成品证据（烧录证据由 capability 写 .evidence/）。
import { randomUUID } from "node:crypto";
import { SerialDeviceNotFoundError, SerialSessionNotOpenError, type DeviceInfo, type DevicePort, type DeviceSession, type DeviceTruth, type FlashEvent, type FlashResult, type SerialSession, type SerialSessionEvent } from "@/src/ports/device";

const companionTruth = (verification: DeviceTruth["verification"] = "verified"): DeviceTruth => ({
  executionReality: "companion",
  verification,
  physicalVerified: false,
  adapter: "companion-local",
});

/**
 * Deterministic Companion profile. This is virtual execution metadata, not
 * serial-port discovery and never evidence that physical hardware was used.
 */
export const COMPANION_DEVICE_PROFILE = Object.freeze({
  id: "companion-esp32s3",
  model: "ESP32-S3 WROOM-1 (companion)",
  port: "companion-local",
  baudRate: 115200,
});

export function createCompanionLocalDevice(opts?: { device?: DeviceInfo }): DevicePort {
  const session: DeviceSession = {
    device: null,
    stage: "none",
    truth: companionTruth("blocked"),
    serialStage: "disconnected",
    serialSessionId: null,
    serialLines: [],
  };
  let tick = 0;
  let activeSerial: SerialSession | null = null;
  const listeners = new Map<string, Set<(event: SerialSessionEvent) => void>>();

  const emit = (event: SerialSessionEvent): void => {
    for (const listener of listeners.get(event.session.sessionId) ?? []) listener(event);
  };

  const closeSerialSession = async (sessionId: string): Promise<void> => {
    if (!activeSerial || activeSerial.sessionId !== sessionId) return;
    const closed = { ...activeSerial, status: "closed" as const };
    activeSerial = null;
    session.serialStage = "disconnected";
    session.serialSessionId = null;
    if (session.stage !== "disconnected") session.stage = "detected";
    emit({ type: "closed", session: closed, reason: "explicit_close", receivedAt: new Date().toISOString() });
  };

  const line = (value: string): void => {
    session.serialLines.push(value);
    if (!activeSerial) return;
    emit({ type: "line", session: { ...activeSerial }, line: value, receivedAt: new Date().toISOString() });
  };

  return {
    async detectBoard(): Promise<DeviceInfo> {
      // 确定性 Companion profile；不做真实串口发现。
      const device: DeviceInfo = opts?.device ?? { ...COMPANION_DEVICE_PROFILE, truth: companionTruth() };
      device.truth = companionTruth();
      session.device = device;
      if (activeSerial) await closeSerialSession(activeSerial.sessionId);
      session.stage = "detected";
      session.truth = device.truth;
      line(`[system] Companion profile detected: ${device.model} on ${device.port} @ ${device.baudRate} baud`);
      tick = 0;
      return device;
    },
    async disconnect(): Promise<void> {
      await closeSerialSession(activeSerial?.sessionId ?? "");
      session.stage = "disconnected";
      session.serialStage = "disconnected";
      session.serialSessionId = null;
      session.truth = companionTruth("blocked");
      if (session.device) session.device = { ...session.device, truth: session.truth };
      line("[system] Device disconnected");
    },
    async flash(input: { deviceId: string; buildId: string; artifactVersionId: string; outputDir: string; firmwarePath: string; firmwareSha256: string }, onEvent: (e: FlashEvent) => void, signal: AbortSignal): Promise<FlashResult> {
      const steps = [
        { p: 10, m: "Opening serial port..." },
        { p: 25, m: "Erasing flash..." },
        { p: 45, m: "Uploading firmware binary..." },
        { p: 70, m: "Verifying..." },
        { p: 85, m: "Resetting board..." },
        { p: 100, m: "Flash complete" },
      ];
      await closeSerialSession(activeSerial?.sessionId ?? "");
      session.stage = "flashing";
      for (const s of steps) {
        if (signal.aborted) {
          // 中断：不留半成品证据（capability 不写 .evidence）
          session.stage = "detected";
          session.truth = companionTruth("failed");
          return { exitCode: 1, sessionId: "", truth: companionTruth("failed") };
        }
        onEvent({ type: "progress", percent: s.p, message: s.m });
        onEvent({ type: "line", line: `[flash] ${s.m}` });
        await new Promise((r) => setTimeout(r, 60));
      }
      session.stage = "detected";
      session.truth = companionTruth();
      line("[system] Companion firmware execution succeeded — telemetry available after explicit serial open");
      return { exitCode: 0, sessionId: `session-${Date.now().toString(36)}`, truth: companionTruth(), adapter: "companion-local", toolchain: "companion" };
    },
    session() {
      return session;
    },
    async openSerialSession(input: { projectId: string; deviceId: string; baudRate?: number }): Promise<SerialSession> {
      if (!session.device || session.device.id !== input.deviceId || session.stage === "disconnected") {
        throw new SerialDeviceNotFoundError();
      }
      if (activeSerial) await closeSerialSession(activeSerial.sessionId);
      const opened: SerialSession = {
        sessionId: `companion-serial-${randomUUID()}`,
        projectId: input.projectId,
        deviceId: input.deviceId,
        executionReality: "companion",
        port: session.device.port,
        baudRate: input.baudRate ?? session.device.baudRate,
        adapter: "companion-local",
        openedAt: new Date().toISOString(),
        status: "connected",
      };
      activeSerial = opened;
      session.stage = "connected";
      session.serialStage = "connected";
      session.serialSessionId = opened.sessionId;
      line(`[system] Companion serial simulation opened @ ${opened.baudRate} baud`);
      return { ...opened };
    },
    closeSerialSession,
    getSerialSession(projectId: string, sessionId: string): SerialSession | null {
      return activeSerial && activeSerial.projectId === projectId && activeSerial.sessionId === sessionId ? { ...activeSerial } : null;
    },
    subscribeSerialSession(projectId: string, sessionId: string, listener: (event: SerialSessionEvent) => void): () => void {
      if (!activeSerial || activeSerial.projectId !== projectId || activeSerial.sessionId !== sessionId) return () => undefined;
      const sessionListeners = listeners.get(sessionId) ?? new Set<(event: SerialSessionEvent) => void>();
      sessionListeners.add(listener);
      listeners.set(sessionId, sessionListeners);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(sessionId);
      };
    },
    async writeSerial(sessionId: string, command: string) {
      if (!activeSerial || activeSerial.sessionId !== sessionId) throw new SerialSessionNotOpenError();
      return sendSerial(command);
    },
    tickSerial(): void {
      tick += 1;
      if (!activeSerial || session.serialStage !== "connected" || !session.device) return;
      const moisture = 40 + ((tick * 7) % 40);
      const pumpOn = tick % 3 === 0;
      line(
        `Moisture Raw: ${moisture} (${Math.round((moisture / 4095) * 100)}%) | Pump State: ${pumpOn ? "ON" : "OFF"} | Temp: 24.5C`,
      );
    },
    async shutdown(): Promise<void> {
      await closeSerialSession(activeSerial?.sessionId ?? "");
    },
  };

  function sendSerial(command: string) {
    if (!activeSerial) throw new SerialSessionNotOpenError();
    const trimmed = command.trim();
    if (!trimmed) return { response: "", truth: session.truth };
    const echo = `> ${trimmed}`;
    const upper = trimmed.toUpperCase();
    let response: string;
    if (upper.includes("GET_STATUS")) {
      response = `STATUS moisture=${Math.round((40 + ((tick * 7) % 40)) / 4095 * 100)}% pump=${(tick % 3) === 0 ? "ON" : "OFF"} temp=24.5C`;
    } else if (upper.includes("SET_THRESHOLD")) {
      response = "OK threshold updated";
    } else {
      response = `ACK ${trimmed}`;
    }
    line(echo);
    line(response);
    tick += 1;
    return { response, truth: session.truth };
  }
}
