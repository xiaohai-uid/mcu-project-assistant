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
import {
  buildFirmwareCode,
  BUILD_DIAGNOSIS,
  DEFAULT_PROMPT,
  makeFirmwareProposal,
  makeSerialLine,
  MCU_CANDIDATES,
  PERIPHERALS,
  runBuildScript,
  sleep,
} from "../mock/engine";
import { format, getInitialLanguage, getInitialTheme } from "../lib/i18n";
import { api as clientApi, ApiError } from "../api/client";
import { subscribeProjectEvents } from "../api/sse";
import type { AnalysisCapabilityDto, McuCandidateDto, PeripheralDto } from "../api/client";

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
    pinmapVersions: [],
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
    revalidate: { running: false, proposals: [] },
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
  | { type: "STALE_MARKS"; marks: Array<{ kind: string; level: string }> }
  | { type: "REVAL_RUNNING"; running: boolean }
  | { type: "REVAL_PROPOSALS"; proposals: Array<{ proposalId: string; kind: ArtifactKind }> }
  | { type: "REVAL_REMOVE_PROPOSAL"; proposalId: string }
  | { type: "SELECT_MCU"; mcu: string }
  | { type: "MCU_CANDIDATES"; candidates: McuCandidateDto[]; peripherals: PeripheralDto[] }
  | { type: "WIRING_GENERATED"; pins: AppState["wiring"]["pinMappings"]; issues: AppState["wiring"]["issues"] }
  | { type: "WIRING_STAGE"; stage: AppState["wiring"]["stage"] }
  | { type: "WIRING_VERIFIED" }
  | { type: "PIN_EDITED"; component: string; pinId: string }
  | { type: "PINMAP_VERSIONS"; versions: AppState["pinmapVersions"] }
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
    case "WIRING_VERIFIED": return { ...state, wiring: { ...state.wiring, verified: true } };
    case "PIN_EDITED": {
      const pins = state.wiring.pinMappings.map((p) => (p.component === a.component ? { ...p, pinId: a.pinId } : p));
      const issues = state.wiring.issues.filter(
        (i) => !(i.pinId === "IO12" && (a.pinId === "IO21" || a.pinId === "IO5"))
      );
      return { ...state, wiring: { ...state.wiring, pinMappings: pins, issues } };
    }
    case "PINMAP_VERSIONS": return { ...state, pinmapVersions: a.versions };
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
  sendSerial: (cmd: string) => void;
  simulateMoisture: (v: number) => void;
  togglePump: () => void;
  flashDevice: () => void;
  revalidateAll: () => void;
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

  // ---------- Stale 重新验证（S5B：真实 stale-marks 拉取；上游动作后刷新呈现） ----------

  const refreshStaleMarks = useCallback(async (projectId: string) => {
    try {
      const { marks } = await clientApi.getStaleMarks(projectId);
      dispatch({ type: "STALE_MARKS", marks: marks.map((m) => ({ kind: m.kind ?? "", level: m.level })) });
    } catch {
      // marks 拉取失败保持当前呈现（transport 错误由下一动作呈现）
    }
  }, []);

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
      // S5B：打开项目 → 拉取真实 stale marks（侧栏点/横幅/门禁与服务端一致）
      await refreshStaleMarks(id);
      return true;
    } catch {
      return false;
    }
  }, [refreshStaleMarks]);

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

  const taskRef = useRef<{ taskId: string; roundId: number; close: (() => void) | null }>({
    taskId: "",
    roundId: 0,
    close: null,
  });

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
    if (!s.runtime.online) return;
    if (!s.runtime.providerAvailable) return;
    const prompt = s.discoveryPrompt.trim();
    if (!prompt) return;
    const projectId = s.project?.id;
    if (!projectId) return;
    cancelRef.current.discovery = false;
    dispatch({ type: "DISC_CLEAR_RESULTS" });
    dispatch({ type: "DISC_SET_STAGE", stage: "analyzing" });

    const onEvent = (type: string, data: unknown) => {
      switch (type) {
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
        case "requirement.analysis.clarification.requested": {
          const c = data as { roundId: number; question: string; detail?: string };
          taskRef.current.roundId = c.roundId;
          dispatch({ type: "DISC_CLARIFICATION", c: { question: c.question, detail: c.detail ?? "", answer: "", answered: false } });
          dispatch({ type: "DISC_SET_STAGE", stage: "clarifying" });
          break;
        }
        case "requirement.analysis.completed": {
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
          dispatch({ type: "DISC_ERROR", error: (data as { reason?: string }).reason ?? "Analysis failed" });
          break;
        }
        case "requirement.analysis.cancelled": {
          dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
          break;
        }
        case "provider.unavailable": {
          dispatch({ type: "RUNTIME", patch: { providerAvailable: false } });
          dispatch({ type: "DISC_ERROR", error: "AI provider unavailable — check connection and retry." });
          break;
        }
        default:
          break;
      }
    };

    void (async () => {
      try {
        const { taskId } = await clientApi.analyzeRequirement(projectId, prompt, {
          slow: s.runtime.slowMode,
          failNext: s.discovery.nextFails,
          partialNext: s.discovery.partialNext,
        });
        taskRef.current.taskId = taskId;
        // 订阅 SSE（无 replay：重连后 Query 状态恢复由刷新/重试承担）
        taskRef.current.close?.();
        taskRef.current.close = subscribeProjectEvents(projectId, { onEvent });
      } catch (err) {
        dispatch({ type: "DISC_ERROR", error: err instanceof ApiError ? err.message : "Analysis failed to start" });
      }
    })();
  }, [s.runtime.online, s.runtime.providerAvailable, s.runtime.slowMode, s.discoveryPrompt, s.discovery.nextFails, s.discovery.partialNext, s.project?.id]);

  const cancelDiscovery = useCallback(() => {
    cancelRef.current.discovery = true;
    dispatch({ type: "DISC_SET_STAGE", stage: "cancelled" });
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
          dispatch({ type: "DISC_ERROR", error: err instanceof ApiError ? err.message : "Clarification failed" })
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
            pinId: i.pinId,
            severity: i.severity,
            title: i.title,
            detail: i.detail,
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
        const issues = record.diagnostics
          .filter((d) => d.code === "STRAPPING_PIN_USAGE")
          .map((d) => ({ pinId: String(d.details?.pin ?? ""), severity: d.severity as PinIssue["severity"], title: "Strapping pin conflict", detail: d.message }));
        dispatch({ type: "WIRING_VERIFIED" });
        dispatch({ type: "ARTIFACT", kind: "wiring", status: record.result === "pass" ? "validated" : "warning", version: (s.artifacts.wiring.version || 0) + 1 });
        dispatch({ type: "ARTIFACT", kind: "validation", status: "validated", version: (s.artifacts.validation.version || 0) + 1 });
        pushCopilot({
          sender: "copilot",
          text: issues.length
            ? `Rules verification complete: ${issues.length} issue(s) found (IO12 strapping). Firmware generation will propose a fix.`
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
      dispatch({ type: "PIN_EDITED", component, pinId });
      const nextMappings = s.wiring.pinMappings.map((p) =>
        p.component === component ? { ...p, pinId } : p
      );
      void (async () => {
        const projectId = s.project?.id;
        if (!projectId) return;
        try {
          const artifact = await clientApi.ensureArtifact(projectId, "pinmap");
          const version = await clientApi.commitVersion(artifact.id, JSON.stringify(nextMappings, null, 2));
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
    [s.project?.id, s.wiring.pinMappings, refreshStaleMarks, refreshPinmapVersions, pushSystem]
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
      sendSerial,
      simulateMoisture,
      togglePump,
      flashDevice,
      revalidateAll,
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
      sendSerial, simulateMoisture, togglePump, flashDevice, revalidateAll, decideRevalidateProposal,
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
