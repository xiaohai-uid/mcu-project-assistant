// adapters/compiler/mock.ts — CompilerPort 确定性 mock（测试/夹具；ISSUE-009 §9）
// 结构化参数校验（断言选项对象）+ 脚本化输出（逐行，可失败/可取消）；行为契约源 = mock 脚本。
// **无 shell 拼接断言**：mock 也验证 request 为对象而非命令串（与真实适配器同契约）。
import type { BuildRequest, BuildResult, CompilerPort, ToolchainInfo } from "@/src/ports/compiler";
import { ToolchainUnavailableError } from "@/src/ports/compiler";

export interface MockBuildScript {
  lines: string[];
  exitCode?: number; // 缺省 0
  lineDelayMs?: number;
}

export interface MockCompilerHandle {
  compiler: CompilerPort;
  /** 运行中切换脚本（失败/取消场景；e2e 单服务器复用） */
  setScript(s: MockBuildScript): void;
  setUnavailable(v: boolean): void;
}

export function createMockCompilerHandle(script?: MockBuildScript): MockCompilerHandle {
  let s: MockBuildScript = script ?? {
    lines: [
      "[OK] arduino-cli version 1.0.4",
      "$ arduino-cli compile --fqbn esp32:esp32:esp32s3 src",
      "[OK] Detecting libraries used...",
      "[OK] Compiling sketch...",
      "[OK] Linking...",
      "[OK] Generating binary image...",
      "[OK] Memory usage: RAM 22.4% / Flash 31.8%",
      "[OK] Build complete",
    ],
    exitCode: 0,
  };
  let unavailable = false;
  const compiler: CompilerPort = {
    async discoverToolchain(): Promise<ToolchainInfo> {
      if (unavailable) return { available: false, toolchain: "esp32-arduino", version: null, reason: "arduino-cli not found on PATH (mock)" };
      return { available: true, toolchain: "esp32-arduino", version: "1.0.4 (mock)" };
    },
    async build(request: BuildRequest, onOutput: (line: string) => void, signal: AbortSignal): Promise<BuildResult> {
      // 结构化参数契约：target/toolchain/options 对象（非原始命令串）
      if (typeof request.target !== "string" || typeof request.options !== "object" || request.options === null) {
        throw new Error("mock compiler: structured params required (no raw command strings)");
      }
      if (unavailable) throw new ToolchainUnavailableError("arduino-cli not found on PATH (mock)");
      for (const line of s.lines) {
        if (signal.aborted) return { exitCode: 1 };
        onOutput(line);
        await new Promise((r) => setTimeout(r, s.lineDelayMs ?? 5));
      }
      if (signal.aborted) return { exitCode: 1 };
      return { exitCode: s.exitCode ?? 0 };
    },
  };
  return {
    compiler,
    setScript(next: MockBuildScript) {
      s = next;
    },
    setUnavailable(v: boolean) {
      unavailable = v;
    },
  };
}

export function createMockCompiler(script?: MockBuildScript): CompilerPort {
  return createMockCompilerHandle(script).compiler;
}

export function createUnavailableMockCompiler(): CompilerPort {
  return {
    async discoverToolchain(): Promise<ToolchainInfo> {
      return { available: false, toolchain: "esp32-arduino", version: null, reason: "arduino-cli not found on PATH (mock)" };
    },
    async build(): Promise<BuildResult> {
      throw new ToolchainUnavailableError("arduino-cli not found on PATH (mock)");
    },
  };
}
