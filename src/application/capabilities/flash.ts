// application/capabilities/flash.ts — flash_device / detect_device / send_serial（application-contract 2.15-2.17；ISSUE-011 §3/§6）
// Safety（Tier 0）：Flash 必须显式用户确认——一次性令牌（60s 时效、单次使用、绑定设备）；
// AI/Companion/重试不得绕过（无令牌被拒）；L3 Stale 门禁（I-8）；设备断开中止（不留半成品证据）。
// DeviceSession = 运行时状态（适配器内存态；持久化仅 last_device → preferences）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DeviceBusyError, type DevicePort, type DeviceInfo, type DeviceTruth } from "@/src/ports/device";
import type { DeviceExecutionReality, FlashResultDto } from "@/src/shared-contracts/types";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";
import type { BuildRecord } from "@/src/domain/models/build-record";
import { toSafeError } from "@/src/shared-contracts/errors";
import { assertExistingPathContained, resolveContainedPath } from "@/src/shared/filesystem-confinement";
import { MAX_FLASH_EVIDENCE_BYTES, appendBoundedLine } from "@/src/shared/resource-limits";

export class ConfirmationMissingError extends Error {
  constructor() {
    super("Flash confirmation token required (no bypass)");
    this.name = "ConfirmationMissingError";
  }
}

export class ConfirmationExpiredError extends Error {
  constructor() {
    super("Flash confirmation token expired — reconfirm");
    this.name = "ConfirmationExpiredError";
  }
}

export class TokenReusedError extends Error {
  constructor() {
    super("Flash confirmation token already used — reconfirm");
    this.name = "TokenReusedError";
  }
}

export class DeviceMismatchError extends Error {
  constructor() {
    super("Flash confirmation token is bound to a different device");
    this.name = "DeviceMismatchError";
  }
}

export class DeviceDisconnectedError extends Error {
  constructor() {
    super("Device is not connected");
    this.name = "DeviceDisconnectedError";
  }
}

export class FirmwareVersionNotFoundError extends Error {
  constructor() {
    super("Firmware version not found");
    this.name = "FirmwareVersionNotFoundError";
  }
}

export class PhysicalFlashBlockedError extends Error {
  constructor() {
    super("PHYSICAL_FLASH_BLOCKED: no physical device adapter is configured");
    this.name = "PhysicalFlashBlockedError";
  }
}

export class FlashBuildNotVerifiedError extends Error {
  readonly code = "FLASH_BUILD_NOT_VERIFIED";
  constructor() { super("Flash requires a succeeded build with a verified firmware binary"); this.name = "FlashBuildNotVerifiedError"; }
}

export class FlashFirmwareMissingError extends Error {
  readonly code = "FLASH_FIRMWARE_MISSING";
  constructor() { super("Verified firmware binary is missing from the build output"); this.name = "FlashFirmwareMissingError"; }
}

export class FlashFirmwareHashMismatchError extends Error {
  readonly code = "FLASH_FIRMWARE_HASH_MISMATCH";
  constructor() { super("Firmware binary hash does not match the durable build evidence"); this.name = "FlashFirmwareHashMismatchError"; }
}

export class PhysicalDeviceNotFoundError extends Error {
  readonly code = "PHYSICAL_DEVICE_NOT_FOUND";
  constructor() { super("No supported physical device was found"); this.name = "PhysicalDeviceNotFoundError"; }
}

export class PhysicalDeviceAmbiguousError extends Error {
  readonly code = "PHYSICAL_DEVICE_AMBIGUOUS";
  constructor() { super("Multiple supported physical devices were found; select one explicitly"); this.name = "PhysicalDeviceAmbiguousError"; }
}

export class PhysicalDeviceChangedError extends Error {
  readonly code = "PHYSICAL_DEVICE_CHANGED";
  constructor() { super("The physical device changed between discovery and flash"); this.name = "PhysicalDeviceChangedError"; }
}

// ---------- Flash 确认令牌（一次性/短时效/绑定设备；安全验收组） ----------

export interface FlashToken {
  token: string;
  deviceId: string;
  expiresAt: string;
  used: boolean;
}

export interface FlashTokenStore {
  issue(deviceId: string, now: Date): FlashToken;
  consume(token: string, deviceId: string, now: Date): "ok" | "missing" | "expired" | "reused" | "device_mismatch";
}

export function createFlashTokenStore(ttlMs = 60_000): FlashTokenStore {
  const tokens = new Map<string, FlashToken>();
  return {
    issue(deviceId: string, now: Date): FlashToken {
      const token: FlashToken = {
        token: randomUUID(),
        deviceId,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        used: false,
      };
      tokens.set(token.token, token);
      return token;
    },
    consume(token: string, deviceId: string, now: Date): "ok" | "missing" | "expired" | "reused" | "device_mismatch" {
      const t = tokens.get(token);
      if (!t) return "missing";
      if (t.used) return "reused";
      if (new Date(t.expiresAt).getTime() < now.getTime()) return "expired";
      if (t.deviceId !== deviceId) return "device_mismatch";
      t.used = true; // 单次使用
      return "ok";
    },
  };
}

// ---------- 能力 ----------

export interface FlashCapabilityDeps {
  persistence: PersistencePort;
  tasks: TaskExecutionPort;
  events: EventPort;
  device: DevicePort;
  tokens: FlashTokenStore;
  workspaceDir: string;
  now?: () => Date;
}

export type FlashTaskDeps = Pick<FlashCapabilityDeps, "persistence" | "events" | "device" | "tokens" | "workspaceDir" | "now">;

export interface PersistedFlashTaskInput {
  projectId: string;
  buildId: string;
  artifactVersionId: string;
  deviceId: string;
  executionReality?: DeviceExecutionReality;
}

export type PersistedFlashOutput = FlashResultDto;

export async function executeFlashTask(
  input: PersistedFlashTaskInput,
  ctx: import("@/src/ports/task-execution").TaskContext,
  deps: FlashTaskDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const version = await deps.persistence.getVersion(input.artifactVersionId);
  if (!version) throw new FirmwareVersionNotFoundError();
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  const projectId = artifact?.projectId ?? "";
  if (projectId !== input.projectId || artifact?.kind !== "firmware") throw new FlashBuildNotVerifiedError();
  const build = await deps.persistence.getBuildRecord(input.buildId);
  const evidence = verifiedFirmwareEvidence(build, input.artifactVersionId, deps.workspaceDir);
  const sessionId = { value: "" };
  const lines: string[] = [];
  const evidenceBytes = { value: 0 };

  const actualTruth = deps.device.session().truth;
  if (input.executionReality && input.executionReality !== actualTruth.executionReality) {
    throw new PhysicalFlashBlockedError();
  }

  try {
    const result = await deps.device.flash(
      {
        projectId: input.projectId,
        operationId: ctx.taskId,
        deviceId: input.deviceId,
        buildId: input.buildId,
        artifactVersionId: input.artifactVersionId,
        outputDir: evidence.outputDir,
        firmwarePath: evidence.path,
        firmwareSha256: evidence.sha256,
      },
      (e) => {
        if (e.type === "progress") {
          ctx.emit({ type: "device.flashing", projectId, deviceId: input.deviceId, percent: e.percent, message: e.message });
        } else if (e.type === "line") {
          appendBoundedLine(lines, e.line, evidenceBytes, MAX_FLASH_EVIDENCE_BYTES, "process_output_limit_exceeded");
        }
      },
      ctx.signal,
    );
    sessionId.value = result.sessionId;
    if (ctx.signal.aborted) {
      await ctx.setOutput(JSON.stringify({ ...result, exitCode: 1, sessionId: "", buildId: input.buildId, artifactVersionId: input.artifactVersionId, firmwareSha256: evidence.sha256, errorCode: "FLASH_CANCELLED" } satisfies PersistedFlashOutput));
      return;
    }
    if (result.exitCode !== 0) throw new Error(result.errorCode ?? "FLASH_EXIT_NONZERO");
    if (sessionId.value) {
      const evidencePath = join(deps.workspaceDir, ".evidence", `${sessionId.value}.log`);
      mkdirSync(join(deps.workspaceDir, ".evidence"), { recursive: true });
      appendFileSync(evidencePath, lines.join("\n") + "\n", "utf8");
    }
    await ctx.setOutput(JSON.stringify({ ...result, sessionId: sessionId.value, buildId: input.buildId, artifactVersionId: input.artifactVersionId, firmwareSha256: evidence.sha256 } satisfies PersistedFlashOutput));
    if (ctx.signal.aborted) return;
    ctx.emit({ type: "device.flashed", projectId, deviceId: input.deviceId, sessionId: sessionId.value, truth: result.truth });
  } catch (err) {
    const truth: DeviceTruth = { ...deps.device.session().truth, verification: "failed", physicalVerified: false };
    const safe = toSafeError(err);
    await ctx.setOutput(JSON.stringify({
      exitCode: 1,
      sessionId: "",
      truth,
      ...(input.executionReality === "physical" ? { adapter: "esp32-arduino-physical", toolchain: "arduino-cli" } : {}),
      buildId: input.buildId,
      artifactVersionId: input.artifactVersionId,
      firmwareSha256: evidence.sha256,
      errorCode: safe.code,
    } satisfies PersistedFlashOutput));
    if (ctx.signal.aborted) return;
    ctx.emit({
      type: "device.flash_failed",
      projectId,
      deviceId: input.deviceId,
      taskId: ctx.taskId,
      buildId: input.buildId,
      code: safe.code,
      message: safe.message,
      timestamp: now().toISOString(),
      truth,
    });
    throw err;
  }
  void now;
}

function verifiedFirmwareEvidence(build: BuildRecord | null, artifactVersionId: string, workspaceDir: string): { outputDir: string; path: string; sha256: string } {
  if (!build || build.artifactVersionId !== artifactVersionId || build.status !== "succeeded" || !build.outputDir) throw new FlashBuildNotVerifiedError();
  const outputDir = resolve(build.outputDir);
  const buildRoot = resolve(workspaceDir, ".build");
  if (outputDir === buildRoot) throw new FlashBuildNotVerifiedError();
  try {
    resolveContainedPath(buildRoot, outputDir);
    assertExistingPathContained(buildRoot, outputDir);
  } catch {
    throw new FlashBuildNotVerifiedError();
  }
  const output = build.outputs.find((item) => item.kind === "bin" && item.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(item.sha256));
  if (!output) throw new FlashBuildNotVerifiedError();
  const path = resolve(output.path);
  if (!existsSync(path) || !statSync(path).isFile()) throw new FlashFirmwareMissingError();
  try {
    resolveContainedPath(outputDir, path);
    assertExistingPathContained(outputDir, path);
  } catch {
    throw new FlashFirmwareMissingError();
  }
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== output.sha256 || statSync(path).size !== output.sizeBytes) throw new FlashFirmwareHashMismatchError();
  return { outputDir, path, sha256: output.sha256 };
}

export async function detectDevice(
  _input: Record<string, never>,
  deps: Pick<FlashCapabilityDeps, "device" | "persistence" | "now">,
): Promise<DeviceInfo> {
  const now = deps.now ?? (() => new Date());
  const device = await deps.device.detectBoard();
  // 持久化仅 last_device（会话不建表）
  await deps.persistence.withTransaction((uow) =>
    uow.setPreference("last_device", JSON.stringify(device), now().toISOString()),
  );
  return device;
}

export async function issueFlashToken(
  input: { deviceId: string },
  deps: Pick<FlashCapabilityDeps, "tokens" | "now">,
): Promise<{ token: string; expiresAt: string }> {
  const now = deps.now ?? (() => new Date());
  const t = deps.tokens.issue(input.deviceId, now());
  return { token: t.token, expiresAt: t.expiresAt };
}

/**
 * flash_device：确认令牌校验（403 族）→ L3 门禁（409）→ 设备连接（409）→
 * 烧录执行（进度事件流）→ 完成写 .evidence/<sessionId>.log；中断不留半成品证据。
 */
export async function flashDevice(
  input: { projectId: string; deviceId: string; confirmationToken: string; buildId: string; artifactVersionId: string; executionReality?: DeviceExecutionReality },
  deps: FlashCapabilityDeps,
): Promise<PersistedFlashOutput> {
  const now = deps.now ?? (() => new Date());

  // 1. 令牌校验（一次性；AI/Companion/重试无令牌一律拒绝）
  const verdict = deps.tokens.consume(input.confirmationToken, input.deviceId, now());
  if (verdict === "missing") throw new ConfirmationMissingError();
  if (verdict === "expired") throw new ConfirmationExpiredError();
  if (verdict === "reused") throw new TokenReusedError();
  if (verdict === "device_mismatch") throw new DeviceMismatchError();

  // A requested physical operation must never silently execute on companion.
  const actualTruth = deps.device.session().truth;
  if (input.executionReality && input.executionReality !== actualTruth.executionReality) {
    throw new PhysicalFlashBlockedError();
  }

  // 2. L3 Stale 门禁（I-8：L3 禁 Flash）
  const version = await deps.persistence.getVersion(input.artifactVersionId);
  if (!version) throw new FirmwareVersionNotFoundError();
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  const projectId = artifact?.projectId ?? "";
  if (projectId !== input.projectId || artifact?.kind !== "firmware") throw new FlashBuildNotVerifiedError();
  if (input.executionReality === "physical") {
    const fresh = await deps.device.detectBoard();
    if (fresh.id !== input.deviceId) throw new PhysicalDeviceChangedError();
  }
  verifiedFirmwareEvidence(await deps.persistence.getBuildRecord(input.buildId), input.artifactVersionId, deps.workspaceDir);
  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  await assertNotBlocking({ projectId, action: "flash" }, deps);

  // 3. 设备连接（运行时状态）
  if (!["detected", "connected"].includes(deps.device.session().stage)) throw new DeviceDisconnectedError();

  // 4. 烧录执行（in-process 任务；进度事件 → SSE；deferred 等待任务终态以返回 sessionId）
  const taskId = await deps.tasks.submit(
    { capability: "flash_device", input: JSON.stringify({ projectId: input.projectId, buildId: input.buildId, artifactVersionId: input.artifactVersionId, deviceId: input.deviceId, executionReality: input.executionReality }) },
  );

  const runtime = deps.tasks as TaskExecutionPort & {
    waitForTask?: (id: string) => Promise<import("@/src/ports/task-execution").TaskRecord | null>;
  };
  const task = runtime.waitForTask
    ? await runtime.waitForTask(taskId)
    : await (async () => {
        for (;;) {
          const current = await deps.tasks.getTask(taskId);
          if (current && ["completed", "failed", "cancelled"].includes(current.status)) return current;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();
  if (!task) throw new Error(`Flash task ${taskId} disappeared before reaching a terminal state`);
  const output = task.output ? (JSON.parse(task.output) as PersistedFlashOutput) : null;
  if (task.status === "failed" && output?.errorCode === "device_busy") throw new DeviceBusyError();
  return output
    ? output
    : { exitCode: 1, sessionId: "", truth: { ...actualTruth, verification: "failed" } };
}

export async function disconnectDevice(deps: Pick<FlashCapabilityDeps, "device">): Promise<void> {
  await deps.device.disconnect();
}

export async function sendSerial(
  input: { sessionId: string; command: string },
  deps: Pick<FlashCapabilityDeps, "device">,
): Promise<{ echo: string; response: string | null; truth: DeviceTruth }> {
  const echo = `> ${input.command.trim()}`;
  const result = await deps.device.writeSerial(input.sessionId, input.command);
  return { echo, response: result.response, truth: result.truth };
}
