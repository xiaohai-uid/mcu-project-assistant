import { describe, expect, it } from "vitest";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";

describe("companion explicit serial session", () => {
  it("does not expose telemetry before open and stops deterministic ticks after close", async () => {
    const device = createCompanionLocalDevice();
    const detected = await device.detectBoard();
    device.tickSerial();
    expect(device.session().stage).toBe("detected");
    expect(device.session().serialLines.some((line) => line.includes("Moisture Raw"))).toBe(false);
    await expect(device.writeSerial("missing", "STATUS")).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_OPEN" });

    const serial = await device.openSerialSession({ projectId: "project-a", deviceId: detected.id });
    const linesBeforeClose = device.session().serialLines.length;
    device.tickSerial();
    expect(device.session().serialLines.length).toBeGreaterThan(linesBeforeClose);
    expect(device.getSerialSession("project-b", serial.sessionId)).toBeNull();
    await device.closeSerialSession(serial.sessionId);
    const linesAfterClose = device.session().serialLines.length;
    device.tickSerial();
    expect(device.session().serialLines.length).toBe(linesAfterClose);
    expect(device.session()).toMatchObject({ stage: "detected", serialStage: "disconnected", serialSessionId: null });
  });

  it("fails closed instead of replacing an active serial session", async () => {
    const device = createCompanionLocalDevice();
    const detected = await device.detectBoard();
    const first = await device.openSerialSession({ projectId: "project-a", deviceId: detected.id });
    await expect(device.openSerialSession({ projectId: "project-b", deviceId: detected.id })).rejects.toMatchObject({ code: "DEVICE_BUSY" });
    expect(device.getSerialSession("project-a", first.sessionId)).toMatchObject({ sessionId: first.sessionId });
    await device.closeSerialSession(first.sessionId);
  });

  it("allows only one companion flash and does not interleave progress", async () => {
    const device = createCompanionLocalDevice();
    const detected = await device.detectBoard();
    const input = (buildId: string) => ({ deviceId: detected.id, buildId, artifactVersionId: `version-${buildId}`, outputDir: "", firmwarePath: "", firmwareSha256: "a".repeat(64) });
    const events: string[] = [];
    const first = device.flash(input("a"), (event) => events.push(`a:${event.type}`), new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(device.flash(input("b"), (event) => events.push(`b:${event.type}`), new AbortController().signal)).rejects.toMatchObject({ code: "DEVICE_BUSY" });
    const result = await first;
    expect(result.exitCode).toBe(0);
    expect(events.every((event) => event.startsWith("a:"))).toBe(true);
  });

  it("rejects flash while a companion serial session owns the device", async () => {
    const device = createCompanionLocalDevice();
    const detected = await device.detectBoard();
    const serial = await device.openSerialSession({ projectId: "project-a", deviceId: detected.id });
    await expect(device.flash({ deviceId: detected.id, buildId: "b", artifactVersionId: "v", outputDir: "", firmwarePath: "", firmwareSha256: "a".repeat(64) }, () => undefined, new AbortController().signal)).rejects.toMatchObject({ code: "DEVICE_BUSY" });
    expect(device.getSerialSession("project-a", serial.sessionId)).toMatchObject({ sessionId: serial.sessionId });
    await device.closeSerialSession(serial.sessionId);
  });
});
