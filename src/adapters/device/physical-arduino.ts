// adapters/device/physical-arduino.ts — Arduino CLI physical DevicePort
// This adapter is the only production path that may assert physical truth.
// It discovers a current ESP32-S3 through Arduino CLI JSON and uploads the
// already-verified Phase-11 output directory; it never falls back to Companion.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createSerialTransport, type SerialTransport, type SerialTransportFactory } from "@/src/adapters/device/serial-transport";
import { createResourceLock, type ResourceLease } from "@/src/adapters/device/resource-lock";
import {
  DeviceBusyError,
  SerialDeviceChangedError,
  SerialDeviceNotFoundError,
  SerialSessionNotOpenError,
  type DeviceInfo,
  type DevicePort,
  type DeviceSession,
  type DeviceTruth,
  type FlashResult,
  type SerialResult,
  type SerialSession,
  type SerialSessionEvent,
} from "@/src/ports/device";
import { safeMessageForCode } from "@/src/shared-contracts/errors";
import { spawnOwnedChild, stopOwnedChild } from "@/src/infrastructure/owned-child";

const ESP32_S3_FQBN = "esp32:esp32:esp32s3";

export class PhysicalToolUnavailableError extends Error {
  readonly code = "PHYSICAL_TOOL_UNAVAILABLE";
  constructor(message = "arduino-cli is unavailable") { super(message); this.name = "PhysicalToolUnavailableError"; }
}

export class PhysicalFlashTimeoutError extends Error {
  readonly code = "FLASH_TIMEOUT";
  constructor(timeoutMs: number) { super(`Physical flash timed out after ${timeoutMs}ms`); this.name = "PhysicalFlashTimeoutError"; }
}

type Candidate = {
  port: string;
  protocol?: string;
  fqbn: string;
  vid?: string;
  pid?: string;
  serialNumber?: string;
  model?: string;
};

class PhysicalDeviceNotFoundAdapterError extends Error {
  readonly code = "PHYSICAL_DEVICE_NOT_FOUND";
}

class PhysicalDeviceAmbiguousAdapterError extends Error {
  readonly code = "PHYSICAL_DEVICE_AMBIGUOUS";
}

function physicalTruth(verification: DeviceTruth["verification"] = "verified", physicalVerified = verification === "verified"): DeviceTruth {
  return { executionReality: "physical", verification, physicalVerified, adapter: "esp32-arduino-physical" };
}

function candidateId(candidate: Candidate): string {
  return `physical-${createHash("sha256").update(JSON.stringify(candidate)).digest("hex").slice(0, 16)}`;
}

function parseCandidates(value: unknown): Candidate[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (() => {
          const root = value as Record<string, unknown>;
          for (const key of ["detected_ports", "detectedPorts", "ports", "boards"]) {
            if (Array.isArray(root[key])) return root[key];
          }
          return [];
        })()
      : [];
  const candidates: Candidate[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const port = typeof row.port === "string" ? row.port : typeof row.address === "string" ? row.address : "";
    const protocol = typeof row.protocol === "string" ? row.protocol : undefined;
    const boards = Array.isArray(row.matching_boards)
      ? row.matching_boards
      : Array.isArray(row.matchingBoards)
        ? row.matchingBoards
        : Array.isArray(row.boards)
          ? row.boards
          : [row];
    for (const board of boards) {
      if (!board || typeof board !== "object") continue;
      const info = board as Record<string, unknown>;
      const fqbn = typeof info.fqbn === "string" ? info.fqbn : "";
      if (!port || fqbn !== ESP32_S3_FQBN) continue;
      candidates.push({
        port,
        protocol,
        fqbn,
        vid: typeof info.vid === "string" ? info.vid : undefined,
        pid: typeof info.pid === "string" ? info.pid : undefined,
        serialNumber: typeof info.serial_number === "string" ? info.serial_number : typeof info.serialNumber === "string" ? info.serialNumber : undefined,
        model: typeof info.name === "string" ? info.name : undefined,
      });
    }
  }
  return candidates;
}

function stopChild(child: import("node:child_process").ChildProcess, force = false): void {
  stopOwnedChild(child, force);
}

export interface PhysicalArduinoOptions {
  arduinoCliPath: string;
  timeoutMs?: number;
  terminateGraceMs?: number;
  cwd?: string;
  /** Controlled fixture hook; production leaves this empty. */
  executableArgsPrefix?: string[];
  serialTransportFactory?: SerialTransportFactory;
  serialLineLimit?: number;
}

export function createPhysicalArduinoDevice(opts: PhysicalArduinoOptions): DevicePort {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const terminateGraceMs = opts.terminateGraceMs ?? 250;
  const prefix = opts.executableArgsPrefix ?? [];
  const serialFactory = opts.serialTransportFactory ?? createSerialTransport;
  const serialLineLimit = opts.serialLineLimit ?? 64 * 1024;
  const session: DeviceSession = {
    device: null,
    stage: "none",
    truth: physicalTruth("blocked", false),
    serialStage: "disconnected",
    serialSessionId: null,
    serialLines: [],
  };
  const resources = createResourceLock();
  let activeSerial: { session: SerialSession; transport: SerialTransport; lineBuffer: string; decoder: TextDecoder; lease: ResourceLease } | null = null;
  let flashing = false;
  let openingSerial = false;
  const listeners = new Map<string, Set<(event: SerialSessionEvent) => void>>();

  const emit = (event: SerialSessionEvent): void => {
    for (const listener of listeners.get(event.session.sessionId) ?? []) listener(event);
  };

  const emitLine = (serial: { session: SerialSession; transport: SerialTransport; lineBuffer: string; decoder: TextDecoder }, value: string): void => {
    if (activeSerial?.session.sessionId !== serial.session.sessionId) return;
    session.serialLines.push(value);
    emit({ type: "line", session: { ...serial.session }, line: value, receivedAt: new Date().toISOString() });
  };

  const closeActive = async (reason: string, error?: Error, errorCode = "SERIAL_TRANSPORT_ERROR"): Promise<void> => {
    const current = activeSerial;
    if (!current) return;
    activeSerial = null;
    session.serialStage = error ? "error" : "disconnected";
    session.serialSessionId = null;
    const errored = { ...current.session, status: error ? "error" as const : "closed" as const };
    if (error) emit({ type: "error", session: errored, code: errorCode, message: safeMessageForCode(errorCode), receivedAt: new Date().toISOString() });
    emit({ type: "closed", session: { ...current.session, status: "closed" as const }, reason, receivedAt: new Date().toISOString() });
    await new Promise<void>((resolve) => current.transport.close(() => resolve()));
    current.lease.release();
  };

  function discoverCandidates(): Candidate[] {
    const result = spawnSync(opts.arduinoCliPath, [...prefix, "board", "list", "--format", "json"], {
      cwd: opts.cwd,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 15_000,
    });
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new PhysicalToolUnavailableError();
      throw new PhysicalToolUnavailableError(`arduino-cli discovery failed: ${result.error.message}`);
    }
    if (result.status !== 0) throw new PhysicalToolUnavailableError(`arduino-cli board discovery exited ${result.status ?? "unknown"}`);
    try {
      return parseCandidates(JSON.parse(result.stdout || "[]"));
    } catch {
      throw new PhysicalToolUnavailableError("arduino-cli returned invalid board discovery JSON");
    }
  }

  function selectCandidate(): Candidate {
    const candidates = discoverCandidates();
    const byPort = new Map(candidates.map((candidate) => [candidate.port, candidate]));
    if (byPort.size === 0) throw new PhysicalDeviceNotFoundAdapterError("No supported physical ESP32-S3 device was found");
    if (byPort.size > 1) throw new PhysicalDeviceAmbiguousAdapterError("Multiple supported physical ESP32-S3 devices were found");
    return [...byPort.values()][0]!;
  }

  return {
    async detectBoard(): Promise<DeviceInfo> {
      if (activeSerial || openingSerial || flashing) throw new DeviceBusyError();
      const candidate = selectCandidate();
      const device: DeviceInfo = {
        id: candidateId(candidate),
        model: candidate.model ?? "ESP32-S3 (Arduino CLI)",
        port: candidate.port,
        baudRate: 115200,
        ...(candidate.protocol ? { protocol: candidate.protocol } : {}),
        fqbn: candidate.fqbn,
        ...(candidate.vid ? { vid: candidate.vid } : {}),
        ...(candidate.pid ? { pid: candidate.pid } : {}),
        ...(candidate.serialNumber ? { serialNumber: candidate.serialNumber } : {}),
        truth: physicalTruth(),
      };
      session.device = device;
      session.stage = "detected";
      session.truth = device.truth;
      session.serialLines.push(`[system] Physical board detected: ${device.model} on ${device.port}`);
      return device;
    },
    async disconnect(): Promise<void> {
      if (openingSerial || flashing) throw new DeviceBusyError();
      await closeActive("device_disconnected");
      session.stage = "disconnected";
      session.serialStage = "disconnected";
      session.serialSessionId = null;
      session.truth = physicalTruth("blocked", false);
      if (session.device) session.device = { ...session.device, truth: session.truth };
      session.serialLines.push("[system] Device disconnected");
    },
    flash(input, onEvent, signal): Promise<FlashResult> {
      return new Promise((resolve, reject) => {
        const operationId = input.operationId ?? input.buildId;
        const resourceKey = `physical:${input.deviceId}`;
        const lease = resources.tryAcquire(resourceKey, `flash:${input.projectId ?? ""}:${operationId}`);
        if (!lease) {
          reject(new DeviceBusyError());
          return;
        }
        flashing = true;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          flashing = false;
          lease.release();
        };
        const rejectAndRelease = (error: unknown) => { release(); reject(error); };
        if (signal.aborted) {
          resolve({ exitCode: 1, sessionId: "", truth: physicalTruth("failed", false), errorCode: "FLASH_CANCELLED" });
          release();
          return;
        }
        if (activeSerial) {
          rejectAndRelease(new DeviceBusyError());
          return;
        }
        let current: Candidate;
        try {
          current = selectCandidate();
        } catch (error) {
          rejectAndRelease(error);
          return;
        }
        if (!session.device || session.device.id !== candidateId(current) || session.device.port !== current.port) {
          const truth = physicalTruth("failed", false);
          session.truth = truth;
          if (session.device) session.device = { ...session.device, truth };
          rejectAndRelease(Object.assign(new Error("The physical device changed between discovery and flash"), { code: "PHYSICAL_DEVICE_CHANGED" }));
          return;
        }
        session.stage = "flashing";
        const argv = [...prefix, "upload", "--fqbn", ESP32_S3_FQBN, "--port", current.port, "--input-dir", input.outputDir];
        let child: import("node:child_process").ChildProcess;
        let settled = false;
        let timeoutRequested = false;
        let grace: NodeJS.Timeout | undefined;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (grace) clearTimeout(grace);
          release();
          fn();
        };
        const abort = (timedOut: boolean) => {
          if (settled) return;
          timeoutRequested = timeoutRequested || timedOut;
          stopChild(child, timedOut);
          grace = setTimeout(() => { if (!settled) stopChild(child, true); }, terminateGraceMs);
          if (timedOut) {
            // Wait for the owner close event before settling so the bounded
            // timeout path cannot leave a Windows child holding test/workspace
            // handles after the operation has reported failure.
            return;
          }
        };
        const onAbort = () => abort(false);
        const timeout = setTimeout(() => abort(true), timeoutMs);
        try {
          child = spawnOwnedChild({ command: opts.arduinoCliPath, args: argv, cwd: opts.cwd ?? process.cwd() });
        } catch (error) {
          finish(() => {
            session.stage = "detected";
            reject(new PhysicalToolUnavailableError(`cannot spawn ${opts.arduinoCliPath}: ${String(error)}`));
          });
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        const onChunk = (buffer: Buffer) => {
          try {
            for (const line of buffer.toString("utf8").split("\n")) if (line.trim()) onEvent({ type: "line", line });
          } catch (error) {
            finish(() => {
              stopChild(child);
              session.stage = "detected";
              reject(error);
            });
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        try {
          onEvent({ type: "progress", percent: 10, message: "Uploading firmware binary..." });
        } catch (error) {
          finish(() => {
            stopChild(child);
            session.stage = "detected";
            reject(error);
          });
          return;
        }
        // The signal may have been aborted while discovery/spawn was in
        // progress, before the listener above could be attached.
        if (signal.aborted) onAbort();
        child.on("error", (error) => finish(() => {
          const truth = physicalTruth("failed", false);
          session.stage = "detected";
          session.truth = truth;
          if (session.device) session.device = { ...session.device, truth };
          reject(new PhysicalToolUnavailableError(`physical flash failed to start: ${error.message}`));
        }));
        child.on("close", (code) => finish(() => {
          if (timeoutRequested) {
            const truth = physicalTruth("failed", false);
            session.stage = "detected";
            session.truth = truth;
            if (session.device) session.device = { ...session.device, truth };
            reject(new PhysicalFlashTimeoutError(timeoutMs));
            return;
          }
          const successful = !signal.aborted && code === 0;
          const truth = physicalTruth(successful ? "verified" : "failed", successful);
          session.stage = "detected";
          session.truth = truth;
          try {
            onEvent({ type: "progress", percent: successful ? 100 : 90, message: successful ? "Flash complete" : "Flash failed" });
          } catch (error) {
            reject(error);
            return;
          }
          resolve({
            exitCode: signal.aborted ? 1 : code ?? 1,
            sessionId: successful ? `physical-${Date.now().toString(36)}` : "",
            truth,
            buildId: input.buildId,
            artifactVersionId: input.artifactVersionId,
            firmwareSha256: input.firmwareSha256,
            port: current.port,
            fqbn: ESP32_S3_FQBN,
            adapter: "esp32-arduino-physical",
            toolchain: "arduino-cli",
            errorCode: successful ? undefined : signal.aborted ? "FLASH_CANCELLED" : "FLASH_EXIT_NONZERO",
          });
        }));
      });
    },
    session() { return session; },
    async openSerialSession(input: { projectId: string; deviceId: string; baudRate?: number }): Promise<SerialSession> {
      if (!session.device || session.device.id !== input.deviceId) throw new SerialDeviceNotFoundError();
      const openedSessionId = `physical-serial-${randomUUID()}`;
      const lease = resources.tryAcquire(`physical:${input.deviceId}`, `serial:${input.projectId}:${openedSessionId}`);
      if (!lease) throw new DeviceBusyError();
      openingSerial = true;
      let current: Candidate;
      try {
        current = selectCandidate();
      } catch (error) {
        lease.release();
        openingSerial = false;
        throw error;
      }
      if (candidateId(current) !== input.deviceId || current.port !== session.device.port) {
        lease.release();
        openingSerial = false;
        throw new SerialDeviceChangedError();
      }
      const opened: SerialSession = {
        sessionId: openedSessionId,
        projectId: input.projectId,
        deviceId: input.deviceId,
        executionReality: "physical",
        port: current.port,
        baudRate: input.baudRate ?? 115200,
        adapter: "esp32-arduino-physical",
        openedAt: new Date().toISOString(),
        status: "connected",
      };
      if (flashing) {
        lease.release();
        openingSerial = false;
        throw new DeviceBusyError();
      }
      let transport: SerialTransport;
      try {
        transport = serialFactory({ path: current.port, baudRate: opened.baudRate });
      } catch (error) {
        lease.release();
        openingSerial = false;
        throw error;
      }
      const serial = { session: opened, transport, lineBuffer: "", decoder: new TextDecoder(), lease };
      session.serialStage = "opening";
      const openedPromise = new Promise<void>((resolve, reject) => {
        const onOpen = () => { transport.removeListener("error", onError); resolve(); };
        const onError = (error: Error) => { transport.removeListener("open", onOpen); reject(error); };
        transport.once("open", onOpen);
        transport.once("error", onError);
        transport.open((error) => { if (error) onError(error); });
      });
      try {
        await openedPromise;
      } catch (error) {
        session.serialStage = "error";
        await new Promise<void>((resolve) => transport.close(() => resolve()));
        lease.release();
        openingSerial = false;
        throw error;
      }
      activeSerial = serial;
      openingSerial = false;
      session.serialStage = "connected";
      session.serialSessionId = opened.sessionId;
      const onData = (chunk: Buffer): void => {
        if (activeSerial?.session.sessionId !== opened.sessionId) return;
        serial.lineBuffer += serial.decoder.decode(chunk, { stream: true });
        if (serial.lineBuffer.length > serialLineLimit) {
          void closeActive("line_too_large", new Error("SERIAL_LINE_TOO_LARGE"), "SERIAL_LINE_TOO_LARGE");
          return;
        }
        for (;;) {
          const index = serial.lineBuffer.indexOf("\n");
          if (index < 0) break;
          const value = serial.lineBuffer.slice(0, index).replace(/\r$/, "");
          serial.lineBuffer = serial.lineBuffer.slice(index + 1);
          emitLine(serial, value);
        }
      };
      const onError = (error: Error): void => { void closeActive("transport_error", error); };
      const onClose = (error?: Error): void => { void closeActive("transport_close", error); };
      transport.on("data", onData);
      transport.on("error", onError);
      transport.on("close", onClose);
      return { ...opened };
    },
    async closeSerialSession(sessionId: string): Promise<void> {
      if (!activeSerial || activeSerial.session.sessionId !== sessionId) return;
      await closeActive("explicit_close");
    },
    getSerialSession(projectId: string, sessionId: string): SerialSession | null {
      return activeSerial && activeSerial.session.projectId === projectId && activeSerial.session.sessionId === sessionId ? { ...activeSerial.session } : null;
    },
    subscribeSerialSession(projectId: string, sessionId: string, listener: (event: SerialSessionEvent) => void): () => void {
      if (!activeSerial || activeSerial.session.projectId !== projectId || activeSerial.session.sessionId !== sessionId) return () => undefined;
      const sessionListeners = listeners.get(sessionId) ?? new Set<(event: SerialSessionEvent) => void>();
      sessionListeners.add(listener);
      listeners.set(sessionId, sessionListeners);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(sessionId);
      };
    },
    async writeSerial(sessionId: string, command: string): Promise<SerialResult> {
      if (!activeSerial || activeSerial.session.sessionId !== sessionId) throw new SerialSessionNotOpenError();
      await new Promise<void>((resolve, reject) => {
        activeSerial!.transport.write(`${command.trim()}\n`, (error) => error ? reject(error) : resolve());
      });
      return { response: null, truth: session.truth };
    },
    tickSerial(): void { /* Physical telemetry is emitted only from actual transport bytes. */ },
    async shutdown(): Promise<void> {
      await closeActive("server_shutdown");
    },
  };
}
