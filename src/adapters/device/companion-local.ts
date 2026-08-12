// adapters/device/companion-local.ts — DevicePort companion-local 适配器（ADR-0009；ISSUE-011 §3）
// M1 最小五能力中的设备侧：检测/烧录/串口——确定性模拟（无真实硬件；ticket §14 允许 mock/模拟验收）。
// DeviceSession 为运行时内存态（不建表）；断线/烧录中断不留半成品证据（烧录证据由 capability 写 .evidence/）。
import type { DeviceInfo, DevicePort, DeviceSession, DeviceTruth, FlashEvent, FlashResult } from "@/src/ports/device";

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
    serialLines: [],
  };
  let tick = 0;

  return {
    async detectBoard(): Promise<DeviceInfo> {
      // 确定性 Companion profile；不做真实串口发现。
      const device: DeviceInfo = opts?.device ?? { ...COMPANION_DEVICE_PROFILE, truth: companionTruth() };
      device.truth = companionTruth();
      session.device = device;
      session.stage = "connected";
      session.truth = device.truth;
      session.serialLines.push(`[system] Companion profile detected: ${device.model} on ${device.port} @ ${device.baudRate} baud`);
      tick = 0;
      return device;
    },
    disconnect(): void {
      session.stage = "disconnected";
      session.truth = companionTruth("blocked");
      if (session.device) session.device = { ...session.device, truth: session.truth };
      session.serialLines.push("[system] Device disconnected");
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
      session.stage = "flashing";
      for (const s of steps) {
        if (signal.aborted) {
          // 中断：不留半成品证据（capability 不写 .evidence）
          session.stage = "connected";
          session.truth = companionTruth("failed");
          return { exitCode: 1, sessionId: "", truth: companionTruth("failed") };
        }
        onEvent({ type: "progress", percent: s.p, message: s.m });
        onEvent({ type: "line", line: `[flash] ${s.m}` });
        await new Promise((r) => setTimeout(r, 60));
      }
      session.stage = "connected";
      session.truth = companionTruth();
      session.serialLines.push("[system] Companion firmware execution succeeded — telemetry stream starting");
      return { exitCode: 0, sessionId: `session-${Date.now().toString(36)}`, truth: companionTruth(), adapter: "companion-local", toolchain: "companion" };
    },
    session() {
      return session;
    },
    sendSerial(command: string) {
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
      session.serialLines.push(echo, response);
      tick += 1;
      return { response, truth: session.truth };
    },
    tickSerial(): void {
      tick += 1;
      if (session.stage !== "connected" || !session.device) return;
      const moisture = 40 + ((tick * 7) % 40);
      const pumpOn = tick % 3 === 0;
      session.serialLines.push(
        `Moisture Raw: ${moisture} (${Math.round((moisture / 4095) * 100)}%) | Pump State: ${pumpOn ? "ON" : "OFF"} | Temp: 24.5C`,
      );
    },
  };
}
