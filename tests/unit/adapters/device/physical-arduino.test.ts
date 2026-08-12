import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPhysicalArduinoDevice } from "@/src/adapters/device/physical-arduino";

const FQBN = "esp32:esp32:esp32s3";
const openDirs: string[] = [];

afterEach(() => {
  for (const dir of openDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may release the killed fixture a moment later. */ }
  }
});

function fixture(mode: "success" | "nonzero" | "timeout" | "changing" | "empty" | "ambiguous") {
  const dir = mkdtempSync(join(tmpdir(), "mcu-physical-fixture-"));
  openDirs.push(dir);
  const marker = join(dir, "upload.json");
  const state = join(dir, "discover.count");
  const script = [
    "const fs=require('node:fs');",
    `const marker=${JSON.stringify(marker)};const state=${JSON.stringify(state)};const mode=${JSON.stringify(mode)};`,
    "const args=process.argv.slice(1);",
    "if(args.includes('board')){let count=0;try{count=Number(fs.readFileSync(state,'utf8'))||0}catch{};count++;fs.writeFileSync(state,String(count));",
    `const ports=mode==='empty'?[]:mode==='ambiguous'?[{port:'COM9',matching_boards:[{fqbn:'${FQBN}'}]},{port:'COM10',matching_boards:[{fqbn:'${FQBN}'}]}]:[{port:mode==='changing'&&count>1?'COM10':'COM9',protocol:'serial',matching_boards:[{fqbn:'${FQBN}',vid:'303a',pid:'1001',serial_number:'fixture-1'}]}];`,
    "process.stdout.write(JSON.stringify(ports));process.exit(0);}",
    "fs.writeFileSync(marker,JSON.stringify(args));",
    "if(mode==='timeout'){setTimeout(()=>process.exit(0),3000)}else if(mode==='nonzero'){process.exit(7)}else{process.exit(0)}",
  ].join("");
  return { dir, marker, script };
}

function deviceFor(mode: Parameters<typeof fixture>[0], timeoutMs = 500) {
  const f = fixture(mode);
  const device = createPhysicalArduinoDevice({
    arduinoCliPath: process.execPath,
    executableArgsPrefix: ["-e", f.script],
    cwd: f.dir,
    timeoutMs,
    terminateGraceMs: 100,
  });
  return { ...f, device };
}

const flashInput = {
  deviceId: "unused-by-fixture",
  buildId: "build-fixture",
  artifactVersionId: "version-fixture",
  outputDir: "C:\\workspace\\.build\\build-fixture\\output",
  firmwarePath: "C:\\workspace\\.build\\build-fixture\\output\\firmware.bin",
  firmwareSha256: "a".repeat(64),
};

describe("physical Arduino CLI adapter", () => {
  it("discovers exactly one ESP32-S3 and exposes physical truth", async () => {
    const { device } = deviceFor("success");
    const detected = await device.detectBoard();
    expect(detected).toMatchObject({ port: "COM9", fqbn: FQBN, vid: "303a", pid: "1001", serialNumber: "fixture-1" });
    expect(detected.truth).toEqual({ executionReality: "physical", verification: "verified", physicalVerified: true, adapter: "esp32-arduino-physical" });
  });

  it("fails closed for zero or ambiguous supported boards", async () => {
    await expect(deviceFor("empty").device.detectBoard()).rejects.toMatchObject({ code: "PHYSICAL_DEVICE_NOT_FOUND" });
    await expect(deviceFor("ambiguous").device.detectBoard()).rejects.toMatchObject({ code: "PHYSICAL_DEVICE_AMBIGUOUS" });
  });

  it("rejects a changed current port before spawning upload", async () => {
    const f = deviceFor("changing");
    await f.device.detectBoard();
    await expect(f.device.flash(flashInput, () => undefined, new AbortController().signal)).rejects.toMatchObject({ code: "PHYSICAL_DEVICE_CHANGED" });
  });

  it("runs the controlled external upload with the exact production argv and truth", async () => {
    const f = deviceFor("success");
    const detected = await f.device.detectBoard();
    const result = await f.device.flash({ ...flashInput, deviceId: detected.id }, () => undefined, new AbortController().signal);
    expect(result).toMatchObject({ exitCode: 0, buildId: "build-fixture", artifactVersionId: "version-fixture", firmwareSha256: "a".repeat(64), port: "COM9", fqbn: FQBN, adapter: "esp32-arduino-physical", toolchain: "arduino-cli" });
    expect(result.truth).toMatchObject({ executionReality: "physical", verification: "verified", physicalVerified: true });
    const argv = JSON.parse(readFileSync(f.marker, "utf8")) as string[];
    expect(argv).toEqual(["upload", "--fqbn", FQBN, "--port", "COM9", "--input-dir", flashInput.outputDir]);
  });

  it("returns failed truth for a nonzero uploader exit", async () => {
    const f = deviceFor("nonzero");
    const detected = await f.device.detectBoard();
    const result = await f.device.flash({ ...flashInput, deviceId: detected.id }, () => undefined, new AbortController().signal);
    expect(result).toMatchObject({ exitCode: 7, sessionId: "", errorCode: "FLASH_EXIT_NONZERO" });
    expect(result.truth).toMatchObject({ executionReality: "physical", verification: "failed", physicalVerified: false });
  });

  it("terminates a timed-out uploader and never reports success", async () => {
    const f = deviceFor("timeout", 80);
    const detected = await f.device.detectBoard();
    await expect(f.device.flash({ ...flashInput, deviceId: detected.id }, () => undefined, new AbortController().signal)).rejects.toMatchObject({ code: "FLASH_TIMEOUT" });
    expect(f.device.session().truth).toMatchObject({ executionReality: "physical", physicalVerified: false });
  });

  it("cancels an in-flight uploader without a late success", async () => {
    const f = deviceFor("timeout", 3000);
    const detected = await f.device.detectBoard();
    const controller = new AbortController();
    const pending = f.device.flash({ ...flashInput, deviceId: detected.id }, () => undefined, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const result = await pending;
    expect(result).toMatchObject({ exitCode: 1, sessionId: "", errorCode: "FLASH_CANCELLED" });
    expect(result.truth).toMatchObject({ executionReality: "physical", verification: "failed", physicalVerified: false });
  });
});
