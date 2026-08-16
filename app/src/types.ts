// ============================================================
import type { DeviceTruthDto, SerialSessionDto } from "@/src/shared-contracts/types";
import type { AppError, TaskDto } from "./api/client";
import type { ReferenceKitDefinition } from "@/src/domain/knowledge/platforms";

// MCU Project Assistant — Mock Product Types
// UI-First Mock：这些类型描述"用户认知中的对象与状态"，
// 不是后端 schema。后端契约在 UI Frozen 之后定义。
// ============================================================

export type NavigationTab = "Home" | "Draft" | "Validated" | "Professional View";

export type SidebarTab =
  | "Requirements"
  | "Hardware"
  | "Wiring"
  | "Firmware"
  | "Build"
  | "Companion"
  | "Settings";

export type CopilotTab = "Chat" | "Context" | "History";

export type Language = "en" | "zh";
export type ThemeMode = "system" | "light" | "dark";

// ---------- Artifact（用户可见的正式工程资产） ----------

export type ArtifactKind =
  | "requirements"
  | "hardware"
  | "pinmap"
  | "wiring"
  | "firmware"
  | "build"
  | "validation"
  | "debug";

export type ArtifactStatus =
  | "draft"       // 未确认
  | "accepted"    // 已纳入设计
  | "validated"   // 有验证证据
  | "stale"       // 上游变化，失效
  | "error"       // 生成/验证失败
  | "warning";    // 带警告接受

export interface ArtifactState {
  kind: ArtifactKind;
  status: ArtifactStatus;
  version: number; // 1 = 首版；AI 修改必须产生新版本，不静默覆盖
  baseStatus?: ArtifactStatus; // S5B：进入 stale 前的状态（marks 解除时恢复）
}

// ---------- 项目 ----------

export interface ProjectCard {
  id: string;
  title: string;
  version: string;
  status: "Stale" | "Validated" | "Draft";
  target: string;
  rtosOrFramework: string;
  frameworkType: "RTOS" | "Framework";
  lastEdit: string;
  size: string;
  icon: string;
}

export interface StarterTemplate {
  id: string;
  title: string;
  description: string;
  badge: string;
  icon: string;
}

// ---------- Requirement Discovery ----------

export interface DiscoveredRequirement {
  id: string;
  title: string;
  type: string;
  status: "complete" | "partial" | "pending";
  progress: number;
  icon: string;
  isWarning?: boolean;
  details?: string;
}

export interface ProposalItem {
  id: string;
  number: string;
  title: string;
  accepted: boolean;
  initialIdea: string;
  formalizedRequirement: string;
  impacts: string[];
}

// 显式三态提案（参考只有勾选/未勾选 → Mock 补 Rejected）
export type ProposalDecision = "pending" | "accepted" | "rejected";

export interface RequirementProposal extends ProposalItem {
  decision: ProposalDecision;
}

export interface Clarification {
  question: string;
  detail?: string;
  answer: string;
  answered: boolean;
}

export type DiscoveryStage =
  | "idle"        // 未开始
  | "analyzing"   // AI 分析中（流式）
  | "clarifying"  // 澄清待答
  | "ready"       // 提案就绪
  | "error"       // 失败（可重试）
  | "cancelled";  // 用户取消

// ---------- Hardware ----------

export interface McuCandidate {
  id: string;
  title: string;
  badgeKey: "recommended" | "alternative" | "industrial";
  core: string;
  wireless: string;
  gpio: string;
  flash: string;
  reason: string;
  constraints?: string[]; // 对照需求的约束警告
  referenceKit?: ReferenceKitDefinition;
}

export interface Peripheral {
  id: string;
  title: string;
  type: string;
  interface: string;
  pinsNeeded: string;
  status: string;
  icon: string;
  warningNote?: string;
}

// ---------- Pin / Wiring ----------

export interface PinMapping {
  component: string;
  pinId: string;
  type: "Analog" | "Digital" | "I2C";
  colorDot: string;
  subLabels?: { label: string; pinId: string }[];
}

export interface PinIssue {
  pinId: string;
  severity: "warning" | "error";
  title: string;
  detail: string;
}

export type WiringStage =
  | "idle"
  | "generating"   // 自动分配中
  | "review"       // 分配完成（可能带冲突）
  | "validated"    // 规则已校验
  | "error";

// ---------- Firmware ----------

export type FirmwareStage =
  | "idle"
  | "generating"
  | "proposal"    // Diff 待决策
  | "accepted"
  | "rejected"
  | "error";

export interface FirmwareProposal {
  id: string;
  title: string;
  status: ProposalDecision;
  bootRisk?: boolean; // S6：真实提案 diff 是否含重映射/风险（无风险提案隐藏 Diff/风险区）
  // Diff 视图所需
  file: string;
  oldPin: string;
  newPin: string;
  oldCode: string;
  newCode: string;
  riskTitle: string;
  riskDetail: string;
  impacts: string[];
  versionFrom: number;
  versionTo: number;
}

// ---------- Build ----------

export type BuildStage =
  | "idle"
  | "building"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "retrying";

export interface BuildLogLine {
  text: string;
  kind: "cmd" | "info" | "ok" | "err" | "warn" | "flash" | "serial";
}

export interface BuildDiagnosis {
  title: string;
  cause: string;
  fix: string;
  // 修复以"提案"形态呈现（AI 不静默改固件）——diff 为代码块文本
  proposal: { file: string; diff: string; proposalId?: string } | null;
}

// ---------- Companion / Device ----------

export type DeviceStage =
  | "none"         // 未检测
  | "detected"     // 已检测（未连接）
  | "connected"    // 已连接
  | "flashing"     // 烧录中（高风险）
  | "disconnected";// 断开

export type CompanionStage =
  | "idle"
  | "detecting"
  | "building"
  | "flashing"
  | "serial"
  | "unavailable";

// ---------- Copilot ----------

export interface CopilotChatMessage {
  id: string;
  sender: "user" | "copilot" | "system";
  text?: string;
  title?: string;
  badge?: string;
  warningNote?: string;
  streaming?: boolean; // 流式输出中
  codeSnippet?: {
    filename: string;
    oldPin: string;
    newPin: string;
    code: string;
  };
  proposalCard?: {
    issueTitle: string;
    description: string;
    suggestedFix: string;
    onAcceptLabel?: string;
  };
}

// ---------- 全局运行时状态（Mock 可触发） ----------

export interface RuntimeFlags {
  online: boolean | null;             // null = 未从服务端确认
  providerAvailable: boolean | null;  // null = 未从服务端确认
  toolchainAvailable: boolean | null; // null = 未从服务端确认
  deviceStage: DeviceStage;
  deviceId: string | null;
  deviceTruth: DeviceTruthDto | null;
  serialStage: "disconnected" | "opening" | "connected" | "error";
  serialSession: SerialSessionDto | null;
  slowMode: boolean;           // 长任务可取消演示
}

// ---------- 完整 App 状态 ----------

export interface AppState {
  // 导航
  nav: NavigationTab;
  sidebar: SidebarTab;
  copilotTab: CopilotTab;

  // 语言 / 主题
  lang: Language;
  theme: ThemeMode;

  // 项目
  project: { id: string; name: string; target: string | null; port: string | null } | null;
  projects: ProjectCard[];   // Home 列表（含空态演示）

  // Artifact 状态总表
  artifacts: Record<ArtifactKind, ArtifactState>;

  // Requirements 视图
  discoveryPrompt: string;
  discovery: {
    stage: DiscoveryStage;
    capabilities: DiscoveredRequirement[];
    proposals: RequirementProposal[];
    clarification: Clarification | null;
    error: AppError | null;
    streamedText: string;
    analysisTask: TaskDto | null;
    analysisPhase: {
      phase: "provider_waiting" | "provider_streaming" | "processing";
      operation: "stream_text" | "generate_structured" | "application";
      timestamp: string;
    } | null;
    nextFails: boolean;    // Lab：下次解析失败
    partialNext: boolean;  // Lab：部分解析 3/4
  };

  // Hardware 视图
  candidates: McuCandidate[];
  peripherals: Peripheral[];
  selectedMcu: string;

  // Wiring 视图
  wiring: {
    stage: WiringStage;
    pinMappings: PinMapping[];
    issues: PinIssue[];
    verified: boolean;
  };

  // S2：pinmap Artifact 版本历史（真实 capability commit_manual_edit 的 UI 呈现）
  pinmapVersions: Array<{
    id: string;
    versionNo: number;
    status: "draft" | "accepted";
    sourceKind: "manual" | "ai";
    createdAt: string;
  }>;

  // Firmware 视图
  firmware: {
    stage: FirmwareStage;
    code: string;
    proposal: FirmwareProposal | null;
    version: number;
  };

  // Build 视图
  build: {
    buildId: string | null;
    stage: BuildStage;
    outputVerified: boolean;
    logs: BuildLogLine[];
    diagnosis: BuildDiagnosis | null;
    nextFails: boolean;  // Lab：下次编译失败
    fixApplied: boolean; // AI 修复提案已应用（platformio.ini）
  };

  // Companion
  companion: {
    stage: CompanionStage;
    serialLines: string[];
    moisture: number | null;
    temperature: number | null;
    pumpActive: boolean;
    flashProgress: number;
  };

  // Copilot
  copilotMessages: CopilotChatMessage[];

  // S5B Revalidate（真实 revalidate_artifact 结果；提案卡等待决策——D1 不自动接受）
  revalidate: {
    running: boolean; // 逐项重算中
    proposals: Array<{ proposalId: string; kind: ArtifactKind }>;
  };

  // 运行时
  runtime: RuntimeFlags;
  labOpen: boolean; // State Lab 面板
}
