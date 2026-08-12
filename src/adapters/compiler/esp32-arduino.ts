// adapters/compiler/esp32-arduino.ts — CompilerPort 真实适配器（ISSUE-009 §3）
// arduino-cli 本地工具链：发现（spawnSync "arduino-cli version"）→ 编译（spawn 数组传参，
// **无 shell 拼接**——child_process 默认 shell:false；结构化参数 → argv）。
// 工具链缺失（ENOENT）→ ToolchainUnavailableError（HTTP 503 + UI 横幅 + 重检测）。
import { spawn, spawnSync } from "node:child_process";
import type { BuildRequest, BuildResult, CompilerPort, ToolchainInfo } from "@/src/ports/compiler";
import { BuildTimeoutError, ToolchainUnavailableError, UnsupportedBuildTargetError } from "@/src/ports/compiler";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const FQBN: Record<string, string> = {
  "esp32-s3": "esp32:esp32:esp32s3",
};

export function fqbnFor(target: string): string {
  const fqbn = FQBN[target];
  if (!fqbn) throw new UnsupportedBuildTargetError(target);
  return fqbn;
}

interface CompilerOptions {
  arduinoCliPath?: string;
  timeoutMs?: number;
  terminateGraceMs?: number;
  /** Only used by the controlled external compiler fixture; production leaves this empty. */
  executableArgsPrefix?: string[];
}

function outputEvidence(outputDir: string) {
  if (!existsSync(outputDir)) return [];
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && [".bin", ".elf", ".hex"].includes(extname(entry.name).toLowerCase())) files.push(resolve(path));
    }
  };
  visit(outputDir);
  return files
    .map((path) => {
      const stat = statSync(path);
      const kind = extname(basename(path)).slice(1).toLowerCase() as "bin" | "elf" | "hex";
      return { path, kind, sizeBytes: stat.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
    })
    .filter((item) => item.sizeBytes > 0);
}

function stopChild(child: import("node:child_process").ChildProcess, force = false): void {
  if (process.platform === "win32" && child.pid) {
    if (force) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
    return;
  }
  child.kill(force ? "SIGKILL" : "SIGTERM");
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
          return { available: false, toolchain: "esp32-arduino", version: null, reason: "arduino-cli not found on PATH" };
        }
        if (res.status === 0 && res.stdout) {
          const version = res.stdout.trim().split("\n")[0] ?? null;
          return { available: true, toolchain: "esp32-arduino", version };
        }
        return { available: false, toolchain: "esp32-arduino", version: null, reason: `arduino-cli exited ${res.status ?? "unknown"}` };
      } catch (err) {
        return {
          available: false,
          toolchain: "esp32-arduino",
          version: null,
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
            command: [cli, ...prefix, "compile"],
            sourceDir: request.sourceDir,
            outputDir: request.outputDir,
            outputs: [],
          });
          return;
        }
        const fqbn = fqbnFor(request.target);
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
          child = spawn(cli, argv, { cwd: request.sourceDir, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
        signal.addEventListener("abort", onAbort, { once: true });
        const onChunk = (buf: Buffer) => {
          for (const line of buf.toString("utf8").split("\n")) {
            if (line.trim().length) onOutput(line.replace(/\r$/, ""));
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("error", (err) => {
          const code = (err as NodeJS.ErrnoException).code;
          finish(() => reject(new ToolchainUnavailableError(code === "ENOENT" ? "arduino-cli not found on PATH" : `build failed to start: ${err.message}`)));
        });
        child.on("close", (code) => {
          finish(() => resolve({
            exitCode: signal.aborted ? 1 : code ?? 1,
            toolchain: "esp32-arduino",
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
