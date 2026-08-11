// adapters/compiler/esp32-arduino.ts — CompilerPort 真实适配器（ISSUE-009 §3）
// arduino-cli 本地工具链：发现（spawnSync "arduino-cli version"）→ 编译（spawn 数组传参，
// **无 shell 拼接**——child_process 默认 shell:false；结构化参数 → argv）。
// 工具链缺失（ENOENT）→ ToolchainUnavailableError（HTTP 503 + UI 横幅 + 重检测）。
import { spawn, spawnSync } from "node:child_process";
import type { BuildRequest, BuildResult, CompilerPort, ToolchainInfo } from "@/src/ports/compiler";
import { ToolchainUnavailableError } from "@/src/ports/compiler";
import { existsSync } from "node:fs";
import { join } from "node:path";

const FQBN: Record<string, string> = {
  "esp32-s3": "esp32:esp32:esp32s3",
};

function fqbnFor(target: string): string {
  return FQBN[target] ?? FQBN["esp32-s3"]!;
}

export function createEsp32ArduinoCompiler(opts?: { arduinoCliPath?: string }): CompilerPort {
  const cli = opts?.arduinoCliPath ?? "arduino-cli";

  return {
    async discoverToolchain(): Promise<ToolchainInfo> {
      try {
        const res = spawnSync(cli, ["version"], { encoding: "utf8", timeout: 10_000, shell: false });
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
        // 结构化参数 → argv（无 shell 拼接；禁止原始命令串）
        const outDir = String(request.options.outDir ?? ".build");
        const srcDir = String(request.options.srcDir ?? "src");
        const argv = [
          "compile",
          "--fqbn",
          fqbnFor(request.target),
          "--output-dir",
          outDir,
          "--warnings",
          "all",
          srcDir,
        ];
        let child;
        try {
          child = spawn(cli, argv, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
        } catch (err) {
          reject(new ToolchainUnavailableError(`cannot spawn ${cli}: ${(err as Error).message}`));
          return;
        }
        signal.addEventListener("abort", () => {
          child.kill("SIGTERM");
        });
        const onChunk = (buf: Buffer) => {
          for (const line of buf.toString("utf8").split("\n")) {
            if (line.trim().length) onOutput(line.replace(/\r$/, ""));
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("error", (err) => {
          const code = (err as NodeJS.ErrnoException).code;
          reject(new ToolchainUnavailableError(code === "ENOENT" ? "arduino-cli not found on PATH" : `build failed to start: ${err.message}`));
        });
        child.on("close", (code) => {
          if (signal.aborted) {
            resolve({ exitCode: 1 });
            return;
          }
          resolve({ exitCode: code ?? 1 });
        });
      });
    },
  };
}

export function srcDirExists(firmwareRef: string, workspaceDir: string): boolean {
  // firmwareRef 形如 <projectId>/firmware/0001/src/main.cpp → 源目录 = 去掉 /src/main.cpp
  const idx = firmwareRef.indexOf("/src/main.cpp");
  return idx > 0 ? existsSync(join(workspaceDir, firmwareRef.slice(0, idx), "src")) : false;
}
