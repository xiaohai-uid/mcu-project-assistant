// ============================================================
// AppContext — 应用状态容器（Progressive Swap 完成态，S10）
// reducer + 异步动作（编排真实 HTTP/SSE API）+ State Lab 场景
// ============================================================
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type {
  AppState,
  ArtifactKind,
  ArtifactState,
  BuildLogLine,
  CopilotChatMessage,
  DiscoveredRequirement,
  Language,
  PinIssue,
  PinMapping,
  RequirementProposal,
  NavigationTab,
  ProposalDecision,
  SidebarTab,
  ThemeMode,
} from "../types";
import type { DeviceTruthDto } from "@/src/shared-contracts/types";
import {
  sleep,
} from "../mock/engine";
import { format, getInitialLanguage, getInitialTheme } from "../lib/i18n";
import { api as clientApi, ApiError, toAppError, type AppError } from "../api/client";
import { subscribeProjectEvents } from "../api/sse";
import { createReconnectHydrationRetry } from "./reconnect-hydration";
import type { AnalysisCapabilityDto, McuCandidateDto, PeripheralDto } from "../api/client";
import type { TaskDto } from "../api/client";
import {
  latestTask,
  hasVerifiedFirmwareOutput,
  matchesBuildEvent,
  mergeTaskTruth,
  parseAnalysisCapabilities,
  parseFlashTruth,
  parseTaskInput,
  type ProjectHydrationSnapshot,
} from "./hydration";

// ---------- 初始状态 ----------

const freshArtifacts = (): Record<ArtifactKind, ArtifactState> => ({
  requirements: { kind: "requirements", status: "draft", version: 0 },
  hardware: { kind: "hardware", status: "draft", version: 0 },
  pinmap: { kind: "pinmap", status: "draft", version: 0 },
  wiring: { kind: "wiring", status: "draft", version: 0 },
  firmware: { kind: "firmware", status: "draft", version: 0 },
  build: { kind: "build", status: "draft", version: 0 },
  validation: { kind: "validation", status: "draft", version: 0 },
  debug: { kind: "debug", status: "draft", version: 0 },
});

function dtoCapability(c: ReturnType<typeof parseAnalysisCapabilities>[number]): DiscoveredRequirement {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    progress: c.progress,
    icon: c.icon,
    isWarning: c.isWarning,
    details: c.details,
  };
}

function dtoProposal(p: import("../api/client").ProposalDto): RequirementProposal {
  let title = p.id;
  let initialIdea = "";
  let formalizedRequirement = "";
  try {
    const parsed = JSON.parse(p.payload) as { title?: string; initialIdea?: string; formalizedRequirement?: string };
    title = parsed.title ?? p.id;
    initialIdea = parsed.initialIdea ?? "";
    formalizedRequirement = parsed.formalizedRequirement ?? "";
  } catch {
    // Durable malformed payload remains identifiable by id.
  }
  return {
    id: p.id,
    number: String(p.number).padStart(2, "0"),
    title,
    accepted: p.status === "accepted",
    initialIdea,
    formalizedRequirement,
    impacts: p.impacts,
    decision: p.status,
  };
}

function artifactStatus(version: ProjectHydrationSnapshot["artifacts"][number]["version"]): ArtifactState["status"] {
  return version?.status === "accepted" ? "accepted" : "draft";
}

function contentObject(content: string | null): Record<string, unknown> {
  if (!content) return {};
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parsePinIssue(value: unknown): PinIssue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.pinId !== "string" || (record.severity !== "warning" && record.severity !== "error") || typeof record.title !== "string" || typeof record.detail !== "string") {
    return null;
  }
  const source = record.source;
  const sourceRecord = source && typeof source === "object" ? source as Record<string, unknown> : null;
  return {
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    pinId: record.pinId,
    severity: record.severity,
    title: record.title,
    detail: record.detail,
    ...(typeof record.blocksClaim === "boolean" ? { blocksClaim: record.blocksClaim } : {}),
    ...(typeof record.componentId === "string" ? { componentId: record.componentId } : {}),
    ...(typeof record.pendingReason === "string" ? { pendingReason: record.pendingReason } : {}),
    ...(sourceRecord && typeof sourceRecord.owner === "string" && typeof sourceRecord.url === "string" && typeof sourceRecord.title === "string" && typeof sourceRecord.accessedAt === "string" && typeof sourceRecord.confidence === "string"
      ? {
          source: {
            owner: sourceRecord.owner,
            url: sourceRecord.url,
            title: sourceRecord.title,
            ...(typeof sourceRecord.revision === "string" ? { revision: sourceRecord.revision } : {}),
            accessedAt: sourceRecord.accessedAt,
            confidence: sourceRecord.confidence,
          },
        }
      : {}),
  };
}

function latestBuildStage(builds: ProjectHydrationSnapshot["artifacts"][number]["builds"]): AppState["build"]["stage"] {
  const build = builds.at(-1);
  if (!build) return "idle";
  if (build.status === "running") return "building";
  if (build.status === "succeeded") return "succeeded";
  if (build.status === "failed") return "failed";
  return "cancelled";
}

function initialState(): AppState {
  return {
    nav: "Home",
    sidebar: "Requirements",
    copilotTab: "Chat",
    lang: getInitialLanguage(),
    theme: getInitialTheme(),
    project: null,
    projects: [],
    artifacts: freshArtifacts(),
    discoveryPrompt: "",
    discovery: {
      stage: "idle",
      capabilities: [],
      proposals: [],
      clarification: null,
      error: null,
      streamedText: "",
      analysisTask: null,
      analysisPhase: null,
      nextFails: false,
      partialNext: false,
    },
    // S10：候选/外设由真实 /recommend-mcu 填充（HardwareSelectionView mount 时拉取），无 mock 占位
    candidates: [],
    peripherals: [],
    selectedMcu: "",
    wiring: {
      stage: "idle",
      pinMappings: [],
      issues: [],
      verified: false,
    },
    pinmapVersions: [],
    firmware: {
      stage: "idle",
      code: "",
      proposal: null,
      version: 0,
    },
    build: {
      buildId: null,
      stage: "idle",
      outputVerified: false,
      logs: [],
      diagnosis: null,
      nextFails: false,
      fixApplied: false,
    },
    companion: {
      stage: "idle",
      serialLines: [],
      moisture: null,
      temperature: null,
      pumpActive: false,
      flashProgress: 0,
    },
    copilotMessages: [
      {
        id: "sys-welcome",
        sender: "system",
        text: "Workspace ready. Describe your idea in Requirements to start discovery.",
      },
    ],
    revalidate: { running: false, proposals: [] },
    runtime: {
      online: null,
      providerAvailable: null,
      toolchainAvailable: null,
      deviceStage: "none",
      deviceId: null,
      deviceTruth: null,
      serialStage: "disconnected",
      serialSession: null,
      slowMode: false,
    },
    labOpen: false,
  };
}

// ---------- Actions ----------

type Action =
  | { type: "NAV"; nav: NavigationTab }
  | { type: "SIDEBAR"; sidebar: SidebarTab }
  | { type: "COPILOT_TAB"; tab: "Chat" | "Context" | "History" }
  | { type: "LANG"; lang: Language }
  | { type: "THEME"; theme: ThemeMode }
  | { type: "LAB_OPEN"; open: boolean }
  | { type: "CREATE_PROJECT"; id: string; name: string }
  | { type: "OPEN_PROJECT"; id: string; name: string }
  | { type: "HYDRATE_PROJECT"; snapshot: ProjectHydrationSnapshot }
  | { type: "DELETE_PROJECT"; id: string }
  | { type: "SET_PROMPT"; prompt: string }
  | { type: "DISC_SET_STAGE"; stage: AppState["discovery"]["stage"] }
  | { type: "DISC_TASK"; task: TaskDto }
  | { type: "DISC_TASK_PATCH"; patch: Partial<TaskDto> }
  | { type: "DISC_STREAM"; text: string }
  | { type: "DISC_PHASE"; phase: AppState["discovery"]["analysisPhase"] }
  | { type: "DISC_CLEAR_RESULTS" }
  | { type: "DISC_CAPABILITY"; cap: AppState["discovery"]["capabilities"][number] }
  | { type: "DISC_CLARIFICATION"; c: AppState["discovery"]["clarification"] }
  | { type: "DISC_DONE"; caps: AppState["discovery"]["capabilities"]; props: AppState["discovery"]["proposals"] }
  | { type: "DISC_ERROR"; error: AppError | string }
  | { type: "DISC_DECISION"; id: string; decision: ProposalDecision }
  | { type: "DISC_NEXT_FAIL"; v: boolean }
  | { type: "DISC_PARTIAL"; v: boolean }
  | { type: "ARTIFACT"; kind: ArtifactKind; status: ArtifactState["status"]; version?: number }
  | { type: "STALE_MARKS"; marks: Array<{ kind: string; level: string }> }
  | { type: "REVAL_RUNNING"; running: boolean }
  | { type: "REVAL_PROPOSALS"; proposals: Array<{ proposalId: string; kind: ArtifactKind }> }
  | { type: "REVAL_REMOVE_PROPOSAL"; proposalId: string }
  | { type: "SELECT_MCU"; mcu: string }
  | { type: "MCU_CANDIDATES"; candidates: McuCandidateDto[]; peripherals: PeripheralDto[] }
  | { type: "WIRING_GENERATED"; pins: AppState["wiring"]["pinMappings"]; issues: AppState["wiring"]["issues"] }
  | { type: "WIRING_STAGE"; stage: AppState["wiring"]["stage"] }
  | { type: "WIRING_VERIFIED"; verified: boolean; issues: AppState["wiring"]["issues"] }
  | { type: "PIN_EDITED"; component: string; oldPin: string; pinId: string }
  | { type: "PINMAP_VERSIONS"; versions: AppState["pinmapVersions"] }
  | { type: "FW_GENERATING" }
  | { type: "FW_RESET" }
  | { type: "FW_PROPOSAL"; p: AppState["firmware"]["proposal"] }
  | { type: "FW_ACCEPTED" }
  | { type: "FW_REJECTED" }
  | { type: "FW_CODE"; code: string; version: number }
  | { type: "BUILD_STAGE"; stage: AppState["build"]["stage"] }
  | { type: "BUILD_ID"; buildId: string | null }
  | { type: "BUILD_EVIDENCE"; verified: boolean }
  | { type: "BUILD_LOG"; line: BuildLogLine }
  | { type: "BUILD_LOGS"; logs: BuildLogLine[] }
  | { type: "BUILD_NEXT_FAIL"; v: boolean }
  | { type: "BUILD_FIX_APPLIED" }
  | { type: "DIAGNOSIS"; d: AppState["build"]["diagnosis"] }
  | { type: "RUNTIME"; patch: Partial<AppState["runtime"]> }
  | { type: "COMPANION_STAGE"; stage: AppState["companion"]["stage"] }
  | { type: "COMPANION_SERIAL"; line: string }
  | { type: "COMPANION_TELEMETRY"; moisture?: number | null; temperature?: number | null; pumpActive?: boolean; flashProgress?: number }
  | { type: "FLASH_PROGRESS"; pct: number }
  | { type: "COPILOT_PUSH"; msg: CopilotChatMessage }
  | { type: "COPILOT_UPDATE"; id: string; patch: Partial<CopilotChatMessage> };

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case "NAV": return { ...state, nav: a.nav };
    case "SIDEBAR": return { ...state, sidebar: a.sidebar };
    case "COPILOT_TAB": return { ...state, copilotTab: a.tab };
    case "LANG": return { ...state, lang: a.lang };
    case "THEME": return { ...state, theme: a.theme };
    case "LAB_OPEN": return { ...state, labOpen: a.open };
    case "CREATE_PROJECT":
      return {
        ...state,
        project: { id: a.id, name: a.name, target: null, port: null },
        nav: "Draft",
        sidebar: "Requirements",
        artifacts: freshArtifacts(),
        discovery: { ...initialState().discovery, ...state.discovery, stage: "idle", capabilities: [], proposals: [], clarification: null, error: null, streamedText: "" },
        wiring: initialState().wiring,
        firmware: initialState().firmware,
        build: initialState().build,
        companion: initialState().companion,
        selectedMcu: "",
        runtime: { ...state.runtime, online: true, providerAvailable: null, toolchainAvailable: null, deviceStage: "none", deviceId: null, deviceTruth: null, serialStage: "disconnected", serialSession: null },
        copilotMessages: [
          { id: `sys-${Date.now()}`, sender: "system", text: `Project "${a.name}" created. Start with Requirements discovery.` },
        ],
      };
    case "OPEN_PROJECT":
      return { ...state, project: { id: a.id, name: a.name, target: null, port: null }, nav: "Draft", sidebar: "Requirements", discovery: { ...state.discovery, analysisTask: null } };
    case "HYDRATE_PROJECT": {
      const snapshot = a.snapshot;
      const analysisTask = mergeTaskTruth(state.discovery.analysisTask, latestTask(snapshot.tasks, "analyze_requirement"));
      const analysisOutput = analysisTask?.status === "completed" ? parseAnalysisCapabilities(analysisTask.output) : [];
      const proposalItems = snapshot.proposals.map(dtoProposal);
      const taskInput = parseTaskInput(analysisTask?.input ?? null);
      const taskDescription = typeof taskInput.description === "string" ? taskInput.description : "";
      const staleKinds = new Set(snapshot.staleMarks.map((mark) => mark.kind).filter((kind): kind is string => typeof kind === "string"));
      const hydratedArtifacts = freshArtifacts();
      let firmwareCode = "";
      let firmwareVersion = 0;
      let firmwareStage: AppState["firmware"]["stage"] = "idle";
      let selectedMcu = "";
      let pinMappings: PinMapping[] = [];
      let wiringIssues: PinIssue[] = [];
      let pinmapVersions: AppState["pinmapVersions"] = [];
      let build: AppState["build"] = { ...state.build, buildId: null, stage: "idle", outputVerified: false, logs: [], diagnosis: null };
      for (const item of snapshot.artifacts) {
        const kind = item.artifact.kind as ArtifactKind;
        if (!(kind in hydratedArtifacts)) continue;
        const version = item.version;
        const status = staleKinds.has(kind) ? "stale" : artifactStatus(version);
        hydratedArtifacts[kind] = { kind, status, version: version?.versionNo ?? 0 };
        if (kind === "firmware") {
          firmwareCode = item.content ?? "";
          firmwareVersion = version?.versionNo ?? 0;
          firmwareStage = version?.status === "accepted" ? "accepted" : version ? "proposal" : "idle";
          const latest = item.builds.at(-1);
          build = {
            ...build,
            buildId: latest?.id ?? null,
            stage: latestBuildStage(item.builds),
            outputVerified: latest ? hasVerifiedFirmwareOutput(latest) : false,
          };
        }
        if (kind === "hardware") {
          const parsed = contentObject(item.content);
          selectedMcu = typeof parsed.selectedMcuId === "string" ? parsed.selectedMcuId : "";
        }
        if (kind === "pinmap") {
          pinmapVersions = item.versions.map((v) => ({ id: v.id, versionNo: v.versionNo, status: v.status, sourceKind: v.sourceKind === "manual" ? "manual" : "ai", createdAt: v.createdAt }));
          const parsed = contentObject(item.content);
          const pins = parsed.pinMap ?? parsed.pins;
          if (Array.isArray(pins)) {
            pinMappings = pins.filter((pin): pin is PinMapping => {
              const item = pin as unknown as Record<string, unknown>;
              return typeof item.component === "string" && typeof item.pinId === "string";
            }).map((pin) => {
              const item = pin as unknown as Record<string, unknown>;
              return { ...pin, type: item.type === "Analog" || item.type === "I2C" ? pin.type : "Digital", colorDot: pin.colorDot ?? "#007aff" };
            });
          }
          const issues = parsed.issues;
          if (Array.isArray(issues)) wiringIssues = issues.map(parsePinIssue).filter((issue): issue is PinIssue => issue !== null);
        }
      }
      const flashTask = latestTask(snapshot.tasks, "flash_device");
      const lastKnownTruth = parseFlashTruth(flashTask?.output ?? null) ?? snapshot.device.lastDevice?.truth ?? null;
      const analysisStage = analysisTask?.status === "completed"
        ? "ready"
        : analysisTask?.status === "failed"
          ? "error"
          : analysisTask?.status === "cancelled"
            ? "cancelled"
            : analysisTask && (analysisTask.status === "queued" || analysisTask.status === "running")
              ? "analyzing"
              : "idle";
      return {
        ...state,
        project: { id: snapshot.project.id, name: snapshot.project.name, target: null, port: null },
        artifacts: hydratedArtifacts,
        discoveryPrompt: taskDescription,
        discovery: {
          ...state.discovery,
          stage: analysisStage,
          capabilities: analysisOutput.map(dtoCapability),
          proposals: proposalItems,
          clarification: null,
          error: analysisTask?.status === "failed"
            ? analysisTask.error ? { code: analysisTask.error.code, message: analysisTask.error.message } : { code: "internal", message: "Analysis failed" }
            : null,
          streamedText: "",
          analysisPhase: null,
          analysisTask,
        },
        selectedMcu,
        wiring: { ...state.wiring, stage: pinMappings.length ? "review" : "idle", pinMappings, issues: wiringIssues, verified: false },
        pinmapVersions,
        firmware: { ...state.firmware, stage: firmwareStage, code: firmwareCode, proposal: null, version: firmwareVersion },
        build,
        companion: { ...state.companion, stage: "idle", serialLines: [], moisture: null, temperature: null, pumpActive: false, flashProgress: 0 },
        runtime: { ...state.runtime, online: true, providerAvailable: null, toolchainAvailable: snapshot.toolchain.available, deviceStage: "none", deviceId: snapshot.device.lastDevice?.id ?? null, deviceTruth: lastKnownTruth, serialStage: "disconnected", serialSession: null },
        nav: "Draft",
        sidebar: "Requirements",
      };
    }
    case "DELETE_PROJECT":
      return { ...state, projects: state.projects.filter((p) => p.id !== a.id) };
    case "SET_PROMPT": return { ...state, discoveryPrompt: a.prompt };
    case "DISC_SET_STAGE": return { ...state, discovery: { ...state.discovery, stage: a.stage } };
    case "DISC_TASK": return { ...state, discovery: { ...state.discovery, analysisTask: mergeTaskTruth(state.discovery.analysisTask, a.task) } };
    case "DISC_TASK_PATCH": {
      if (!state.discovery.analysisTask) return state;
      return { ...state, discovery: { ...state.discovery, analysisTask: mergeTaskTruth(state.discovery.analysisTask, { ...state.discovery.analysisTask, ...a.patch }) } };
    }
    case "DISC_STREAM": return { ...state, discovery: { ...state.discovery, streamedText: state.discovery.streamedText + a.text } };
    case "DISC_PHASE": return { ...state, discovery: { ...state.discovery, analysisPhase: a.phase } };
    case "DISC_CLEAR_RESULTS": return { ...state, discovery: { ...state.discovery, capabilities: [], proposals: [], clarification: null, error: null, streamedText: "", analysisPhase: null } };
    case "DISC_CAPABILITY":
      return { ...state, discovery: { ...state.discovery, capabilities: [...state.discovery.capabilities, a.cap] } };
    case "DISC_CLARIFICATION": return { ...state, discovery: { ...state.discovery, clarification: a.c } };
    case "DISC_DONE":
      return {
        ...state,
        discovery: {
          ...state.discovery,
          stage: "ready",
          capabilities: a.caps,
          proposals: a.props.map((p) => ({ ...p, decision: p.accepted ? "accepted" : "pending" })),
          clarification: null,
          error: null,
          analysisPhase: null,
        },
      };
    case "DISC_ERROR": {
      const error = typeof a.error === "string" ? { code: "internal", message: a.error } : a.error;
      return { ...state, discovery: { ...state.discovery, stage: "error", error } };
    }
    case "DISC_DECISION":
      return {
        ...state,
        discovery: {
          ...state.discovery,
          proposals: state.discovery.proposals.map((p) => (p.id === a.id ? { ...p, decision: a.decision } : p)),
        },
      };
    case "DISC_NEXT_FAIL": return { ...state, discovery: { ...state.discovery, nextFails: a.v } };
    case "DISC_PARTIAL": return { ...state, discovery: { ...state.discovery, partialNext: a.v } };
    case "ARTIFACT":
      return {
        ...state,
        artifacts: {
          ...state.artifacts,
          [a.kind]: {
            kind: a.kind,
            status: a.status,
            version: a.version ?? state.artifacts[a.kind].version,
          },
        },
      };
    case "STALE_MARKS": {
      // 真实服务端 marks（get_stale_scope）——mark 即事实（服务端仅对存在内容的 artifact 打标）
      const marked = new Set(a.marks.filter((m) => m.kind in state.artifacts).map((m) => m.kind));
      const next = { ...state.artifacts };
      for (const k of Object.keys(next) as ArtifactKind[]) {
        const cur = next[k];
        if (marked.has(k)) {
          if (cur.status !== "stale" && cur.status !== "error") {
            next[k] = { ...cur, status: "stale", baseStatus: cur.status };
          }
        } else if (cur.status === "stale") {
          next[k] = { ...cur, status: cur.baseStatus ?? "accepted", baseStatus: undefined };
        }
      }
      return { ...state, artifacts: next };
    }
    case "REVAL_RUNNING":
      return { ...state, revalidate: { ...state.revalidate, running: a.running } };
    case "REVAL_PROPOSALS":
      return { ...state, revalidate: { ...state.revalidate, proposals: a.proposals } };
    case "REVAL_REMOVE_PROPOSAL":
      return {
        ...state,
        revalidate: { ...state.revalidate, proposals: state.revalidate.proposals.filter((p) => p.proposalId !== a.proposalId) },
      };
    case "SELECT_MCU":
      return { ...state, selectedMcu: a.mcu };
    case "MCU_CANDIDATES":
      return {
        ...state,
        candidates: a.candidates.map((c) => ({
          id: c.id,
          title: c.displayName,
          badgeKey: c.tier,
          core: c.core,
          wireless: c.wireless,
          gpio: c.ioMatrix,
          flash: c.flashSram,
          reason: c.reason,
          constraints: c.constraints,
          referenceKit: c.referenceKit,
        })),
        peripherals: a.peripherals.map((p) => ({
          id: p.id,
          title: p.displayName,
          type: p.capability,
          interface: p.interfaceType,
          pinsNeeded: "",
          status: "已提取",
          icon: p.interfaceType === "i2c" ? "monitor" : p.interfaceType === "analog" ? "water_drop" : "valve",
        })),
      };
    case "WIRING_GENERATED":
      return { ...state, wiring: { ...state.wiring, stage: "review", pinMappings: a.pins, issues: a.issues, verified: false } };
    case "WIRING_STAGE": return { ...state, wiring: { ...state.wiring, stage: a.stage } };
    case "WIRING_VERIFIED": return { ...state, wiring: { ...state.wiring, verified: a.verified, issues: a.issues } };
    case "PIN_EDITED": {
      const pins = state.wiring.pinMappings.map((p) => (p.component === a.component ? { ...p, pinId: a.pinId } : p));
      const issues = state.wiring.issues.flatMap((i) => {
        if (i.pinId !== a.oldPin) return [i];
        if (i.code === "STRAPPING_PIN_USAGE") return [];
        return [{ ...i, pinId: a.pinId }];
      });
      return { ...state, wiring: { ...state.wiring, pinMappings: pins, issues } };
    }
    case "PINMAP_VERSIONS": return { ...state, pinmapVersions: a.versions };
    case "FW_GENERATING": return { ...state, firmware: { ...state.firmware, stage: "generating" } };
    case "FW_RESET": return { ...state, firmware: { ...state.firmware, stage: "idle", proposal: null } };
    case "FW_PROPOSAL": return { ...state, firmware: { ...state.firmware, stage: "proposal", proposal: a.p } };
    case "FW_ACCEPTED":
      return {
        ...state,
        firmware: {
          ...state.firmware,
          stage: "accepted",
          version: state.firmware.proposal?.versionTo ?? state.firmware.version,
          code: state.firmware.proposal?.newCode ?? state.firmware.code,
        },
        // 联动更新 Pin Map（Relay → 新引脚）
        wiring: {
          ...state.wiring,
          pinMappings: state.wiring.pinMappings.map((p) =>
            p.component.includes("Pump") ? { ...p, pinId: state.firmware.proposal?.newPin ?? p.pinId } : p
          ),
          issues: [],
        },
      };
    case "FW_REJECTED":
      return { ...state, firmware: { ...state.firmware, stage: "rejected" } };
    case "FW_CODE": return { ...state, firmware: { ...state.firmware, code: a.code, version: a.version } };
    case "BUILD_STAGE": return { ...state, build: { ...state.build, stage: a.stage, ...(a.stage !== "succeeded" ? { outputVerified: false } : {}) } };
    case "BUILD_ID": return { ...state, build: { ...state.build, buildId: a.buildId, outputVerified: false } };
    case "BUILD_EVIDENCE": return { ...state, build: { ...state.build, outputVerified: a.verified } };
    case "BUILD_LOG": return { ...state, build: { ...state.build, logs: [...state.build.logs, a.line] } };
    case "BUILD_LOGS": return { ...state, build: { ...state.build, logs: a.logs } };
    case "BUILD_NEXT_FAIL": return { ...state, build: { ...state.build, nextFails: a.v } };
    case "BUILD_FIX_APPLIED": return { ...state, build: { ...state.build, fixApplied: true } };
    case "DIAGNOSIS": return { ...state, build: { ...state.build, diagnosis: a.d } };
    case "RUNTIME": return { ...state, runtime: { ...state.runtime, ...a.patch } };
    case "COMPANION_STAGE": return { ...state, companion: { ...state.companion, stage: a.stage } };
    case "COMPANION_SERIAL":
      return { ...state, companion: { ...state.companion, serialLines: [...state.companion.serialLines, a.line].slice(-60) } };
    case "COMPANION_TELEMETRY":
      return { ...state, companion: { ...state.companion, ...a } };
    case "FLASH_PROGRESS": return { ...state, companion: { ...state.companion, flashProgress: a.pct } };
    case "COPILOT_PUSH": return { ...state, copilotMessages: [...state.copilotMessages, a.msg] };
    case "COPILOT_UPDATE":
      return {
        ...state,
        copilotMessages: state.copilotMessages.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)),
      };
    default:
      return state;
  }
}

// ---------- Context ----------

interface AppApi {
  state: AppState;
  dispatch: (a: Action) => void;
  // 动作
  createProject: (name?: string) => Promise<boolean>;
  openProject: (id: string) => Promise<boolean>;
  archiveProject: (id: string) => Promise<boolean>;
  setNav: (n: NavigationTab) => void;
  setSidebar: (s: SidebarTab) => void;
  startDiscovery: () => void;
  cancelDiscovery: () => void;
  answerClarification: (answer: string) => void;
  skipClarification: () => void;
  setProposalDecision: (id: string, d: ProposalDecision) => void;
  proceedToHardware: () => void;
  selectMcu: (mcu: string) => void;
  refreshMcuCandidates: () => Promise<void>;
  generatePins: () => void;
  verifyRules: () => void;
  editPin: (component: string, pinId: string) => void;
  refreshPinmapVersions: () => Promise<void>;
  generateFirmware: () => void;
  acceptFirmwareProposal: () => void;
  rejectFirmwareProposal: () => void;
  startBuild: () => void;
  cancelBuild: () => void;
  retryBuild: () => void;
  runDiagnosis: () => void;
  applyFix: () => void;
  detectBoard: () => void;
  openSerial: () => void;
  closeSerial: () => Promise<void>;
  sendSerial: (cmd: string) => void;
  simulateMoisture: (v: number) => void;
  togglePump: () => void;
  flashDevice: () => void;
  flashWithConfirmation: () => void;
  revalidateAll: () => void;
  checkToolchain: () => Promise<void>;
  decideRevalidateProposal: (proposalId: string, decision: "accept" | "reject") => void;
  sendCopilotMessage: (text: string) => void;
  runScenario: (id: string) => void;
}

const Ctx = createContext<AppApi | null>(null);

let msgSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${msgSeq++}`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const cancelRef = useRef<{ discovery?: boolean; build?: boolean; flash?: boolean }>({});
  const buildRef = useRef<{ buildId: string | null; close?: () => void }>({ buildId: null });
  const deviceRef = useRef<{ close?: () => void }>({});
  const serialRef = useRef<{ close?: () => void }>({});
  const serialSessionRef = useRef<{ projectId: string; sessionId: string } | null>(null);
  const taskRef = useRef<{ taskId: string; roundId: number; close: (() => void) | null }>({ taskId: "", roundId: 0, close: null });
  const hydrationSeq = useRef(0);
  const analysisEventRef = useRef<(projectId: string, type: string, data: unknown) => void>(() => undefined);
  const s = state;

  const processAnalysisEvent = useCallback((projectId: string, type: string, data: unknown) => {
    switch (type) {
      case "requirement.analysis.started":
        dispatch({ type: "DISC_TASK_PATCH", patch: { status: "running" } });
        break;
      case "requirement.analysis.progress": {
        const progress = data as { stage?: string; chunk?: string };
        if (progress.stage === "streaming" && progress.chunk) dispatch({ type: "DISC_STREAM", text: progress.chunk });
        if (progress.stage === "capabilities" && progress.chunk) {
          try {
            const parsed = JSON.parse(progress.chunk) as AnalysisCapabilityDto;
            dispatch({ type: "DISC_CAPABILITY", cap: dtoCapability(parsed) });
          } catch {
            // Ignore a partial SSE frame; the durable task output remains authoritative.
          }
        }
        break;
      }
      case "requirement.analysis.phase": {
        const phase = data as AppState["discovery"]["analysisPhase"];
        dispatch({ type: "DISC_PHASE", phase });
        break;
      }
      case "requirement.analysis.clarification.requested": {
        const clarification = data as { roundId: number; question: string; detail?: string };
        taskRef.current.roundId = clarification.roundId;
        dispatch({ type: "DISC_PHASE", phase: null });
        dispatch({ type: "DISC_CLARIFICATION", c: { question: clarification.question, detail: clarification.detail ?? "", answer: "", answered: false } });
        dispatch({ type: "DISC_SET_STAGE", stage: "clarifying" });
        break;
      }
      case "requirement.analysis.completed": {
        const completed = data as { capabilities?: AnalysisCapabilityDto[] };
        const capabilities = (completed.capabilities ?? []).map(dtoCapability);
        dispatch({ type: "DISC_PHASE", phase: null });
        dispatch({ type: "DISC_DONE", caps: capabilities, props: [] });
        void clientApi.listProposals(projectId).then((proposals) => {
          dispatch({ type: "DISC_DONE", caps: capabilities, props: proposals.map(dtoProposal) });
        }).catch(() => undefined);
        break;
      }
      case "requirement.analysis.failed": {
        const failure = data as { code?: string; message?: string; reason?: string };
        const error = toAppError(failure, "Analysis failed");
        dispatch({ type: "DISC_PHASE", phase: null });
        dispatch({ type: "DISC_TASK_PATCH", patch: { status: "failed", completedAt: new Date().toISOString(), error } });
        dispatch({ type: "DISC_ERROR", error });
        break;
      }
      case "requirement.analysis.cancelled":
        dispatch({ type: "DISC_PHASE", phase: null });
        dispatch({ type: "DISC_TASK_PATCH", patch: { status: "cancelled", completedAt: new Date().toISOString() } });
        dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
        break;
      case "provider.unavailable": {
        dispatch({ type: "RUNTIME", patch: { providerAvailable: false } });
        const failure = data as { code?: string; message?: string; reason?: string };
        dispatch({ type: "DISC_ERROR", error: toAppError(failure, "AI provider is unavailable") });
        break;
      }
      default:
        break;
    }
  }, []);
  analysisEventRef.current = processAnalysisEvent;

  // ---------- Copilot 帮助 ----------

  const pushCopilot = useCallback(
    (msg: Omit<CopilotChatMessage, "id">) => dispatch({ type: "COPILOT_PUSH", msg: { ...msg, id: nextId("msg") } }),
    []
  );

  const pushSystem = useCallback(
    (text: string) => pushCopilot({ sender: "system", text }),
    [pushCopilot]
  );

  const copilotStream = useCallback(
    async (full: string, title?: string) => {
      const id = nextId("cop");
      dispatch({ type: "COPILOT_PUSH", msg: { id, sender: "copilot", text: "", streaming: true, title } });
      const chunkSize = 18;
      for (let i = 0; i < full.length; i += chunkSize) {
        await sleep(s.runtime.slowMode ? 220 : 60);
        dispatch({ type: "COPILOT_UPDATE", id, patch: { text: full.slice(0, i + chunkSize) } });
      }
      dispatch({ type: "COPILOT_UPDATE", id, patch: { streaming: false } });
    },
    [s.runtime.slowMode]
  );

  // ---------- 项目 ----------

  // ---------- Stale 重新验证（S5B：真实 stale-marks 拉取；上游动作后刷新呈现） ----------

  const refreshStaleMarks = useCallback(async (projectId: string) => {
    try {
      const { marks } = await clientApi.getStaleMarks(projectId);
      dispatch({ type: "STALE_MARKS", marks: marks.map((m) => ({ kind: m.kind ?? "", level: m.level })) });
    } catch {
      // marks 拉取失败保持当前呈现（transport 错误由下一动作呈现）
    }
  }, []);

  // ---------- S7 Build：工具链真实检测 + SSE 构建事件 ----------

  const checkToolchain = useCallback(async () => {
    try {
      const info = await clientApi.checkToolchain();
      dispatch({ type: "RUNTIME", patch: { toolchainAvailable: info.available } });
      if (info.available) {
        pushSystem(`Toolchain ready: ${info.toolchain}${info.version ? ` (${info.version})` : ""}.`);
      } else {
        pushSystem(`Toolchain unavailable: ${info.reason ?? "unknown"}.`);
      }
    } catch {
      // 检测失败保持当前呈现
    }
  }, [pushSystem]);

  /** 编译输出行着色（真实输出无 mock 标记；按内容启发式） */
  const lineKindOf = useCallback((line: string): BuildLogLine["kind"] => {
    if (/^\$ /.test(line)) return "cmd";
    if (/\[ERR\]|error:|fatal error/i.test(line)) return "err";
    if (/\[OK\]|success/i.test(line)) return "ok";
    if (/warning/i.test(line)) return "warn";
    return "info";
  }, []);

  /** S9：设备事件订阅（flash 进度/完成/失败 → 阶段 + 进度 + 串口遥测开始） */
  const subscribeDeviceEvents = useCallback(
    (projectId: string, onReconnect?: () => void) =>
      subscribeProjectEvents(projectId, {
        onReconnect,
        onEvent: (type, data) => {
          switch (type) {
            case "device.flashing": {
              const { percent } = data as { percent: number };
              dispatch({ type: "FLASH_PROGRESS", pct: percent });
              break;
            }
            case "device.flashed": {
              const { truth } = data as { truth?: DeviceTruthDto };
              dispatch({ type: "RUNTIME", patch: { deviceStage: "detected", deviceTruth: truth ?? null, serialStage: "disconnected", serialSession: null } });
              dispatch({ type: "COMPANION_STAGE", stage: "idle" });
              dispatch({ type: "COMPANION_TELEMETRY", flashProgress: 100 });
              dispatch({ type: "ARTIFACT", kind: "debug", status: "validated", version: (s.artifacts.debug.version || 0) + 1 });
              pushCopilot({
                sender: "copilot",
                text: truth?.executionReality === "companion"
                  ? "Companion flash complete — execution verified by the local companion; physical hardware is not verified. Telemetry source: companion."
                  : "Flash complete — execution truth recorded. Physical hardware verification is not asserted without physical evidence.",
              });
              break;
            }
            case "device.flash_failed": {
              const failure = data as { truth?: DeviceTruthDto; code?: string; message?: string };
              const { truth } = failure;
              dispatch({ type: "RUNTIME", patch: { deviceStage: "detected", deviceTruth: truth ?? null, serialStage: "disconnected", serialSession: null } });
              dispatch({ type: "COMPANION_STAGE", stage: "idle" });
              pushSystem(`Flash failed (${failure.code ?? "internal"}): ${failure.message ?? "no half-written evidence."}`);
              break;
            }
            default:
              break;
          }
        },
      }),
    [s.artifacts.debug.version, pushCopilot, pushSystem],
  );

  /** 串口遥测流订阅（EventSource /device/serial/stream → serial.line 帧） */
  const subscribeSerialStream = useCallback((projectId: string, sessionId: string) => {
    const es = new EventSource(`/api/v1/projects/${projectId}/device/serial/session/${sessionId}/events`);
    es.addEventListener("serial.line", (ev) => {
      try {
        const { line } = JSON.parse((ev as MessageEvent).data) as { line: string };
        dispatch({ type: "COMPANION_SERIAL", line });
      } catch {
        // 帧解析失败忽略
      }
    });
    es.addEventListener("serial.session.closed", () => {
      if (serialSessionRef.current?.projectId === projectId && serialSessionRef.current.sessionId === sessionId) serialSessionRef.current = null;
      dispatch({ type: "RUNTIME", patch: { serialStage: "disconnected", serialSession: null } });
      dispatch({ type: "COMPANION_TELEMETRY", moisture: null, temperature: null, pumpActive: false });
      dispatch({ type: "COMPANION_STAGE", stage: "idle" });
      es.close();
    });
    es.addEventListener("serial.session.error", (ev) => {
      let failure: { code?: string; message?: string } = {};
      try { failure = JSON.parse((ev as MessageEvent).data) as { code?: string; message?: string }; } catch { /* safe fallback */ }
      if (serialSessionRef.current?.projectId === projectId && serialSessionRef.current.sessionId === sessionId) serialSessionRef.current = null;
      dispatch({ type: "RUNTIME", patch: { serialStage: "error" } });
      dispatch({ type: "COMPANION_TELEMETRY", moisture: null, temperature: null, pumpActive: false });
      dispatch({ type: "COMPANION_STAGE", stage: "idle" });
      pushSystem(`Serial failed (${failure.code ?? "internal"}): ${failure.message ?? "Serial transport error"}`);
      es.close();
    });
    return () => es.close();
  }, [pushSystem]);

  /** S7：构建事件订阅（build.output 逐行 → 日志流；终态 → 徽标/状态） */
  const subscribeBuildEvents = useCallback(
    (projectId: string, onReconnect?: () => void) =>
      subscribeProjectEvents(projectId, {
        onReconnect,
        onEvent: (type, data) => {
          const event = data as { buildId?: unknown };
          const eventBuildId = typeof event.buildId === "string" ? event.buildId : null;
          if (!matchesBuildEvent(eventBuildId, buildRef.current.buildId)) return;
          switch (type) {
            case "build.output": {
              const { line } = data as { line: string };
              dispatch({ type: "BUILD_LOG", line: { kind: lineKindOf(line), text: line } });
              break;
            }
            case "build.succeeded": {
              dispatch({ type: "BUILD_STAGE", stage: "succeeded" });
              if (eventBuildId) void clientApi.getBuild(eventBuildId).then((build) => dispatch({
                type: "BUILD_EVIDENCE",
                verified: hasVerifiedFirmwareOutput(build),
              })).catch(() => dispatch({ type: "BUILD_EVIDENCE", verified: false }));
              dispatch({
                type: "ARTIFACT",
                kind: "build",
                status: "validated",
                version: (s.artifacts.build.version || 0) + 1,
              });
              break;
            }
            case "build.failed": {
              const failure = data as { code?: string; message?: string };
              dispatch({ type: "BUILD_STAGE", stage: "failed" });
              dispatch({ type: "ARTIFACT", kind: "build", status: "error", version: (s.artifacts.build.version || 0) + 1 });
              pushSystem(`Build failed (${failure.code ?? "build_failed"}): ${failure.message ?? "Firmware build failed"}`);
              break;
            }
            case "build.cancelled": {
              dispatch({ type: "BUILD_STAGE", stage: "cancelled" });
              break;
            }
            default:
              break;
          }
        },
      }),
    [lineKindOf, pushSystem, s.artifacts.build.version],
  );

  const createProject = useCallback(
    async (name?: string): Promise<boolean> => {
      const final = name?.trim() || (s.lang === "zh" ? "新建 MCU 项目" : "New MCU Project");
      try {
        const p = await clientApi.createProject(final); // Progressive Swap：真实 capability（ISSUE-001 §5）
        dispatch({ type: "CREATE_PROJECT", id: p.id, name: p.name });
        pushSystem(`Project "${p.name}" created.`);
        return true;
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Create failed: ${err.code}` : "Create failed");
        return false;
      }
    },
    [s.lang, pushSystem]
  );

  const hydrateProject = useCallback(async (id: string, signal?: AbortSignal): Promise<ProjectHydrationSnapshot | null> => {
    const sequence = ++hydrationSeq.current;
    try {
      const project = await clientApi.getProject(id, signal);
      if (!project) throw new ApiError(404, "not_found", "Project not found");
      const [artifacts, proposals, tasks, stale, device, toolchain] = await Promise.all([
        clientApi.listArtifacts(id, signal),
        clientApi.listProposals(id, signal),
        clientApi.listTasks(id, signal),
        clientApi.getStaleMarks(id, signal).catch(() => ({ marks: [] })),
        clientApi.getDeviceState(id, signal).catch(() => ({ lastDevice: null })),
        clientApi.checkToolchain(signal).catch(() => null),
      ]);
      if (signal?.aborted) return null;
      const hydratedArtifacts = await Promise.all(artifacts.map(async (artifact) => {
        const versions = await clientApi.listVersions(artifact.id, signal);
        const selected = (artifact.currentVersionId ? versions.find((version) => version.id === artifact.currentVersionId) : undefined) ?? versions.at(-1) ?? null;
        const detail = selected ? await clientApi.getVersion(selected.id, signal) : null;
        const builds = selected && artifact.kind === "firmware" ? await clientApi.getBuilds(selected.id, signal) : [];
        return { artifact, versions, version: selected, content: detail?.content ?? null, builds };
      }));
      if (signal?.aborted) return null;
      const snapshot: ProjectHydrationSnapshot = {
        project,
        artifacts: hydratedArtifacts,
        proposals,
        tasks,
        staleMarks: stale.marks.map((mark) => ({ kind: mark.kind, level: mark.level })),
        device,
      toolchain: { available: toolchain?.available ?? null },
      };
      if (sequence === hydrationSeq.current) dispatch({ type: "HYDRATE_PROJECT", snapshot });
      return snapshot;
    } catch {
      if (signal?.aborted) return null;
      if (sequence === hydrationSeq.current) dispatch({ type: "RUNTIME", patch: { online: false } });
      return null;
    }
  }, []);

  const reconnectHydration = useMemo(
    () => createReconnectHydrationRetry(async (id, signal) => (await hydrateProject(id, signal)) !== null),
    [hydrateProject],
  );

  useEffect(() => () => reconnectHydration.cancel(), [reconnectHydration]);

  const closeSerial = useCallback(async (): Promise<void> => {
    serialRef.current.close?.();
    serialRef.current.close = undefined;
    const active = serialSessionRef.current;
    serialSessionRef.current = null;
    if (active) {
      try { await clientApi.closeSerial(active.projectId, active.sessionId); } catch { /* already closed or server restarted */ }
    }
    dispatch({ type: "RUNTIME", patch: { serialStage: "disconnected", serialSession: null } });
    dispatch({ type: "COMPANION_TELEMETRY", moisture: null, temperature: null, pumpActive: false });
    dispatch({ type: "COMPANION_STAGE", stage: "idle" });
  }, []);

  const openProject = useCallback(async (id: string) => {
    reconnectHydration.cancel();
    await closeSerial();
    dispatch({ type: "OPEN_PROJECT", id, name: "" });
    const snapshot = await hydrateProject(id);
    if (!snapshot) return false;
    taskRef.current.close?.();
    taskRef.current.taskId = latestTask(snapshot.tasks, "analyze_requirement")?.id ?? "";
    taskRef.current.roundId = 0;
    taskRef.current.close = subscribeProjectEvents(id, {
      onEvent: (type, data) => analysisEventRef.current(id, type, data),
      onReconnect: () => reconnectHydration.request(id),
    });
    buildRef.current.close?.();
    buildRef.current.close = subscribeBuildEvents(id, () => reconnectHydration.request(id));
    deviceRef.current.close?.();
    deviceRef.current.close = subscribeDeviceEvents(id, () => reconnectHydration.request(id));
    // Subscribe first, then reconcile once so an event racing hydration cannot be lost.
    await hydrateProject(id);
    return true;
  }, [closeSerial, reconnectHydration, subscribeBuildEvents, subscribeDeviceEvents, hydrateProject]);

  /** 归档（D6 语义）：取一次性令牌 → 确认 → 归档（令牌一次性；S9 复用同一机制） */
  const archiveProject = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { token } = await clientApi.archiveToken(id);
        await clientApi.archiveProject(id, token);
        dispatch({ type: "DELETE_PROJECT", id });
        return true;
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Archive failed: ${err.code}` : "Archive failed");
        return false;
      }
    },
    [pushSystem]
  );

  const setNav = useCallback((n: NavigationTab) => dispatch({ type: "NAV", nav: n }), []);
  const setSidebar = useCallback((sb: SidebarTab) => dispatch({ type: "SIDEBAR", sidebar: sb }), []);

  // ---------- Discovery ----------

  const toCapability = (c: AnalysisCapabilityDto): DiscoveredRequirement => ({
    id: c.id,
    title: c.title,
    type: c.type,
    status: c.status,
    progress: c.progress,
    icon: c.icon,
    isWarning: c.isWarning,
    details: c.details,
  });

  const toProposalItem = (p: import("../api/client").ProposalDto): RequirementProposal => {
    let title = p.id;
    let initialIdea = "";
    let formalizedRequirement = "";
    try {
      const parsed = JSON.parse(p.payload) as { title?: string; initialIdea?: string; formalizedRequirement?: string };
      title = parsed.title ?? p.id;
      initialIdea = parsed.initialIdea ?? "";
      formalizedRequirement = parsed.formalizedRequirement ?? "";
    } catch {
      // payload 非 JSON 时退化为 id 展示
    }
    return {
      id: p.id,
      number: String(p.number).padStart(2, "0"),
      title,
      accepted: p.status === "accepted",
      initialIdea,
      formalizedRequirement,
      impacts: p.impacts,
      decision: p.status,
    };
  };

  const startDiscovery = useCallback(() => {
    if (s.runtime.online !== true) return;
    if (s.runtime.providerAvailable === false) return;
    const prompt = s.discoveryPrompt.trim();
    if (!prompt) return;
    const projectId = s.project?.id;
    if (!projectId) return;
    cancelRef.current.discovery = false;
    dispatch({ type: "DISC_CLEAR_RESULTS" });
    dispatch({ type: "DISC_SET_STAGE", stage: "analyzing" });

    const onEvent = (type: string, data: unknown) => {
      switch (type) {
        case "requirement.analysis.started": {
          dispatch({ type: "DISC_TASK_PATCH", patch: { status: "running" } });
          break;
        }
        case "requirement.analysis.progress": {
          const p = data as { stage: string; chunk?: string };
          if (p.stage === "streaming" && p.chunk) dispatch({ type: "DISC_STREAM", text: p.chunk });
          else if (p.stage === "capabilities" && p.chunk) {
            try {
              dispatch({ type: "DISC_CAPABILITY", cap: toCapability(JSON.parse(p.chunk) as AnalysisCapabilityDto) });
            } catch {
              // 解析失败忽略单卡（流式容错）
            }
          }
          break;
        }
        case "requirement.analysis.phase": {
          const p = data as { phase: "provider_waiting" | "provider_streaming" | "processing"; operation: "stream_text" | "generate_structured" | "application"; timestamp: string };
          dispatch({ type: "DISC_PHASE", phase: { phase: p.phase, operation: p.operation, timestamp: p.timestamp } });
          break;
        }
        case "requirement.analysis.clarification.requested": {
          const c = data as { roundId: number; question: string; detail?: string };
          taskRef.current.roundId = c.roundId;
          dispatch({ type: "DISC_PHASE", phase: null });
          dispatch({ type: "DISC_CLARIFICATION", c: { question: c.question, detail: c.detail ?? "", answer: "", answered: false } });
          dispatch({ type: "DISC_SET_STAGE", stage: "clarifying" });
          break;
        }
        case "requirement.analysis.completed": {
          dispatch({ type: "DISC_TASK_PATCH", patch: { status: "completed", completedAt: new Date().toISOString() } });
          dispatch({ type: "DISC_PHASE", phase: null });
          const d = data as { capabilities: AnalysisCapabilityDto[] };
          dispatch({
            type: "DISC_DONE",
            caps: d.capabilities.map(toCapability),
            props: [], // 提案随后经 GET /proposals 载入（S3B）
          });
          // S3B：分析完成后提案已由 create_proposal 落库 → 拉取渲染提案卡
          void (async () => {
            try {
              const proposals = await clientApi.listProposals(projectId);
              dispatch({
                type: "DISC_DONE",
                caps: d.capabilities.map(toCapability),
                props: proposals.map(toProposalItem),
              });
            } catch {
              // 提案拉取失败保持能力卡呈现
            }
          })();
          break;
        }
        case "requirement.analysis.failed": {
          const failure = data as { code?: string; message?: string; reason?: string };
          const error = toAppError(failure, "Analysis failed");
          dispatch({ type: "DISC_TASK_PATCH", patch: { status: "failed", completedAt: new Date().toISOString(), error } });
          dispatch({ type: "DISC_PHASE", phase: null });
          dispatch({ type: "DISC_ERROR", error });
          break;
        }
        case "requirement.analysis.cancelled": {
          dispatch({ type: "DISC_TASK_PATCH", patch: { status: "cancelled", completedAt: new Date().toISOString() } });
          dispatch({ type: "DISC_PHASE", phase: null });
          dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
          break;
        }
        case "provider.unavailable": {
          dispatch({ type: "RUNTIME", patch: { providerAvailable: false } });
          dispatch({ type: "DISC_ERROR", error: toAppError(data, "AI provider unavailable — check connection and retry.") });
          break;
        }
        default:
          break;
      }
    };

    reconnectHydration.cancel();
    taskRef.current.close?.();
    taskRef.current.close = subscribeProjectEvents(projectId, {
      onEvent,
      onReconnect: () => reconnectHydration.request(projectId),
    });

    void (async () => {
      try {
        const { taskId } = await clientApi.analyzeRequirement(projectId, prompt, {
          slow: s.runtime.slowMode,
          failNext: s.discovery.nextFails,
          partialNext: s.discovery.partialNext,
        });
        taskRef.current.taskId = taskId;
        dispatch({ type: "RUNTIME", patch: { online: true, providerAvailable: true } });
        const durableTask = await clientApi.getTask(taskId);
        dispatch({ type: "DISC_TASK", task: durableTask });
      } catch (err) {
          dispatch({ type: "DISC_ERROR", error: err instanceof ApiError ? toAppError(err) : "Analysis failed to start" });
      }
    })();
  }, [s.runtime.online, s.runtime.providerAvailable, s.runtime.slowMode, s.discoveryPrompt, s.discovery.nextFails, s.discovery.partialNext, s.project?.id, reconnectHydration]);

  const cancelDiscovery = useCallback(() => {
    cancelRef.current.discovery = true;
    dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
    dispatch({ type: "DISC_TASK_PATCH", patch: { status: "cancelled", completedAt: new Date().toISOString() } });
    pushSystem("Discovery cancelled — no artifacts were modified.");
    if (taskRef.current.taskId) {
      void clientApi.cancelTask(taskRef.current.taskId).catch(() => undefined);
    }
  }, [pushSystem]);

  const finishClarification = useCallback(
    (answer: string) => {
      cancelRef.current.discovery = false;
      dispatch({ type: "DISC_SET_STAGE", stage: "analyzing" });
      const { taskId, roundId } = taskRef.current;
      if (!taskId) return;
      void clientApi
        .submitClarification(taskId, roundId, answer?.trim() ? answer : undefined, !answer?.trim())
        .catch((err) =>
          dispatch({ type: "DISC_ERROR", error: err instanceof ApiError ? toAppError(err) : "Clarification failed" })
        );
    },
    []
  );

  const answerClarification = useCallback(
    (answer: string) => finishClarification(answer || '0.96" SSD1306'),
    [finishClarification]
  );

  const skipClarification = useCallback(() => finishClarification(""), [finishClarification]);

  const setProposalDecision = useCallback(
    (id: string, d: ProposalDecision) => {
      // Progressive Swap（ISSUE-004 §5）：内存决策 → 真实 resolve_proposal
      if (d === "pending") return; // 三态 UI 仅 accept/reject 走服务端；撤销=反向决策
      void (async () => {
        try {
          const decided = await clientApi.resolveProposal(id, d === "accepted" ? "accept" : "reject");
          dispatch({ type: "DISC_DECISION", id, decision: decided.status });
          const prop = s.discovery.proposals.find((p) => p.id === id);
          pushSystem(
            decided.status === "accepted"
              ? `Proposal #${prop?.number ?? ""} "${prop?.title ?? ""}" accepted into design.`
              : `Proposal #${prop?.number ?? ""} "${prop?.title ?? ""}" rejected — excluded from design.`
          );
          // S5B：接受提案解除该 artifact 的 Stale marks（stale-semantics §5）→ 刷新呈现
          const projectId = s.project?.id;
          if (projectId && decided.status === "accepted") await refreshStaleMarks(projectId);
        } catch (err) {
          pushSystem(
            err instanceof ApiError && err.code === "outdated_proposal"
              ? "Proposal is based on an outdated version — regenerate required."
              : err instanceof ApiError
              ? `Decision failed: ${err.code}`
              : "Decision failed"
          );
        }
      })();
    },
    [s.discovery.proposals, s.project?.id, refreshStaleMarks, pushSystem]
  );

  const proceedToHardware = useCallback(() => {
    const accepted = s.discovery.proposals.filter((p) => p.decision === "accepted");
    if (accepted.length === 0) return;
    const projectId = s.project?.id;
    if (!projectId) return;
    // Progressive Swap（ISSUE-004 §5）：内存版本 +1 → 真实 requirements 聚合提交（事务 T2）
    void (async () => {
      try {
        const { artifact, version } = await clientApi.commitRequirements(
          projectId,
          s.discovery.capabilities.map((c) => ({ id: c.id, title: c.title, status: c.status })),
        );
        dispatch({ type: "ARTIFACT", kind: "requirements", status: "accepted", version: version.versionNo });
        dispatch({ type: "SIDEBAR", sidebar: "Hardware" });
        pushSystem(
          `Requirements locked in (${accepted.length} proposals accepted). Requirements artifact v${version.versionNo} committed.`
        );
        void artifact;
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Requirements commit failed: ${err.code}` : "Requirements commit failed");
      }
    })();
  }, [s.discovery.proposals, s.discovery.capabilities, s.project?.id, pushSystem]);

  // ---------- Hardware ----------

  const refreshMcuCandidates = useCallback(async () => {
    const projectId = s.project?.id;
    if (!projectId) return;
    try {
      const { candidates, peripherals } = await clientApi.recommendMcu(projectId);
      dispatch({ type: "MCU_CANDIDATES", candidates, peripherals });
    } catch {
      // 候选拉取失败保持现有呈现
    }
  }, [s.project?.id]);

  const selectMcu = useCallback(
    (mcu: string) => {
      const projectId = s.project?.id;
      if (!projectId) return;
      if (mcu === s.selectedMcu) return;
      // Progressive Swap（ISSUE-005 §5）：内存版本 +1 → 真实 select_mcu（Hardware 版本落库）
      void (async () => {
        try {
          const { version, changed } = await clientApi.selectMcu(projectId, mcu);
          dispatch({ type: "SELECT_MCU", mcu });
          dispatch({ type: "ARTIFACT", kind: "hardware", status: "accepted", version: version.versionNo });
          // S5B：服务端事务内已写 stale marks（T1/T2 同事务）→ 拉取真实 marks 驱动侧栏/横幅/门禁
          await refreshStaleMarks(projectId);
          if (changed) {
            pushCopilot({
              sender: "copilot",
              text: `MCU changed to ${mcu} — downstream artifacts (pin map, wiring, firmware, build) are now stale. Revalidate before proceeding.`,
              warningNote: "Downstream Invalidated",
            });
          } else {
            pushCopilot({
              sender: "copilot",
              text: `${mcu} selected. Hardware artifact v${version.versionNo} committed. Ready for pin assignment.`,
            });
          }
        } catch (err) {
          pushSystem(err instanceof ApiError ? `Select MCU failed: ${err.code}` : "Select MCU failed");
        }
      })();
    },
    [s.project?.id, s.selectedMcu, refreshStaleMarks, pushCopilot, pushSystem]
  );

  // ---------- Wiring ----------

  const generatePins = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    dispatch({ type: "WIRING_STAGE", stage: "generating" });
    // Progressive Swap（ISSUE-006 §5）：内存分配 → 真实 generate_pin_map（constraint-engine 求值）
    void (async () => {
      try {
        const result = await clientApi.generatePinMap(projectId);
        dispatch({
          type: "WIRING_GENERATED",
          pins: result.pinMap.map((p) => ({
            component: p.component,
            pinId: p.pinId,
            type: p.type as PinMapping["type"],
            colorDot: p.type === "I2C" ? "#a855f7" : p.type === "Analog" ? "#3b82f6" : "#ef4444",
          })),
          issues: result.issues.map((i) => ({
            code: i.code,
            pinId: i.pinId,
            severity: i.severity,
            title: i.title,
            detail: i.detail,
            ...(i.blocksClaim ? { blocksClaim: true } : {}),
            ...(i.componentId ? { componentId: i.componentId } : {}),
            ...(i.pendingReason ? { pendingReason: i.pendingReason } : {}),
            ...(i.source ? { source: i.source } : {}),
          })),
        });
        dispatch({
          type: "ARTIFACT",
          kind: "pinmap",
          status: result.issues.length ? "warning" : "accepted",
          version: result.version.versionNo,
        });
        dispatch({ type: "PINMAP_VERSIONS", versions: [] }); // 刷新历史由列表接口承担
        // S5B：重生成（v2+）→ 服务端已打下游 marks → 拉取真实 marks
        await refreshStaleMarks(projectId);
        if (result.issues.length) {
          dispatch({ type: "ARTIFACT", kind: "wiring", status: "draft", version: 0 });
          pushCopilot({
            sender: "copilot",
            text: `Pin assignment generated: ${result.pinMap.length} mappings. ⚠️ Strapping pin conflict detected on IO12 (pump relay). I can propose a remap during firmware generation.`,
            warningNote: "Strapping Pin Conflict",
          });
        } else {
          pushCopilot({ sender: "copilot", text: `Pin assignment generated for ${s.selectedMcu}: ${result.pinMap.length} mappings, no conflicts.` });
        }
      } catch (err) {
        dispatch({ type: "WIRING_STAGE", stage: "error" });
        pushSystem(err instanceof ApiError ? `Pin map failed: ${err.code}` : "Pin map failed");
      }
    })();
  }, [s.project?.id, s.selectedMcu, refreshStaleMarks, pushCopilot, pushSystem]);

  const verifyRules = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    // Progressive Swap（ISSUE-006 §5）：内存提示 → 真实 validate_wiring（ValidationRecord 落库；I-7 未运行≠通过）
    void (async () => {
      try {
        const pinmap = await clientApi.ensureArtifact(projectId, "pinmap");
        const versions = await clientApi.listVersions(pinmap.id);
        const current = versions[versions.length - 1];
        if (!current) return;
        const record = await clientApi.validateWiring(current.id);
        const issues = record.diagnostics.map((d) => ({
          code: d.code,
          pinId: String(d.details?.pin ?? (Array.isArray(d.details?.pins) ? d.details?.pins.join("/") : "—")),
          severity: d.severity === "error" ? "error" as const : "warning" as const,
          title: d.code === "COMPONENT_IDENTITY_PENDING" ? "Component identity pending" : d.code === "HARDWARE_IDENTITY_PENDING" ? "Reference Kit identity pending" : d.code === "STRAPPING_PIN_USAGE" ? "Strapping pin conflict" : "Wiring constraint",
          detail: d.message,
          ...(d.details?.component_id ? { componentId: String(d.details.component_id) } : {}),
          ...(d.details?.pending_reason ? { pendingReason: String(d.details.pending_reason), blocksClaim: true } : {}),
          ...(d.code === "HARDWARE_IDENTITY_PENDING" ? { blocksClaim: true } : {}),
          ...(d.source ? { source: d.source } : {}),
        }));
        dispatch({ type: "WIRING_VERIFIED", verified: record.result === "pass", issues });
        dispatch({ type: "ARTIFACT", kind: "wiring", status: record.result === "pass" ? "validated" : "warning", version: (s.artifacts.wiring.version || 0) + 1 });
        dispatch({ type: "ARTIFACT", kind: "validation", status: "validated", version: (s.artifacts.validation.version || 0) + 1 });
        pushCopilot({
          sender: "copilot",
          text: issues.length
            ? `Rules verification complete: ${issues.length} issue(s) found. Pending identity and electrical warnings remain visible.`
            : "Rules verification complete: all electrical rules passed.",
        });
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Verification failed: ${err.code}` : "Verification failed");
      }
    })();
  }, [s.project?.id, s.artifacts.wiring, s.artifacts.validation, pushCopilot, pushSystem]);

  const refreshPinmapVersions = useCallback(async () => {
    const projectId = s.project?.id;
    if (!projectId) return;
    try {
      const artifact = await clientApi.ensureArtifact(projectId, "pinmap");
      const versions = await clientApi.listVersions(artifact.id);
      dispatch({
        type: "PINMAP_VERSIONS",
        versions: versions.map((v) => ({
          id: v.id,
          versionNo: v.versionNo,
          status: v.status,
          sourceKind: v.sourceKind,
          createdAt: v.createdAt,
        })),
      });
    } catch {
      // 版本历史查询失败不打断视图（transport 错误由下一提交呈现）
    }
  }, [s.project?.id]);

  const editPin = useCallback(
    (component: string, pinId: string) => {
      // Progressive Swap（ISSUE-002 §5）：内存版本 +1 → 真实 commit_manual_edit
      // 手动编辑免 Proposal（I-11）；内容 = 编辑后的 pinMappings（S5A 前引脚数据仍为 Mock 来源，
      // 但版本提交走真实 capability：SQLite 版本行 + Workspace 内容文件）
      const oldPin = s.wiring.pinMappings.find((p) => p.component === component)?.pinId ?? "";
      dispatch({ type: "PIN_EDITED", component, oldPin, pinId });
      const nextMappings = s.wiring.pinMappings.map((p) =>
        p.component === component ? { ...p, pinId } : p
      );
      void (async () => {
        const projectId = s.project?.id;
        if (!projectId) return;
        try {
          const artifact = await clientApi.ensureArtifact(projectId, "pinmap");
          const versions = await clientApi.listVersions(artifact.id);
          const current = versions[versions.length - 1];
          let nextContent: Record<string, unknown> = { pinMap: nextMappings, issues: s.wiring.issues };
          if (current) {
            const detail = await clientApi.getVersion(current.id);
            const existing = contentObject(detail.content);
            const existingIssues = Array.isArray(existing.issues)
              ? existing.issues.map(parsePinIssue).filter((issue): issue is PinIssue => issue !== null)
              : s.wiring.issues;
            const nextIssues = existingIssues.flatMap((issue) => {
              if (issue.pinId !== oldPin) return [issue];
              if (issue.code === "STRAPPING_PIN_USAGE") return [];
              return [{ ...issue, pinId }];
            });
            nextContent = { ...existing, pinMap: nextMappings, issues: nextIssues };
          }
          const version = await clientApi.commitVersion(artifact.id, JSON.stringify(nextContent, null, 2));
          dispatch({ type: "ARTIFACT", kind: "pinmap", status: "accepted", version: version.versionNo });
          pushSystem(`Manual pin edit committed: ${component} → ${pinId}. Pin Map v${version.versionNo}.`);
          // S5B：手动编辑仍触发依赖求值（D4）→ 拉取真实 marks
          void refreshStaleMarks(projectId);
          void refreshPinmapVersions();
        } catch (err) {
          pushSystem(err instanceof ApiError ? `Commit failed: ${err.code}` : "Commit failed");
        }
      })();
    },
    [s.project?.id, s.wiring.pinMappings, s.wiring.issues, refreshStaleMarks, refreshPinmapVersions, pushSystem]
  );

  // ---------- Firmware（S6：真实 generate_firmware_proposal + resolve_proposal） ----------

  const generateFirmware = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    dispatch({ type: "FW_GENERATING" });
    // Progressive Swap（ISSUE-008 §5）：UI 模板/内存提案 → 真实 generate_firmware（只产出 Proposal，I-1）
    void (async () => {
      try {
        const { proposal } = await clientApi.generateFirmware(projectId);
        const diff = (proposal.diff ?? {}) as { oldPin?: string; newPin?: string; bootRisk?: boolean };
        const files = JSON.parse(proposal.payload) as { "src/main.cpp": string };
        const bootRisk = diff.bootRisk === true;
        const oldPin = diff.oldPin ?? "IO12";
        const newPin = diff.newPin ?? "IO21";
        const versionFrom = s.firmware.version || 0;
        dispatch({
          type: "FW_PROPOSAL",
          p: {
            id: proposal.id,
            title: bootRisk ? "Resolve GPIO Boot Conflict" : "Firmware Generation Review",
            status: "pending",
            bootRisk,
            file: "src/main.cpp",
            oldPin,
            newPin,
            oldCode: files["src/main.cpp"],
            newCode: files["src/main.cpp"],
            riskTitle: `Boot Issue Risk (${oldPin})`,
            riskDetail:
              "IO12 is an ESP32-S3 strapping pin. Pulling it high at reset forces 1.8V flash LDO configuration, potentially causing boot loops.",
            impacts: proposal.impacts,
            versionFrom,
            versionTo: versionFrom + 1,
          },
        });
        dispatch({ type: "FW_CODE", code: files["src/main.cpp"], version: versionFrom });
        pushCopilot({
          sender: "copilot",
          text: bootRisk
            ? `Firmware generated. I found a boot risk: pump relay on ${oldPin} (strapping pin). Proposal: remap to ${newPin}. Review the diff.`
            : `Firmware generated from the current design (relay on ${newPin}, no boot risk). Review and accept to commit v${versionFrom + 1}.`,
          warningNote: bootRisk ? "Boot Conflict" : undefined,
          proposalCard: bootRisk
            ? {
                issueTitle: "Strapping Pin Conflict",
                description: `Remap Pump Relay from ${oldPin} to ${newPin}`,
                suggestedFix: "Update src/main.cpp and Wiring Diagram",
              }
            : undefined,
        });
      } catch (err) {
        dispatch({ type: "FW_RESET" });
        pushSystem(err instanceof ApiError ? `Firmware generation failed: ${err.code}` : "Firmware generation failed");
      }
    })();
  }, [s.project?.id, s.firmware.version, pushCopilot, pushSystem]);

  const acceptFirmwareProposal = useCallback(() => {
    const p = s.firmware.proposal;
    const projectId = s.project?.id;
    if (!p || !projectId) return;
    // Progressive Swap（ISSUE-008 §5）：内存接受 → 真实 resolve_proposal（T2：写文件 + 联动版本）
    void (async () => {
      try {
        await clientApi.resolveProposal(p.id, "accept");
        dispatch({ type: "FW_ACCEPTED" });
        dispatch({ type: "ARTIFACT", kind: "firmware", status: "accepted", version: p.versionTo });
        dispatch({ type: "ARTIFACT", kind: "wiring", status: "accepted", version: (s.artifacts.wiring.version || 0) + 1 });
        dispatch({ type: "ARTIFACT", kind: "pinmap", status: "accepted", version: (s.artifacts.pinmap.version || 0) + 1 });
        // 联动版本已由服务端 T2 落库 → 刷新 marks/历史（接受本身解除 stale）
        await refreshStaleMarks(projectId);
        void refreshPinmapVersions();
        pushCopilot({
          sender: "copilot",
          text: `Proposal accepted! Pump Relay remapped ${p.oldPin} → ${p.newPin}. Firmware v${p.versionTo} committed. Wiring Diagram updated.`,
        });
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Accept failed: ${err.code}` : "Accept failed");
      }
    })();
  }, [s.firmware.proposal, s.project?.id, s.artifacts.wiring, s.artifacts.pinmap, refreshStaleMarks, refreshPinmapVersions, pushCopilot, pushSystem]);

  const rejectFirmwareProposal = useCallback(() => {
    const p = s.firmware.proposal;
    const projectId = s.project?.id;
    if (!p || !projectId) return;
    void (async () => {
      try {
        await clientApi.resolveProposal(p.id, "reject");
        dispatch({ type: "FW_REJECTED" });
        dispatch({ type: "ARTIFACT", kind: "firmware", status: "warning", version: p.versionFrom });
        pushCopilot({
          sender: "copilot",
          text: `Proposal rejected. Firmware v${p.versionFrom} kept with ${p.oldPin} (strapping risk remains — build may still succeed but boot behavior is not guaranteed).`,
          warningNote: "Risk accepted by user",
        });
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Reject failed: ${err.code}` : "Reject failed");
      }
    })();
  }, [s.firmware.proposal, s.project?.id, pushCopilot, pushSystem]);

  // ---------- Build ----------

  const startBuild = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    if (!s.runtime.toolchainAvailable) return;
    const firmwareOk = s.artifacts.firmware.version > 0 && s.artifacts.firmware.status !== "stale";
    if (!firmwareOk) return; // Stale 拦截（视图层提示）
    cancelRef.current.build = false;
    dispatch({ type: "BUILD_LOGS", logs: [] });
    dispatch({ type: "BUILD_ID", buildId: null });
    dispatch({ type: "BUILD_STAGE", stage: "building" });
    // Progressive Swap（ISSUE-009 §5）：内存日志脚本 → 真实 run_build（CompilerPort + BuildRecord）
    void (async () => {
      try {
        const fw = await clientApi.ensureArtifact(projectId, "firmware");
        const versions = await clientApi.listVersions(fw.id);
        const current = versions[versions.length - 1];
        if (!current) {
          throw new ApiError(409, "no_firmware_version", "No firmware version to build");
        }
        const { buildId } = await clientApi.runBuild(projectId, current.id);
        buildRef.current.buildId = buildId;
        dispatch({ type: "BUILD_ID", buildId });
        // 日志流/终态由 SSE build.* 事件驱动（subscribeBuildEvents）
      } catch (err) {
        dispatch({ type: "BUILD_STAGE", stage: "failed" });
        dispatch({
          type: "BUILD_LOG",
          line: { kind: "err", text: err instanceof ApiError ? `Build failed: ${err.code}` : "Build failed" },
        });
        pushSystem(err instanceof ApiError ? `Build failed: ${err.code}` : "Build failed");
        if (err instanceof ApiError && err.code === "toolchain_unavailable") {
          void checkToolchain(); // 工具链横幅 + 重检测
        }
      }
    })();
  }, [s.project?.id, s.runtime.toolchainAvailable, s.artifacts.firmware, checkToolchain, pushSystem]);

  const cancelBuild = useCallback(() => {
    const buildId = buildRef.current.buildId;
    if (!buildId) return;
    cancelRef.current.build = true;
    void clientApi.cancelBuild(buildId).catch((err) => {
      pushSystem(err instanceof ApiError ? `Cancel failed: ${err.code}` : "Cancel failed");
    });
    // 终态由 SSE build.cancelled 驱动；先本地置 cancelled 保证即时反馈
    dispatch({ type: "BUILD_STAGE", stage: "cancelled" });
    pushSystem("Build cancelled — no half-written build artifact.");
  }, [pushSystem]);

  const retryBuild = useCallback(() => startBuild(), [startBuild]);

  const runDiagnosis = useCallback(() => {
    const buildId = buildRef.current.buildId;
    if (!buildId) return;
    // Progressive Swap（ISSUE-010 §5）：UI 预置诊断 → 真实 diagnose_build（AI mock → 诊断 + build_fix 提案）
    void (async () => {
      try {
        const { diagnosis } = await clientApi.diagnoseBuild(buildId);
        dispatch({ type: "DIAGNOSIS", d: diagnosis });
        pushCopilot({
          sender: "copilot",
          text: "Diagnosis complete: missing library dependency `Adafruit_SSD1306`. I'll propose adding it to platformio.ini.",
        });
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Diagnosis failed: ${err.code}` : "Diagnosis failed");
      }
    })();
  }, [pushCopilot, pushSystem]);

  const applyFix = useCallback(() => {
    // Progressive Swap（ISSUE-010 §5）：内存标志 → 真实 resolve_proposal（build_fix accept → 新固件版本）
    const proposalId = s.build.diagnosis?.proposal?.proposalId;
    const projectId = s.project?.id;
    if (!proposalId || !projectId) return;
    void (async () => {
      try {
        await clientApi.resolveProposal(proposalId, "accept");
        dispatch({ type: "BUILD_FIX_APPLIED" });
        dispatch({ type: "ARTIFACT", kind: "firmware", status: "accepted", version: (s.artifacts.firmware.version || 0) + 1 });
        await refreshStaleMarks(projectId);
        pushSystem("Fix proposal applied: lib_deps added to platformio.ini (Firmware v+1). Rebuild to verify.");
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Apply fix failed: ${err.code}` : "Apply fix failed");
      }
    })();
  }, [s.build.diagnosis, s.project?.id, s.artifacts.firmware.version, refreshStaleMarks, pushSystem]);

  // ---------- Companion（S9：真实 DevicePort——检测/烧录/串口） ----------

  const detectBoard = useCallback(() => {
    void closeSerial();
    dispatch({ type: "COMPANION_STAGE", stage: "detecting" });
    // Progressive Swap（ISSUE-011 §5）：内存模拟 → 真实 /device/detect（DevicePort 检测 + last_device → preferences）
    void (async () => {
      try {
        const device = await clientApi.detectDevice();
        dispatch({ type: "RUNTIME", patch: { deviceStage: "detected", deviceId: device.id, deviceTruth: device.truth, serialStage: "disconnected", serialSession: null } });
        dispatch({ type: "COMPANION_STAGE", stage: "idle" });
          pushCopilot({
            sender: "copilot",
            text: device.truth.executionReality === "companion"
              ? `Board detected through companion-local: ${device.model} on ${device.port} @ ${device.baudRate} baud. Physical hardware is not verified.`
              : `Board detected: ${device.model} on ${device.port} @ ${device.baudRate} baud.`,
          });
      } catch (err) {
        dispatch({ type: "COMPANION_STAGE", stage: "idle" });
        pushSystem(err instanceof ApiError ? `Detect failed: ${err.code}` : "Detect failed");
      }
    })();
  }, [closeSerial, pushCopilot, pushSystem]);

  const openSerial = useCallback(() => {
    const projectId = s.project?.id;
    const deviceId = s.runtime.deviceId;
    if (!projectId || !deviceId || (s.runtime.deviceStage !== "detected" && s.runtime.deviceStage !== "connected")) return;
    void (async () => {
      try {
        await closeSerial();
        dispatch({ type: "RUNTIME", patch: { serialStage: "opening" } });
        const serial = await clientApi.openSerial(projectId, deviceId);
        serialSessionRef.current = { projectId, sessionId: serial.sessionId };
        dispatch({ type: "RUNTIME", patch: { serialStage: "connected", serialSession: serial } });
        dispatch({ type: "COMPANION_STAGE", stage: "serial" });
        serialRef.current.close = subscribeSerialStream(projectId, serial.sessionId);
      } catch (err) {
        dispatch({ type: "RUNTIME", patch: { serialStage: "error", serialSession: null } });
        pushSystem(err instanceof ApiError ? `Serial open failed: ${err.code}` : "Serial open failed");
      }
    })();
  }, [closeSerial, pushSystem, s.project?.id, s.runtime.deviceId, s.runtime.deviceStage, subscribeSerialStream]);

  const flashDevice = useCallback(
    (token?: string) => {
      if (s.runtime.deviceStage !== "detected" && s.runtime.deviceStage !== "connected") return;
      const projectId = s.project?.id;
      if (!projectId || !token) return; // 无令牌不执行（Safety Tier 0：AI/Companion/重试不得绕过）
      cancelRef.current.flash = false;
      dispatch({ type: "RUNTIME", patch: { deviceStage: "flashing" } });
      dispatch({ type: "COMPANION_STAGE", stage: "flashing" });
      // Progressive Swap（ISSUE-011 §5）：内存进度 → 真实 /device/flash（一次性令牌 + L3 门禁；进度由 SSE 驱动）
      void (async () => {
        try {
          const fw = await clientApi.ensureArtifact(projectId, "firmware");
          const versions = await clientApi.listVersions(fw.id);
          const current = versions[versions.length - 1];
          if (!current) throw new ApiError(409, "no_firmware_version", "No firmware version");
          if (!s.build.buildId || !s.build.outputVerified) throw new ApiError(409, "flash_build_not_verified", "No verified build selected");
          const deviceId = s.runtime.deviceId;
          const executionReality = s.runtime.deviceTruth?.executionReality;
          if (!deviceId || !executionReality || (executionReality !== "companion" && executionReality !== "physical")) {
            throw new ApiError(409, "device_disconnected", "No currently detected device is bound to the flash operation");
          }
          await clientApi.flashDevice({ projectId, deviceId, confirmationToken: token, buildId: s.build.buildId, artifactVersionId: current.id, executionReality });
          // 完成态由 SSE device.flashed 驱动（见 subscribeDeviceEvents）
        } catch (err) {
          dispatch({ type: "RUNTIME", patch: { deviceStage: "detected" } });
          dispatch({ type: "COMPANION_STAGE", stage: "idle" });
          pushSystem(err instanceof ApiError ? `Flash failed: ${err.code}` : "Flash failed");
        }
      })();
    },
    [s.runtime.deviceStage, s.runtime.deviceId, s.runtime.deviceTruth, s.project?.id, s.build.buildId, s.build.outputVerified, pushSystem],
  );

  /** 烧录确认（高风险对话框确认后）：签发一次性令牌 → 真实 flash（Safety Tier 0：令牌来自用户动作） */
  const flashWithConfirmation = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    if (s.runtime.deviceStage !== "detected" && s.runtime.deviceStage !== "connected") return;
    if (!s.build.outputVerified) return;
    void (async () => {
      try {
        if (!s.runtime.deviceId) return;
        const { token } = await clientApi.issueFlashToken(s.runtime.deviceId);
        flashDevice(token);
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Flash token failed: ${err.code}` : "Flash token failed");
      }
    })();
  }, [s.project?.id, s.runtime.deviceStage, s.runtime.deviceId, s.build.outputVerified, flashDevice, pushSystem]);

  const sendSerial = useCallback(
    (cmd: string) => {
      // Session-scoped serial write; no command is accepted without an active session.
      void (async () => {
        try {
          const projectId = s.project?.id;
          const serial = s.runtime.serialSession;
          if (!projectId || !serial || s.runtime.serialStage !== "connected") throw new ApiError(409, "serial_session_not_open", "Serial session is not open");
          const { echo, response, truth } = await clientApi.sendSerial(projectId, serial.sessionId, cmd);
          dispatch({ type: "RUNTIME", patch: { deviceTruth: truth } });
          dispatch({ type: "COMPANION_SERIAL", line: echo });
          if (response) dispatch({ type: "COMPANION_SERIAL", line: response });
        } catch (err) {
          pushSystem(err instanceof ApiError ? `Serial failed: ${err.code}` : "Serial failed");
        }
      })();
    },
    [pushSystem, s.project?.id, s.runtime.serialSession, s.runtime.serialStage],
  );

  const simulateMoisture = useCallback((v: number) => {
    dispatch({ type: "COMPANION_TELEMETRY", moisture: v });
  }, []);

  const togglePump = useCallback(() => {
    dispatch({ type: "COMPANION_TELEMETRY", pumpActive: !s.companion.pumpActive });
  }, [s.companion.pumpActive]);

  // ---------- Stale 重新验证（S5B：真实 stale-marks + revalidate_artifact） ----------

  const revalidateAll = useCallback(() => {
    const projectId = s.project?.id;
    if (!projectId) return;
    // Progressive Swap（ISSUE-007 §5）：内存链式重置 → 真实 revalidate_artifact（逐项重算，D1 不自动接受）
    dispatch({ type: "REVAL_RUNNING", running: true });
    void (async () => {
      try {
        const { results } = await clientApi.revalidateArtifact(projectId);
        const created = results.filter((r) => r.outcome === "proposal_created" && r.proposalId);
        const failed = results.filter((r) => r.outcome === "error");
        if (created.length) {
          dispatch({
            type: "REVAL_PROPOSALS",
            proposals: created.map((r) => ({
              proposalId: r.proposalId!,
              kind: r.kind as ArtifactKind,
            })),
          });
        }
        await refreshStaleMarks(projectId);
        if (created.length) {
          pushCopilot({
            sender: "copilot",
            text: `Revalidation: ${created.map((r) => r.kind).join(", ")} has semantic changes — proposal(s) created, awaiting your decision (no auto-accept).`,
            warningNote: "Proposal Required",
          });
        } else if (failed.length) {
          pushCopilot({
            sender: "copilot",
            text: `Revalidation: ${failed.map((r) => r.kind).join(", ")} failed to recompute — retryable.`,
            warningNote: "Recompute Failed",
          });
        } else {
          pushCopilot({ sender: "copilot", text: "Revalidation complete — all downstream artifacts are up to date." });
        }
      } catch (err) {
        pushSystem(err instanceof ApiError ? `Revalidate failed: ${err.code}` : "Revalidate failed");
      } finally {
        dispatch({ type: "REVAL_RUNNING", running: false });
      }
    })();
  }, [s.project?.id, refreshStaleMarks, pushCopilot, pushSystem]);

  const decideRevalidateProposal = useCallback(
    (proposalId: string, decision: "accept" | "reject") => {
      const projectId = s.project?.id;
      if (!projectId) return;
      void (async () => {
        try {
          await clientApi.resolveProposal(proposalId, decision);
          dispatch({ type: "REVAL_REMOVE_PROPOSAL", proposalId });
          await refreshStaleMarks(projectId);
          pushSystem(
            decision === "accept"
              ? "Revalidation proposal accepted — stale mark cleared, downstream continues."
              : "Revalidation proposal rejected — stale remains (recompute or decide later).",
          );
        } catch (err) {
          pushSystem(err instanceof ApiError ? `Decision failed: ${err.code}` : "Decision failed");
        }
      })();
    },
    [s.project?.id, refreshStaleMarks, pushSystem],
  );

  // ---------- Copilot 对话（脚本回复） ----------

  const sendCopilotMessage = useCallback(
    (text: string) => {
      dispatch({ type: "COPILOT_PUSH", msg: { id: nextId("usr"), sender: "user", text } });
      const lower = text.toLowerCase();
      let reply: string;
      if (lower.includes("pin") || lower.includes("relay") || lower.includes("12")) {
        reply = "Pin IO12 is a **strapping pin** on ESP32-S3. If pulled high during reset, it can cause boot mode conflicts. I recommend remapping the Pump Relay to **IO21** or **IO5** instead. There's a pending proposal in the Firmware tab — review the diff.";
      } else if (lower.includes("oled") || lower.includes("display")) {
        reply = "For the 0.96\" OLED display, SSD1306 over I2C is recommended. Connect SDA to **IO8** and SCL to **IO9** with 4.7kΩ pull-up resistors.";
      } else if (lower.includes("code") || lower.includes("firmware") || lower.includes("gpio")) {
        reply = "Firmware generation is complete. I detected a GPIO boot conflict and proposed a remap (IO12 → IO21). Accept the change in the Firmware tab to commit a new version.";
      } else if (lower.includes("build") || lower.includes("error")) {
        reply = s.build.stage === "failed"
          ? "The build failed on a missing dependency: `Adafruit_SSD1306.h`. I can propose adding the library to platformio.ini — press 'Ask Copilot to diagnose' for a full analysis."
          : "The last build status comes from the durable build record; verified firmware output is required before flashing.";
      } else if (lower.includes("stale") || lower.includes("outdated")) {
        reply = "Stale artifacts are marked in the sidebar and each affected view. Run 'Revalidate All' to regenerate them from the latest upstream artifacts — your previous decisions are re-applied.";
      } else if (lower.includes("who") || lower.includes("what") || lower.includes("help")) {
        reply = "I'm Project Copilot — I monitor your artifacts, pin conflicts, strapping-pin boot risks, and firmware logic. Ask me about pins, wiring, firmware, or build errors.";
      } else {
        reply = `Current context: ${s.project?.name ?? "no project"} · ${s.selectedMcu || "no MCU selected"} · firmware v${s.firmware.version || "—"} · build ${s.build.stage}. Everything looks optimal for ESP32-S3 execution.`;
      }
      void copilotStream(reply);
    },
    [s.project?.name, s.selectedMcu, s.firmware.version, s.build.stage, copilotStream]
  );

  // ---------- State Lab 场景 ----------

  const runScenario = useCallback(
    (id: string) => {
      const r = s.runtime;
      switch (id) {
        case "reset":
          void createProject(s.lang === "zh" ? "温室监测器" : "Greenhouse Monitor"); // 真实 capability（Lab 场景复用）
          break;
        case "offline": dispatch({ type: "RUNTIME", patch: { online: false } }); break;
        case "online": dispatch({ type: "RUNTIME", patch: { online: true } }); break;
        case "provider": dispatch({ type: "RUNTIME", patch: { providerAvailable: false } }); break;
        case "providerOk": dispatch({ type: "RUNTIME", patch: { providerAvailable: true } }); break;
        case "toolchain": dispatch({ type: "RUNTIME", patch: { toolchainAvailable: false } }); break;
        case "toolchainOk": dispatch({ type: "RUNTIME", patch: { toolchainAvailable: true } }); break;
        case "deviceDown": dispatch({ type: "RUNTIME", patch: { deviceStage: "disconnected", deviceId: null } }); break;
        case "deviceUp": dispatch({ type: "RUNTIME", patch: { deviceStage: "connected" } }); break;
        case "buildFail": dispatch({ type: "BUILD_NEXT_FAIL", v: true }); break;
        case "buildOk": dispatch({ type: "BUILD_NEXT_FAIL", v: false }); break;
        case "discFail": dispatch({ type: "DISC_NEXT_FAIL", v: true }); break;
        case "discOk": dispatch({ type: "DISC_NEXT_FAIL", v: false }); break;
        case "slow": dispatch({ type: "RUNTIME", patch: { slowMode: !r.slowMode } }); break;
        case "stale": {
          // S5B：强制下游过期 = 真实上游变更（select_mcu 切换 → 事务内依赖求值 → 真实 L3 marks；门禁再次生效）
          if (!s.selectedMcu) {
            pushSystem("Lab: select an MCU first — stale scenario needs a downstream chain.");
            break;
          }
          const toggle = s.selectedMcu === "RP2040" ? "ESP32-S3" : "RP2040";
          selectMcu(toggle);
          pushSystem(`Lab: downstream forced stale via MCU change → ${toggle}.`);
          break;
        }
        case "partial": dispatch({ type: "DISC_PARTIAL", v: true }); break;
        case "partialOk": dispatch({ type: "DISC_PARTIAL", v: false }); break;
      }
    },
    [s.runtime, s.lang, s.selectedMcu, selectMcu, pushSystem, createProject]
  );

  const api = useMemo<AppApi>(
    () => ({
      state: s,
      dispatch,
      createProject,
      openProject,
      archiveProject,
      setNav,
      setSidebar,
      editPin,
      refreshPinmapVersions,
      startDiscovery,
      cancelDiscovery,
      answerClarification,
      skipClarification,
      setProposalDecision,
      proceedToHardware,
      selectMcu,
      refreshMcuCandidates,
      generatePins,
      verifyRules,
      generateFirmware,
      acceptFirmwareProposal,
      rejectFirmwareProposal,
      startBuild,
      cancelBuild,
      retryBuild,
      runDiagnosis,
      applyFix,
      detectBoard,
      openSerial,
      closeSerial,
      sendSerial,
      simulateMoisture,
      togglePump,
      flashDevice,
      flashWithConfirmation,
      revalidateAll,
      checkToolchain,
      decideRevalidateProposal,
      sendCopilotMessage,
      runScenario,
    }),
    [
      s, createProject, openProject, archiveProject, setNav, setSidebar,
      startDiscovery, cancelDiscovery, answerClarification, skipClarification,
      setProposalDecision, proceedToHardware, selectMcu, refreshMcuCandidates, generatePins, verifyRules,
      editPin, refreshPinmapVersions, generateFirmware, acceptFirmwareProposal, rejectFirmwareProposal,
      startBuild, cancelBuild, retryBuild, runDiagnosis, applyFix, detectBoard,
      openSerial, closeSerial, sendSerial, simulateMoisture, togglePump, flashDevice, flashWithConfirmation, revalidateAll, checkToolchain, decideRevalidateProposal,
      sendCopilotMessage, runScenario,
    ]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export { format };
