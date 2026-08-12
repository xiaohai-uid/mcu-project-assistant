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
});
