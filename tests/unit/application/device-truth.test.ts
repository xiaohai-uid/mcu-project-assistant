import { describe, expect, it } from "vitest";
import { createCompanionLocalDevice } from "@/src/adapters/device/companion-local";
import {
  createFlashTokenStore,
  flashDevice,
  PhysicalFlashBlockedError,
  type FlashCapabilityDeps,
} from "@/src/application/capabilities/flash";
import type { DevicePort } from "@/src/ports/device";

describe("P0-04 device truth boundary", () => {
  it("companion detect/flash/serial truth is explicit and never claims physical verification", async () => {
    const device = createCompanionLocalDevice();
    const detected = await device.detectBoard();
    expect(detected.truth).toEqual({
      executionReality: "companion",
      verification: "verified",
      physicalVerified: false,
      adapter: "companion-local",
    });

    const flashed = await device.flash({ deviceId: detected.id, buildId: "build-1", artifactVersionId: "version-1", outputDir: "workspace/.build/build-1/output", firmwarePath: "workspace/.build/build-1/output/firmware.bin", firmwareSha256: "a".repeat(64) }, () => undefined, new AbortController().signal);
    expect(flashed.truth).toMatchObject({ executionReality: "companion", verification: "verified", physicalVerified: false });
    expect(device.sendSerial("GET_STATUS").truth).toMatchObject({ executionReality: "companion", physicalVerified: false });
    device.disconnect();
    expect(device.session().truth).toMatchObject({ executionReality: "companion", verification: "blocked", physicalVerified: false });
    expect(device.session().device?.truth).toMatchObject({ executionReality: "companion", verification: "blocked", physicalVerified: false });
  });

  it("physical request is blocked before task submission or companion invocation", async () => {
    const companion = createCompanionLocalDevice();
    await companion.detectBoard();
    let flashCalls = 0;
    const originalFlash = companion.flash;
    const device: DevicePort = {
      ...companion,
      flash: async (...args) => {
        flashCalls += 1;
        return originalFlash(...args);
      },
    };
    const tokens = createFlashTokenStore();
    const token = tokens.issue("companion-esp32s3", new Date("2026-08-12T00:00:00.000Z"));
    let submissions = 0;
    const published: unknown[] = [];
    const deps = {
      device,
      tokens,
      persistence: {} as FlashCapabilityDeps["persistence"],
      events: { publish: (event: unknown) => published.push(event) },
      workspaceDir: "workspace",
      tasks: { submit: async () => { submissions += 1; return "unexpected"; }, cancel: async () => false, getTask: async () => null } as unknown as FlashCapabilityDeps["tasks"],
      now: () => new Date("2026-08-12T00:00:00.000Z"),
    } satisfies FlashCapabilityDeps;

    await expect(flashDevice({
      deviceId: "companion-esp32s3",
      confirmationToken: token.token,
      projectId: "project-1",
      buildId: "not-read-because-physical-is-blocked",
      artifactVersionId: "version-1",
      executionReality: "physical",
    }, deps)).rejects.toBeInstanceOf(PhysicalFlashBlockedError);
    expect(submissions).toBe(0);
    expect(flashCalls).toBe(0);
    expect(published).toEqual([]);
  });
});
