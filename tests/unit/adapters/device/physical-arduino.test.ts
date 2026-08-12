import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPhysicalArduinoDevice } from "@/src/adapters/device/physical-arduino";
import type { SerialTransport } from "@/src/adapters/device/serial-transport";

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

class ControlledSerialTransport implements SerialTransport {
  isOpen = false;
  readonly writes: string[] = [];
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();

  on(event: "open", listener: () => void): this;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (error?: Error) => void): this;
  on(event: "open" | "data" | "error" | "close", listener: (...args: never[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  once(event: "open", listener: () => void): this;
  once(event: "data", listener: (chunk: Buffer) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (error?: Error) => void): this;
  once(event: "open" | "data" | "error" | "close", listener: (...args: never[]) => void): this {
    return this.on(event as never, listener as never);
  }
  removeListener(event: "open", listener: () => void): this;
  removeListener(event: "data", listener: (chunk: Buffer) => void): this;
  removeListener(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "close", listener: (error?: Error) => void): this;
  removeListener(event: "open" | "data" | "error" | "close", listener: (...args: never[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  write(data: Buffer | string, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(Buffer.isBuffer(data) ? data.toString("utf8") : data);
    callback?.(null);
    return true;
  }
  open(callback?: (error?: Error | null) => void): void {
    this.isOpen = true;
    queueMicrotask(() => {
      this.emit("open");
      callback?.(null);
    });
  }
  close(callback?: (error?: Error | null) => void): void {
    this.isOpen = false;
    queueMicrotask(() => {
      this.emit("close");
      callback?.(null);
    });
  }
  emitData(chunk: string | Buffer): void { this.emit("data", (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) as never); }
  emitError(error: Error): void { this.emit("error", error as never); }
  private emit(event: string, ...values: never[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...values);
  }
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

  it("opens a fresh physical serial transport and projects only raw incremental lines", async () => {
    const f = deviceFor("success");
    const transport = new ControlledSerialTransport();
    const opens: Array<{ path: string; baudRate: number }> = [];
    const physical = createPhysicalArduinoDevice({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", f.script],
      cwd: f.dir,
      serialTransportFactory: (input) => { opens.push(input); return transport; },
    });
    const detected = await physical.detectBoard();
    expect(physical.session()).toMatchObject({ stage: "detected", serialStage: "disconnected", serialSessionId: null });
    const events: string[] = [];
    const serial = await physical.openSerialSession({ projectId: "project-a", deviceId: detected.id, baudRate: 57600 });
    const unsubscribe = physical.subscribeSerialSession("project-a", serial.sessionId, (event) => {
      if (event.type === "line") events.push(event.line);
    });
    expect(serial).toMatchObject({ projectId: "project-a", deviceId: detected.id, port: "COM9", baudRate: 57600, executionReality: "physical", status: "connected" });
    expect(opens).toEqual([{ path: "COM9", baudRate: 57600 }]);
    transport.emitData("HEL");
    transport.emitData("LO\r\nNEXT\npartial");
    expect(events).toEqual(["HELLO", "NEXT"]);
    expect(physical.session().serialLines).not.toContain("partial");
    const write = await physical.writeSerial(serial.sessionId, "STATUS");
    expect(write.response).toBeNull();
    expect(transport.writes).toEqual(["STATUS\n"]);
    unsubscribe();
    await physical.closeSerialSession(serial.sessionId);
    expect(physical.getSerialSession("project-a", serial.sessionId)).toBeNull();
    expect(physical.session()).toMatchObject({ serialStage: "disconnected", serialSessionId: null });
    await expect(physical.writeSerial(serial.sessionId, "STATUS")).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_OPEN" });
  });

  it("requires fresh matching discovery before opening a physical port", async () => {
    const f = deviceFor("changing");
    const opens: string[] = [];
    const physical = createPhysicalArduinoDevice({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", f.script],
      cwd: f.dir,
      serialTransportFactory: ({ path }) => { opens.push(path); return new ControlledSerialTransport(); },
    });
    const detected = await physical.detectBoard();
    await expect(physical.openSerialSession({ projectId: "project-a", deviceId: detected.id })).rejects.toMatchObject({ code: "SERIAL_DEVICE_CHANGED" });
    expect(opens).toEqual([]);
    expect(physical.session().serialStage).toBe("disconnected");
  });

  it("closes and clears a physical session on transport error", async () => {
    const f = deviceFor("success");
    const transport = new ControlledSerialTransport();
    const physical = createPhysicalArduinoDevice({
      arduinoCliPath: process.execPath,
      executableArgsPrefix: ["-e", f.script],
      cwd: f.dir,
      serialTransportFactory: () => transport,
    });
    const detected = await physical.detectBoard();
    const serial = await physical.openSerialSession({ projectId: "project-a", deviceId: detected.id });
    const events: string[] = [];
    physical.subscribeSerialSession("project-a", serial.sessionId, (event) => events.push(event.type));
    transport.emitError(new Error("port disappeared"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["error", "closed"]);
    expect(physical.getSerialSession("project-a", serial.sessionId)).toBeNull();
    expect(physical.session().serialStage).toBe("error");
  });
});
