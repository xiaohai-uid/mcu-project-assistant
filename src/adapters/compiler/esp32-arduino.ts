// adapters/compiler/esp32-arduino.ts — CompilerPort 真实适配器（ISSUE-009 §3）
// arduino-cli 本地工具链：发现（spawnSync "arduino-cli version"）→ 编译（spawn 数组传参，
// **无 shell 拼接**——child_process 默认 shell:false；结构化参数 → argv）。
// 工具链缺失（ENOENT）→ ToolchainUnavailableError（HTTP 503 + UI 横幅 + 重检测）。
import { spawnSync } from "node:child_process";
import type { BuildRequest, BuildResult, CompilerPort, ToolchainInfo } from "@/src/ports/compiler";
import { BuildTimeoutError, ProcessOutputLimitError, ToolchainUnavailableError, UnsupportedBuildTargetError } from "@/src/ports/compiler";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { assertExistingPathContained, assertNoExistingLinks } from "@/src/shared/filesystem-confinement";
import { spawnOwnedChild, stopOwnedChild } from "@/src/infrastructure/owned-child";
import { MAX_PROCESS_OUTPUT_BYTES } from "@/src/shared/resource-limits";
import {
  ESP32_S3_ARDUINO_CORE_PACKAGE,
  ESP32_S3_ARDUINO_CORE_VERSION,
  ESP32_S3_REFERENCE_KIT_ID,
  resolveArduinoBuildProfile,
  toolchainPinningDiagnostics,
} from "@/src/domain/services/build-profile";

export function fqbnFor(target: string): string {
  try {
    return resolveArduinoBuildProfile(target, ESP32_S3_REFERENCE_KIT_ID).resolvedFqbn;
  } catch {
    throw new UnsupportedBuildTargetError(target);
  }
}

interface CompilerOptions {
  arduinoCliPath?: string;
  timeoutMs?: number;
  terminateGraceMs?: number;
  /** Only used by the controlled external compiler fixture; production leaves this empty. */
  executableArgsPrefix?: string[];
}

function outputEvidence(outputDir: string) {
  try {
    if (!existsSync(outputDir)) return [];
    assertExistingPathContained(outputDir, outputDir);
    assertNoExistingLinks(outputDir, outputDir);
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error("Build output contains a symlink or junction");
        if (stat.isDirectory()) visit(path);
        else if (stat.isFile() && [".bin", ".elf", ".hex"].includes(extname(entry.name).toLowerCase())) {
          assertExistingPathContained(outputDir, path);
          files.push(resolve(path));
        }
      }
    };
    visit(outputDir);
    return files
      .map((path) => {
        const stat = lstatSync(path);
        const kind = extname(basename(path)).slice(1).toLowerCase() as "bin" | "elf" | "hex";
        return { path, kind, sizeBytes: stat.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
      })
      .filter((item) => item.sizeBytes > 0);
  } catch {
    return [];
  }
}

function stopChild(child: import("node:child_process").ChildProcess, force = false): void {
  stopOwnedChild(child, force);
}

function parseInstalledCore(stdout: string): { corePackage: string; coreVersion: string } | null {
  try {
    const parsed = JSON.parse(stdout) as { platforms?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
    const platforms = Array.isArray(parsed) ? parsed : parsed.platforms;
    if (!platforms) return null;
    const match = platforms.find((platform) => {
      const id = typeof platform.id === "string" ? platform.id : typeof platform.package === "string" ? platform.package : "";
      return id === ESP32_S3_ARDUINO_CORE_PACKAGE;
    });
    if (!match) return null;
    const coreVersion = [match.installed_version, match.installedVersion, match.version]
      .find((value): value is string => typeof value === "string") ?? null;
    return coreVersion ? { corePackage: ESP32_S3_ARDUINO_CORE_PACKAGE, coreVersion } : null;
  } catch {
    return null;
  }
}

export function createEsp32ArduinoCompiler(opts?: CompilerOptions): CompilerPort {
  const cli = opts?.arduinoCliPath ?? "arduino-cli";
  const prefix = opts?.executableArgsPrefix ?? [];
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const terminateGraceMs = opts?.terminateGraceMs ?? 250;

  return {
    async discoverToolchain(): Promise<ToolchainInfo> {
      try {
        const res = spawnSync(cli, [...prefix, "version"], { encoding: "utf8", timeout: 10_000, shell: false, windowsHide: true });
        if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
          return { available: false, toolchain: "esp32-arduino", version: null, evidence: "real", reason: "arduino-cli not found on PATH" };
        }
        if (res.status === 0 && res.stdout) {
          const version = res.stdout.trim().split("\n")[0] ?? null;
          const core = spawnSync(cli, [...prefix, "core", "list", "--format", "json"], { encoding: "utf8", timeout: 10_000, shell: false, windowsHide: true });
          const installed = core.status === 0 && core.stdout ? parseInstalledCore(core.stdout) : null;
          if (!installed) {
            return {
              available: false,
              toolchain: "esp32-arduino",
              version,
              corePackage: null,
              coreVersion: null,
              evidence: "real",
              reason: `Arduino core ${ESP32_S3_ARDUINO_CORE_PACKAGE}@${ESP32_S3_ARDUINO_CORE_VERSION} is not installed or could not be read`,
            };
          }
          const probe = { available: true, version, corePackage: installed.corePackage, coreVersion: installed.coreVersion };
          const pinning = toolchainPinningDiagnostics(probe);
          return {
            ...probe,
            toolchain: "esp32-arduino",
            evidence: "real",
            available: pinning.length === 0,
            ...(pinning.length ? { reason: pinning.map((item) => item.message).join("; ") } : {}),
          };
        }
        return { available: false, toolchain: "esp32-arduino", version: null, corePackage: null, coreVersion: null, evidence: "real", reason: `arduino-cli exited ${res.status ?? "unknown"}` };
      } catch (err) {
        return {
          available: false,
          toolchain: "esp32-arduino",
          version: null,
          corePackage: null,
          coreVersion: null,
          evidence: "real",
          reason: `toolchain discovery failed: ${(err as Error).message}`,
        };
      }
    },

    build(request: BuildRequest, onOutput: (line: string) => void, signal: AbortSignal): Promise<BuildResult> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          resolve({
            exitCode: 1,
            toolchain: "esp32-arduino",
            evidence: "real",
            command: [cli, ...prefix, "compile"],
            sourceDir: request.sourceDir,
            outputDir: request.outputDir,
            outputs: [],
          });
          return;
        }
        let profile: ReturnType<typeof resolveArduinoBuildProfile>;
        try {
          profile = resolveArduinoBuildProfile(request.target, ESP32_S3_REFERENCE_KIT_ID);
        } catch {
          throw new UnsupportedBuildTargetError(request.target);
        }
        const requestedFqbn = request.options.resolvedFqbn;
        if (requestedFqbn !== undefined && requestedFqbn !== profile.resolvedFqbn) {
          throw new UnsupportedBuildTargetError(`Resolved FQBN does not match pinned profile: ${String(requestedFqbn)}`);
        }
        const fqbn = profile.resolvedFqbn;
        const argv = [
          ...prefix,
          "compile",
          "--fqbn",
          fqbn,
          "--output-dir",
          request.outputDir,
          "--warnings",
          "all",
          request.sourceDir,
        ];
        let child;
        let settled = false;
        let grace: NodeJS.Timeout | undefined;
        const command = [cli, ...argv];
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (grace) clearTimeout(grace);
          fn();
        };
        try {
          child = spawnOwnedChild({ command: cli, args: argv, cwd: request.sourceDir });
        } catch (err) {
          reject(new ToolchainUnavailableError(`cannot spawn ${cli}: ${(err as Error).message}`));
          return;
        }
        const terminate = (timedOut: boolean) => {
          if (settled) return;
          stopChild(child);
          grace = setTimeout(() => {
            if (!settled) stopChild(child, true);
          }, terminateGraceMs);
          if (timedOut) {
            finish(() => reject(new BuildTimeoutError(timeoutMs)));
          }
        };
        const onAbort = () => terminate(false);
        const timeout = setTimeout(() => terminate(true), timeoutMs);
        let outputBytes = 0;
        let outputLimitHit = false;
        let outputCallbackError: unknown = null;
        signal.addEventListener("abort", onAbort, { once: true });
        const onChunk = (buf: Buffer) => {
          outputBytes += buf.byteLength;
          if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
            outputLimitHit = true;
            terminate(false);
            return;
          }
          try {
            for (const line of buf.toString("utf8").split("\n")) {
              if (line.trim().length) onOutput(line.replace(/\r$/, ""));
            }
          } catch (error) {
            outputCallbackError = error;
            terminate(false);
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("error", (err) => {
          const code = (err as NodeJS.ErrnoException).code;
          finish(() => reject(new ToolchainUnavailableError(code === "ENOENT" ? "arduino-cli not found on PATH" : `build failed to start: ${err.message}`)));
        });
        child.on("close", (code) => {
          if (outputLimitHit) {
            finish(() => reject(new ProcessOutputLimitError(MAX_PROCESS_OUTPUT_BYTES)));
            return;
          }
          if (outputCallbackError) {
            finish(() => reject(outputCallbackError));
            return;
          }
          finish(() => resolve({
            exitCode: signal.aborted ? 1 : code ?? 1,
            toolchain: "esp32-arduino",
            toolchainCoreVersion: ESP32_S3_ARDUINO_CORE_VERSION,
            command,
            sourceDir: request.sourceDir,
            outputDir: request.outputDir,
            outputs: signal.aborted ? [] : outputEvidence(request.outputDir),
          }));
        });
      });
    },
  };
}
