// application/capabilities/flash.ts — flash_device / detect_device / send_serial（application-contract 2.15-2.17；ISSUE-011 §3/§6）
// Safety（Tier 0）：Flash 必须显式用户确认——一次性令牌（60s 时效、单次使用、绑定设备）；
// AI/Companion/重试不得绕过（无令牌被拒）；L3 Stale 门禁（I-8）；设备断开中止（不留半成品证据）。
// DeviceSession = 运行时状态（适配器内存态；持久化仅 last_device → preferences）。
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DevicePort, DeviceInfo, DeviceTruth } from "@/src/ports/device";
import type { DeviceExecutionReality, FlashResultDto } from "@/src/shared-contracts/types";
import type { EventPort } from "@/src/ports/events";
import type { PersistencePort } from "@/src/ports/persistence";
import type { TaskExecutionPort } from "@/src/ports/task-execution";

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
  deviceId: string;
  firmwareVersionId: string;
  executionReality?: DeviceExecutionReality;
}

export type PersistedFlashOutput = FlashResultDto;

export async function executeFlashTask(
  input: PersistedFlashTaskInput,
  ctx: import("@/src/ports/task-execution").TaskContext,
  deps: FlashTaskDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const version = await deps.persistence.getVersion(input.firmwareVersionId);
  if (!version) throw new FirmwareVersionNotFoundError();
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  const projectId = artifact?.projectId ?? "";
  const sessionId = { value: "" };
  const lines: string[] = [];

  const actualTruth = deps.device.session().truth;
  if (input.executionReality && input.executionReality !== actualTruth.executionReality) {
    throw new PhysicalFlashBlockedError();
  }

  try {
    const result = await deps.device.flash(
      { deviceId: input.deviceId },
      (e) => {
        if (e.type === "progress") {
          ctx.emit({ type: "device.flashing", projectId, deviceId: input.deviceId, percent: e.percent, message: e.message });
        } else if (e.type === "line") {
          lines.push(e.line);
        }
      },
      ctx.signal,
    );
    sessionId.value = result.sessionId;
    if (ctx.signal.aborted || result.exitCode !== 0) {
      await ctx.setOutput(JSON.stringify({ exitCode: result.exitCode, sessionId: "", truth: result.truth } satisfies PersistedFlashOutput));
      if (ctx.signal.aborted) return;
      ctx.emit({
        type: "device.flash_failed",
        projectId,
        deviceId: input.deviceId,
        message: "Flash aborted",
        truth: result.truth,
      });
      return;
    }
    if (sessionId.value) {
      const evidencePath = join(deps.workspaceDir, ".evidence", `${sessionId.value}.log`);
      mkdirSync(join(deps.workspaceDir, ".evidence"), { recursive: true });
      appendFileSync(evidencePath, lines.join("\n") + "\n", "utf8");
    }
    await ctx.setOutput(JSON.stringify({ exitCode: result.exitCode, sessionId: sessionId.value, truth: result.truth } satisfies PersistedFlashOutput));
    if (ctx.signal.aborted) return;
    ctx.emit({ type: "device.flashed", projectId, deviceId: input.deviceId, sessionId: sessionId.value, truth: result.truth });
  } catch (err) {
    const truth: DeviceTruth = { ...deps.device.session().truth, verification: "failed" };
    await ctx.setOutput(JSON.stringify({ exitCode: 1, sessionId: "", truth } satisfies PersistedFlashOutput));
    if (ctx.signal.aborted) return;
    ctx.emit({
      type: "device.flash_failed",
      projectId,
      deviceId: input.deviceId,
      message: err instanceof Error ? err.message : String(err),
      truth,
    });
  }
  void now;
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
  input: { deviceId: string; confirmationToken: string; firmwareVersionId: string; executionReality?: DeviceExecutionReality },
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
  const version = await deps.persistence.getVersion(input.firmwareVersionId);
  if (!version) throw new FirmwareVersionNotFoundError();
  const artifact = await deps.persistence.getArtifact(version.artifactId);
  const projectId = artifact?.projectId ?? "";
  const { assertNotBlocking } = await import("@/src/application/capabilities/revalidate");
  await assertNotBlocking({ projectId, action: "flash" }, deps);

  // 3. 设备连接（运行时状态）
  if (deps.device.session().stage !== "connected") throw new DeviceDisconnectedError();

  // 4. 烧录执行（in-process 任务；进度事件 → SSE；deferred 等待任务终态以返回 sessionId）
  const taskId = await deps.tasks.submit(
    { capability: "flash_device", input: JSON.stringify({ deviceId: input.deviceId, firmwareVersionId: input.firmwareVersionId, executionReality: input.executionReality }) },
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
  return task.output
    ? (JSON.parse(task.output) as PersistedFlashOutput)
    : { exitCode: 1, sessionId: "", truth: { ...actualTruth, verification: "failed" } };
}

export async function disconnectDevice(deps: Pick<FlashCapabilityDeps, "device">): Promise<void> {
  deps.device.disconnect();
}

export async function sendSerial(
  input: { command: string },
  deps: Pick<FlashCapabilityDeps, "device">,
): Promise<{ echo: string; response: string; truth: DeviceTruth }> {
  const echo = `> ${input.command.trim()}`;
  const result = deps.device.sendSerial(input.command);
  return { echo, response: result.response, truth: result.truth };
}
