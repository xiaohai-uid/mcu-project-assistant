// ports/compiler.ts — CompilerPort（implementation-spec §9；ISSUE-009 §3/§9）
// 隔离不稳定外部系统（工具链 CLI）。结构化参数（target/toolchain/options 对象）——
// **禁止原始命令串**（CompilerPort 只收结构化参数；child_process 数组传参、无 shell 拼接）。
// Local Adapter = esp32-arduino（arduino-cli）；测试用 deterministic mock。
export interface ToolchainInfo {
  available: boolean;
  toolchain: "esp32-arduino";
  version: string | null;
  reason?: string; // 不可用原因（UI 横幅展示）
}

export interface BuildRequest {
  target: string; // 如 "esp32-s3"
  toolchain: "esp32-arduino";
  options: Record<string, unknown>; // 结构化选项对象（board/fqbn/optimize…）
  firmwareRef: string; // 编译源（firmware 版本 contentRef）
}

export interface BuildResult {
  exitCode: number;
}

export interface CompilerPort {
  /** 工具链发现（真实检测；缺失 → available:false + reason） */
  discoverToolchain(): Promise<ToolchainInfo>;
  /**
   * 编译执行：逐行输出经 onOutput 回调（适配器流式转发）；signal 中断 → 终止子进程。
   * 抛 ToolchainUnavailableError 当工具链不可用（适配器内再次检测或 spawn 失败）。
   */
  build(request: BuildRequest, onOutput: (line: string) => void, signal: AbortSignal): Promise<BuildResult>;
}

export class ToolchainUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ToolchainUnavailableError";
  }
}
