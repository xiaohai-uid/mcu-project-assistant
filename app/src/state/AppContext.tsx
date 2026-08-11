// ============================================================
// AppContext — Mock 应用状态容器
// reducer + 异步动作（编排 mock/engine 脚本）+ State Lab 场景
// ============================================================
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  AppState,
  ArtifactKind,
  ArtifactState,
  BuildLogLine,
  CopilotChatMessage,
  Language,
  NavigationTab,
  ProposalDecision,
  SidebarTab,
  ThemeMode,
} from "../types";
import {
  autoAssignPins,
  buildFirmwareCode,
  BUILD_DIAGNOSIS,
  DEFAULT_PROMPT,
  finishDiscoveryAfterClarification,
  makeFirmwareProposal,
  makeSerialLine,
  MCU_CANDIDATES,
  PERIPHERALS,
  runBuildScript,
  runDiscoveryScript,
  sleep,
} from "../mock/engine";
import { format, getInitialLanguage, getInitialTheme } from "../lib/i18n";
import { api as clientApi, ApiError } from "../api/client";

// ---------- 初始状态 ----------

const DOWNSTREAM: Record<string, ArtifactKind[]> = {
  hardware: ["pinmap", "wiring", "firmware", "build"],
  requirements: ["hardware", "pinmap", "wiring", "firmware", "build"],
  pinmap: ["wiring", "firmware", "build"],
  wiring: ["firmware", "build"],
  firmware: ["build"],
};

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
    discoveryPrompt: DEFAULT_PROMPT,
    discovery: {
      stage: "idle",
      capabilities: [],
      proposals: [],
      clarification: null,
      error: null,
      streamedText: "",
      nextFails: false,
      partialNext: false,
    },
    candidates: MCU_CANDIDATES,
    peripherals: PERIPHERALS,
    selectedMcu: "",
    wiring: {
      stage: "idle",
      pinMappings: [],
      issues: [],
      verified: false,
    },
    firmware: {
      stage: "idle",
      code: "",
      proposal: null,
      version: 0,
    },
    build: {
      stage: "idle",
      logs: [],
      diagnosis: null,
      nextFails: false,
      fixApplied: false,
    },
    companion: {
      stage: "idle",
      serialLines: [],
      moisture: 42,
      temperature: 24.5,
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
    runtime: {
      online: true,
      providerAvailable: true,
      toolchainAvailable: true,
      deviceStage: "none",
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
  | { type: "DELETE_PROJECT"; id: string }
  | { type: "SET_PROMPT"; prompt: string }
  | { type: "DISC_SET_STAGE"; stage: AppState["discovery"]["stage"] }
  | { type: "DISC_STREAM"; text: string }
  | { type: "DISC_CLEAR_RESULTS" }
  | { type: "DISC_CAPABILITY"; cap: AppState["discovery"]["capabilities"][number] }
  | { type: "DISC_CLARIFICATION"; c: AppState["discovery"]["clarification"] }
  | { type: "DISC_DONE"; caps: AppState["discovery"]["capabilities"]; props: AppState["discovery"]["proposals"] }
  | { type: "DISC_ERROR"; error: string }
  | { type: "DISC_DECISION"; id: string; decision: ProposalDecision }
  | { type: "DISC_NEXT_FAIL"; v: boolean }
  | { type: "DISC_PARTIAL"; v: boolean }
  | { type: "ARTIFACT"; kind: ArtifactKind; status: ArtifactState["status"]; version?: number }
  | { type: "STALE_FROM"; from: ArtifactKind }
  | { type: "SELECT_MCU"; mcu: string }
  | { type: "WIRING_GENERATED"; pins: AppState["wiring"]["pinMappings"]; issues: AppState["wiring"]["issues"] }
  | { type: "WIRING_STAGE"; stage: AppState["wiring"]["stage"] }
  | { type: "WIRING_VERIFIED" }
  | { type: "PIN_EDITED"; component: string; pinId: string }
  | { type: "FW_GENERATING" }
  | { type: "FW_PROPOSAL"; p: AppState["firmware"]["proposal"] }
  | { type: "FW_ACCEPTED" }
  | { type: "FW_REJECTED" }
  | { type: "FW_CODE"; code: string; version: number }
  | { type: "BUILD_STAGE"; stage: AppState["build"]["stage"] }
  | { type: "BUILD_LOG"; line: BuildLogLine }
  | { type: "BUILD_LOGS"; logs: BuildLogLine[] }
  | { type: "BUILD_NEXT_FAIL"; v: boolean }
  | { type: "BUILD_FIX_APPLIED" }
  | { type: "DIAGNOSIS"; d: AppState["build"]["diagnosis"] }
  | { type: "RUNTIME"; patch: Partial<AppState["runtime"]> }
  | { type: "COMPANION_STAGE"; stage: AppState["companion"]["stage"] }
  | { type: "COMPANION_SERIAL"; line: string }
  | { type: "COMPANION_TELEMETRY"; moisture?: number; temperature?: number; pumpActive?: boolean }
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
        project: { id: a.id, name: a.name, target: "ESP32-S3", port: "COM6" },
        nav: "Draft",
        sidebar: "Requirements",
        artifacts: freshArtifacts(),
        discovery: { ...initialState().discovery, ...state.discovery, stage: "idle", capabilities: [], proposals: [], clarification: null, error: null, streamedText: "" },
        wiring: initialState().wiring,
        firmware: initialState().firmware,
        build: initialState().build,
        companion: initialState().companion,
        selectedMcu: "",
        copilotMessages: [
          { id: `sys-${Date.now()}`, sender: "system", text: `Project "${a.name}" created. Start with Requirements discovery.` },
        ],
      };
    case "OPEN_PROJECT":
      return { ...state, project: { ...(state.project ?? { name: a.name, target: "ESP32-S3", port: "COM6" }), id: a.id, name: a.name }, nav: "Draft", sidebar: "Requirements" };
    case "DELETE_PROJECT":
      return { ...state, projects: state.projects.filter((p) => p.id !== a.id) };
    case "SET_PROMPT": return { ...state, discoveryPrompt: a.prompt };
    case "DISC_SET_STAGE": return { ...state, discovery: { ...state.discovery, stage: a.stage } };
    case "DISC_STREAM": return { ...state, discovery: { ...state.discovery, streamedText: state.discovery.streamedText + a.text } };
    case "DISC_CLEAR_RESULTS": return { ...state, discovery: { ...state.discovery, capabilities: [], proposals: [], clarification: null, error: null, streamedText: "" } };
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
        },
      };
    case "DISC_ERROR": return { ...state, discovery: { ...state.discovery, stage: "error", error: a.error } };
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
    case "STALE_FROM": {
      const next = { ...state.artifacts };
      const targets = DOWNSTREAM[a.from] ?? [];
      for (const k of targets) {
        const cur = next[k];
        if (cur.version > 0 && cur.status !== "stale" && cur.status !== "error") {
          next[k] = { ...cur, status: "stale" };
        }
      }
      return { ...state, artifacts: next };
    }
    case "SELECT_MCU":
      return { ...state, selectedMcu: a.mcu };
    case "WIRING_GENERATED":
      return { ...state, wiring: { ...state.wiring, stage: "review", pinMappings: a.pins, issues: a.issues, verified: false } };
    case "WIRING_STAGE": return { ...state, wiring: { ...state.wiring, stage: a.stage } };
    case "WIRING_VERIFIED": return { ...state, wiring: { ...state.wiring, verified: true } };
    case "PIN_EDITED": {
      const pins = state.wiring.pinMappings.map((p) => (p.component === a.component ? { ...p, pinId: a.pinId } : p));
      const issues = state.wiring.issues.filter(
        (i) => !(i.pinId === "IO12" && (a.pinId === "IO21" || a.pinId === "IO5"))
      );
      return { ...state, wiring: { ...state.wiring, pinMappings: pins, issues } };
    }
    case "FW_GENERATING": return { ...state, firmware: { ...state.firmware, stage: "generating" } };
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
    case "BUILD_STAGE": return { ...state, build: { ...state.build, stage: a.stage } };
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
  generatePins: () => void;
  verifyRules: () => void;
  editPin: (component: string, pinId: string) => void;
  generateFirmware: () => void;
  acceptFirmwareProposal: () => void;
  rejectFirmwareProposal: () => void;
  startBuild: () => void;
  cancelBuild: () => void;
  retryBuild: () => void;
  runDiagnosis: () => void;
  applyFix: () => void;
  detectBoard: () => void;
  sendSerial: (cmd: string) => void;
  simulateMoisture: (v: number) => void;
  togglePump: () => void;
  flashDevice: () => void;
  revalidateAll: () => void;
  sendCopilotMessage: (text: string) => void;
  runScenario: (id: string) => void;
}

const Ctx = createContext<AppApi | null>(null);

let msgSeq = 0;
const nextId = (p: string) => `${p}-${Date.now()}-${msgSeq++}`;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const cancelRef = useRef<{ discovery?: boolean; build?: boolean; flash?: boolean }>({});
  const s = state;

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

  const openProject = useCallback(async (id: string) => {
    try {
      const p = await clientApi.getProject(id);
      if (!p) throw new ApiError(404, "not_found", "Project not found");
      dispatch({ type: "OPEN_PROJECT", id: p.id, name: p.name });
      return true;
    } catch {
      return false;
    }
  }, []);

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

  const startDiscovery = useCallback(() => {
    if (!s.runtime.online) return;
    if (!s.runtime.providerAvailable) return;
    const prompt = s.discoveryPrompt.trim();
    if (!prompt) return;
    cancelRef.current.discovery = false;
    dispatch({ type: "DISC_CLEAR_RESULTS" });
    dispatch({ type: "DISC_SET_STAGE", stage: "analyzing" });
    void runDiscoveryScript(
      prompt,
      {
        onStream: (chunk) => dispatch({ type: "DISC_STREAM", text: chunk }),
        onCapability: (cap) => dispatch({ type: "DISC_CAPABILITY", cap }),
        onClarification: (c) => {
          dispatch({ type: "DISC_CLARIFICATION", c });
          dispatch({ type: "DISC_SET_STAGE", stage: "clarifying" });
        },
        onDone: (caps, props) =>
          dispatch({
            type: "DISC_DONE",
            caps,
            props: props.map((p) => ({ ...p, decision: p.accepted ? "accepted" : "pending" })),
          }),
        onError: (err) => dispatch({ type: "DISC_ERROR", error: err }),
        isCancelled: () => cancelRef.current.discovery ?? false,
      },
      { slow: s.runtime.slowMode, fail: s.discovery.nextFails, partial: s.discovery.partialNext, providerDown: !s.runtime.providerAvailable }
    );
  }, [s.runtime.online, s.runtime.providerAvailable, s.runtime.slowMode, s.discoveryPrompt, s.discovery.nextFails, s.discovery.partialNext]);

  const cancelDiscovery = useCallback(() => {
    cancelRef.current.discovery = true;
    dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
    pushSystem("Discovery cancelled — no artifacts were modified.");
  }, [pushSystem]);

  const finishClarification = useCallback(
    (answer: string) => {
      cancelRef.current.discovery = false;
      dispatch({ type: "DISC_SET_STAGE", stage: "analyzing" });
      void finishDiscoveryAfterClarification(
        answer,
        {
          onStream: (chunk) => dispatch({ type: "DISC_STREAM", text: chunk }),
          onDone: (caps, props) =>
          dispatch({
            type: "DISC_DONE",
            caps,
            props: props.map((p) => ({ ...p, decision: p.accepted ? "accepted" : "pending" })),
          }),
          isCancelled: () => cancelRef.current.discovery ?? false,
        },
        { slow: s.runtime.slowMode }
      );
    },
    [s.runtime.slowMode]
  );

  const answerClarification = useCallback(
    (answer: string) => finishClarification(answer || "0.96\" SSD1306"),
    [finishClarification]
  );

  const skipClarification = useCallback(() => finishClarification("0.96\" SSD1306 (default)"), [finishClarification]);

  const setProposalDecision = useCallback(
    (id: string, d: ProposalDecision) => {
      dispatch({ type: "DISC_DECISION", id, decision: d });
      const prop = s.discovery.proposals.find((p) => p.id === id);
      if (prop) {
        pushSystem(
          d === "accepted"
            ? `Proposal #${prop.number} "${prop.title}" accepted into design.`
            : d === "rejected"
            ? `Proposal #${prop.number} "${prop.title}" rejected — excluded from design.`
            : `Proposal #${prop.number} back to pending.`
        );
      }
    },
    [s.discovery.proposals, pushSystem]
  );

  const proceedToHardware = useCallback(() => {
    const accepted = s.discovery.proposals.filter((p) => p.decision === "accepted");
    if (accepted.length === 0) return;
    dispatch({ type: "ARTIFACT", kind: "requirements", status: "accepted", version: 1 });
    dispatch({ type: "SIDEBAR", sidebar: "Hardware" });
    pushSystem(`Requirements locked in (${accepted.length} proposals accepted). Requirements artifact v1 committed.`);
  }, [s.discovery.proposals, pushSystem]);

  // ---------- Hardware ----------

  const selectMcu = useCallback(
    (mcu: string) => {
      const changed = mcu !== s.selectedMcu;
      dispatch({ type: "SELECT_MCU", mcu });
      if (changed) {
        const hw = s.artifacts.hardware;
        const version = hw.version > 0 ? hw.version + 1 : 1;
        dispatch({ type: "ARTIFACT", kind: "hardware", status: "accepted", version });
        if (version > 1) {
          dispatch({ type: "STALE_FROM", from: "hardware" });
          pushCopilot({
            sender: "copilot",
            text: `MCU changed to ${mcu}. Downstream artifacts (Pin Map, Wiring, Firmware, Build) are now stale.`,
            warningNote: "Stale propagation",
          });
        } else {
          pushCopilot({
            sender: "copilot",
            text: `${mcu} selected. Hardware artifact v1 committed. Ready for pin assignment.`,
          });
        }
      }
    },
    [s.selectedMcu, s.artifacts.hardware, pushCopilot]
  );

  // ---------- Wiring ----------

  const generatePins = useCallback(() => {
    dispatch({ type: "WIRING_STAGE", stage: "generating" });
    void (async () => {
      await sleep(s.runtime.slowMode ? 2400 : 900);
      if (cancelRef.current.discovery) return;
      const { pins, issues } = autoAssignPins(s.selectedMcu);
      dispatch({ type: "WIRING_GENERATED", pins, issues });
      const pinmapVersion = (s.artifacts.pinmap.version || 0) + 1;
      dispatch({ type: "ARTIFACT", kind: "pinmap", status: issues.length ? "warning" : "accepted", version: pinmapVersion });
      if (issues.length) {
        dispatch({ type: "ARTIFACT", kind: "wiring", status: "draft", version: 0 });
        pushCopilot({
          sender: "copilot",
          text: `Pin assignment generated: ${pins.length} mappings. ⚠️ Strapping pin conflict detected on IO12 (pump relay). I can propose a remap during firmware generation.`,
          warningNote: "Strapping Pin Conflict",
        });
      } else {
        pushCopilot({ sender: "copilot", text: `Pin assignment generated for ${s.selectedMcu}: ${pins.length} mappings, no conflicts.` });
      }
    })();
  }, [s.runtime.slowMode, s.selectedMcu, s.artifacts.pinmap, pushCopilot]);

  const verifyRules = useCallback(() => {
    void (async () => {
      await sleep(s.runtime.slowMode ? 2000 : 700);
      dispatch({ type: "WIRING_VERIFIED" });
      const issues = s.wiring.issues;
      const v = (s.artifacts.wiring.version || 0) + 1;
      dispatch({ type: "ARTIFACT", kind: "wiring", status: issues.length ? "warning" : "validated", version: v });
      dispatch({ type: "ARTIFACT", kind: "validation", status: "validated", version: (s.artifacts.validation.version || 0) + 1 });
      pushCopilot({
        sender: "copilot",
        text: issues.length
          ? `Rules verification complete: ${issues.length} issue(s) found (IO12 strapping). Firmware generation will propose a fix.`
          : "Rules verification complete: all electrical rules passed.",
      });
    })();
  }, [s.runtime.slowMode, s.wiring.issues, s.artifacts.wiring, s.artifacts.validation, pushCopilot]);

  const editPin = useCallback(
    (component: string, pinId: string) => {
      dispatch({ type: "PIN_EDITED", component, pinId });
      dispatch({ type: "ARTIFACT", kind: "pinmap", status: "accepted", version: (s.artifacts.pinmap.version || 0) + 1 });
      pushSystem(`Manual pin edit: ${component} → ${pinId}. Pin Map v${s.artifacts.pinmap.version + 1}.`);
    },
    [s.artifacts.pinmap, pushSystem]
  );

  // ---------- Firmware ----------

  const generateFirmware = useCallback(() => {
    dispatch({ type: "FW_GENERATING" });
    void (async () => {
      await sleep(s.runtime.slowMode ? 2600 : 1100);
      if (cancelRef.current.discovery) return;
      const relay = s.wiring.pinMappings.find((p) => p.component.includes("Pump"));
      const curPin = relay?.pinId?.replace("IO", "") ?? "12";
      const versionFrom = s.firmware.version || 0;
      const proposal =
        curPin === "12"
          ? makeFirmwareProposal(curPin, "21", versionFrom)
          : makeFirmwareProposal(curPin, curPin === "5" ? "21" : "21", versionFrom); // 已有非 IO12 则仍给出对比提案
      dispatch({ type: "FW_PROPOSAL", p: proposal });
      dispatch({ type: "FW_CODE", code: buildFirmwareCode(proposal.newPin.replace("IO", "")), version: proposal.versionFrom });
      pushCopilot({
        sender: "copilot",
        text: `Firmware generated. I found a boot risk: pump relay on ${proposal.oldPin} (strapping pin). Proposal: remap to ${proposal.newPin}. Review the diff.`,
        warningNote: "Boot Conflict",
        proposalCard: {
          issueTitle: "Strapping Pin Conflict",
          description: `Remap Pump Relay from ${proposal.oldPin} to ${proposal.newPin}`,
          suggestedFix: "Update src/main.cpp and Wiring Diagram",
        },
      });
    })();
  }, [s.runtime.slowMode, s.wiring.pinMappings, s.firmware.version, pushCopilot]);

  const acceptFirmwareProposal = useCallback(() => {
    const p = s.firmware.proposal;
    if (!p) return;
    dispatch({ type: "FW_ACCEPTED" });
    dispatch({ type: "ARTIFACT", kind: "firmware", status: "accepted", version: p.versionTo });
    dispatch({ type: "ARTIFACT", kind: "wiring", status: "accepted", version: (s.artifacts.wiring.version || 0) + 1 });
    dispatch({ type: "ARTIFACT", kind: "pinmap", status: "accepted", version: (s.artifacts.pinmap.version || 0) + 1 });
    pushCopilot({
      sender: "copilot",
      text: `Proposal accepted! Pump Relay remapped ${p.oldPin} → ${p.newPin}. Firmware v${p.versionTo} committed. Wiring Diagram updated.`,
    });
  }, [s.firmware.proposal, s.artifacts.wiring, s.artifacts.pinmap, pushCopilot]);

  const rejectFirmwareProposal = useCallback(() => {
    const p = s.firmware.proposal;
    dispatch({ type: "FW_REJECTED" });
    if (p) {
      dispatch({ type: "ARTIFACT", kind: "firmware", status: "warning", version: p.versionFrom });
      pushCopilot({
        sender: "copilot",
        text: `Proposal rejected. Firmware v${p.versionFrom} kept with ${p.oldPin} (strapping risk remains — build may still succeed but boot behavior is not guaranteed).`,
        warningNote: "Risk accepted by user",
      });
    }
  }, [s.firmware.proposal, pushCopilot]);

  // ---------- Build ----------

  const startBuild = useCallback(() => {
    if (!s.runtime.toolchainAvailable) return;
    const firmwareOk = s.artifacts.firmware.version > 0 && s.artifacts.firmware.status !== "stale";
    if (!firmwareOk) return; // Stale 拦截（视图层提示）
    cancelRef.current.build = false;
    dispatch({ type: "BUILD_LOGS", logs: [] });
    dispatch({ type: "BUILD_STAGE", stage: "building" });
    void runBuildScript(
      s.build.nextFails,
      {
        onLog: (line) => dispatch({ type: "BUILD_LOG", line }),
        onDone: (logs, ok) => {
          dispatch({ type: "BUILD_STAGE", stage: ok ? "succeeded" : "failed" });
          dispatch({
            type: "ARTIFACT",
            kind: "build",
            status: ok ? "validated" : "error",
            version: (s.artifacts.build.version || 0) + 1,
          });
        },
        isCancelled: () => cancelRef.current.build ?? false,
      },
      { slow: s.runtime.slowMode }
    );
  }, [s.runtime.toolchainAvailable, s.runtime.slowMode, s.artifacts.firmware, s.artifacts.build, s.build.nextFails]);

  const cancelBuild = useCallback(() => {
    cancelRef.current.build = true;
    dispatch({ type: "BUILD_STAGE", stage: "cancelled" });
    pushSystem("Build cancelled — no build artifact written.");
  }, [pushSystem]);

  const retryBuild = useCallback(() => startBuild(), [startBuild]);

  const runDiagnosis = useCallback(() => {
    void (async () => {
      await sleep(s.runtime.slowMode ? 2200 : 1000);
      pushCopilot({
        sender: "copilot",
        text: "Diagnosis complete: missing library dependency `Adafruit_SSD1306`. I'll propose adding it to platformio.ini.",
      });
    })();
    dispatch({ type: "DIAGNOSIS", d: BUILD_DIAGNOSIS });
  }, [s.runtime.slowMode, pushCopilot]);

  const applyFix = useCallback(() => {
    dispatch({ type: "BUILD_FIX_APPLIED" });
    pushSystem("Fix proposal applied: lib_deps added to platformio.ini (Firmware deps v+1). Rebuild to verify.");
  }, [pushSystem]);

  // ---------- Companion ----------

  const detectBoard = useCallback(() => {
    dispatch({ type: "COMPANION_STAGE", stage: "detecting" });
    void (async () => {
      await sleep(s.runtime.slowMode ? 1800 : 800);
      dispatch({ type: "RUNTIME", patch: { deviceStage: "connected" } });
      dispatch({ type: "COMPANION_STAGE", stage: "serial" });
      pushCopilot({ sender: "copilot", text: `Board detected: ${s.project?.name ?? "Smart Greenhouse"} target (ESP32-S3) on COM6 @ 115200 baud.` });
    })();
  }, [s.runtime.slowMode, s.project?.name, pushCopilot]);

  const flashDevice = useCallback(() => {
    if (s.runtime.deviceStage !== "connected") return;
    cancelRef.current.flash = false;
    dispatch({ type: "RUNTIME", patch: { deviceStage: "flashing" } });
    dispatch({ type: "COMPANION_STAGE", stage: "flashing" });
    void (async () => {
      for (let pct = 0; pct <= 100; pct += 20) {
        if (cancelRef.current.flash) return;
        dispatch({ type: "FLASH_PROGRESS", pct });
        await sleep(s.runtime.slowMode ? 600 : 300);
      }
      dispatch({ type: "RUNTIME", patch: { deviceStage: "connected" } });
      dispatch({ type: "COMPANION_STAGE", stage: "serial" });
      dispatch({ type: "ARTIFACT", kind: "debug", status: "validated", version: (s.artifacts.debug.version || 0) + 1 });
      pushCopilot({ sender: "copilot", text: "Flash complete. Serial terminal open — live telemetry streaming." });
    })();
  }, [s.runtime.deviceStage, s.runtime.slowMode, s.artifacts.debug, pushCopilot]);

  const sendSerial = useCallback(
    (cmd: string) => {
      dispatch({ type: "COMPANION_SERIAL", line: `> ${cmd}` });
      const c = s.companion;
      const line = makeSerialLine(c.moisture, c.pumpActive, c.temperature);
      dispatch({ type: "COMPANION_SERIAL", line: `[ACK] ${cmd} -> ${line}` });
    },
    [s.companion]
  );

  const simulateMoisture = useCallback((v: number) => {
    dispatch({ type: "COMPANION_TELEMETRY", moisture: v });
  }, []);

  const togglePump = useCallback(() => {
    dispatch({ type: "COMPANION_TELEMETRY", pumpActive: !s.companion.pumpActive });
  }, [s.companion.pumpActive]);

  // ---------- Stale 重新验证 ----------

  const revalidateAll = useCallback(() => {
    void (async () => {
      const kinds: ArtifactKind[] = ["pinmap", "wiring", "firmware", "build"];
      for (const k of kinds) {
        if (s.artifacts[k].status !== "stale") continue;
        if (k === "pinmap") {
          await sleep(s.runtime.slowMode ? 1500 : 500);
          const { pins, issues } = autoAssignPins(s.selectedMcu);
          dispatch({ type: "WIRING_GENERATED", pins, issues });
          dispatch({ type: "ARTIFACT", kind: "pinmap", status: issues.length ? "warning" : "accepted", version: (s.artifacts.pinmap.version || 0) + 1 });
        } else if (k === "wiring") {
          await sleep(s.runtime.slowMode ? 1200 : 450);
          dispatch({ type: "ARTIFACT", kind: "wiring", status: "validated", version: (s.artifacts.wiring.version || 0) + 1 });
        } else if (k === "firmware") {
          await sleep(s.runtime.slowMode ? 1500 : 600);
          dispatch({ type: "ARTIFACT", kind: "firmware", status: "accepted", version: (s.artifacts.firmware.version || 0) + 1 });
        } else if (k === "build") {
          await sleep(s.runtime.slowMode ? 1200 : 500);
          dispatch({ type: "ARTIFACT", kind: "build", status: "validated", version: (s.artifacts.build.version || 0) + 1 });
        }
      }
      pushCopilot({ sender: "copilot", text: "Revalidation complete — all downstream artifacts are up to date." });
    })();
  }, [s.artifacts, s.runtime.slowMode, s.selectedMcu, pushCopilot]);

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
          : "The last build succeeded. Memory: RAM 22.4% / Flash 31.8%.";
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
        case "deviceDown": dispatch({ type: "RUNTIME", patch: { deviceStage: "disconnected" } }); break;
        case "deviceUp": dispatch({ type: "RUNTIME", patch: { deviceStage: "connected" } }); break;
        case "buildFail": dispatch({ type: "BUILD_NEXT_FAIL", v: true }); break;
        case "buildOk": dispatch({ type: "BUILD_NEXT_FAIL", v: false }); break;
        case "discFail": dispatch({ type: "DISC_NEXT_FAIL", v: true }); break;
        case "discOk": dispatch({ type: "DISC_NEXT_FAIL", v: false }); break;
        case "slow": dispatch({ type: "RUNTIME", patch: { slowMode: !r.slowMode } }); break;
        case "stale":
          dispatch({ type: "STALE_FROM", from: "hardware" });
          pushSystem("Lab: downstream artifacts forced stale.");
          break;
        case "partial": dispatch({ type: "DISC_PARTIAL", v: true }); break;
        case "partialOk": dispatch({ type: "DISC_PARTIAL", v: false }); break;
      }
    },
    [s.runtime, s.lang, pushSystem, createProject]
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
      startDiscovery,
      cancelDiscovery,
      answerClarification,
      skipClarification,
      setProposalDecision,
      proceedToHardware,
      selectMcu,
      generatePins,
      verifyRules,
      editPin,
      generateFirmware,
      acceptFirmwareProposal,
      rejectFirmwareProposal,
      startBuild,
      cancelBuild,
      retryBuild,
      runDiagnosis,
      applyFix,
      detectBoard,
      sendSerial,
      simulateMoisture,
      togglePump,
      flashDevice,
      revalidateAll,
      sendCopilotMessage,
      runScenario,
    }),
    [
      s, createProject, openProject, archiveProject, setNav, setSidebar,
      startDiscovery, cancelDiscovery, answerClarification, skipClarification,
      setProposalDecision, proceedToHardware, selectMcu, generatePins, verifyRules,
      editPin, generateFirmware, acceptFirmwareProposal, rejectFirmwareProposal,
      startBuild, cancelBuild, retryBuild, runDiagnosis, applyFix, detectBoard,
      sendSerial, simulateMoisture, togglePump, flashDevice, revalidateAll,
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
