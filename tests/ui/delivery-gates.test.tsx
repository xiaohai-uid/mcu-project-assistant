// @vitest-environment jsdom
// ui/delivery-gates — issues/09：全局三态徽章 + companion 动作→门禁状态传播。
// store 语义（去重拉取/原地传播）+ 各表面徽章在位（经共享 seam，不发明状态）。
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { DeliveryReportDto, ReadinessGateDto } from "@/src/shared-contracts/types";

const { getDeliveryReport, getBom, appState, appActions } = vi.hoisted(() => ({
  getDeliveryReport: vi.fn(),
  getBom: vi.fn(),
  appState: { current: {} as Record<string, unknown> },
  appActions: { current: {} as Record<string, unknown> },
}));

vi.mock("@/app/src/api/client", () => ({
  api: new Proxy({ getDeliveryReport, getBom }, {
    get(target, prop) {
      if (prop === "getDeliveryReport") return target.getDeliveryReport;
      if (prop === "getBom") return target.getBom;
      return () => Promise.resolve([]);
    },
  }),
}));

vi.mock("@/app/src/state/AppContext", () => ({
  useApp: () => ({ state: appState.current, ...(appActions.current as object) }),
}));

import { ReadinessBadgeStrip } from "@/app/src/components/ReadinessBadgeStrip";
import { useDeliveryGates, refreshDeliveryGates, __resetDeliveryReportCache } from "@/app/src/state/deliveryReport";
import { CompanionView } from "@/app/src/components/CompanionView";
import { BomView } from "@/app/src/components/BomView";
import { FirmwareView } from "@/app/src/components/FirmwareView";
import { WiringGuidanceView } from "@/app/src/components/WiringGuidanceView";
import { HardwareSelectionView } from "@/app/src/components/HardwareSelectionView";
import { ReadinessView } from "@/app/src/components/ReadinessView";

function gate(id: ReadinessGateDto["id"], status: ReadinessGateDto["status"]): ReadinessGateDto {
  return { id, status, title: id, reason: null, nextAction: null, evidence: [] };
}

let physicalStatus: ReadinessGateDto["status"];
function makeReport(): DeliveryReportDto {
  return {
    projectId: "p1",
    generatedAt: "2026-08-23T00:00:00Z",
    conclusion: { status: "pending", text: "", nextAction: null },
    gates: [gate("local-ready", "ready"), gate("simulation-ready", "unavailable"), gate("physical-accepted", physicalStatus)],
    project: { name: "P1" },
    hardware: { versionId: null, observedAt: null, identity: null },
    componentIdentities: [],
    wiring: { versionId: null, validation: null },
    build: null,
    physicalAcceptance: null,
    simulation: { status: "not-run", reason: null },
    bom: { projectId: "p1", generatedAt: "g", items: [] },
    priceObservationTimestamps: [],
    risks: [],
  } as unknown as DeliveryReportDto;
}

beforeEach(() => {
  __resetDeliveryReportCache();
  getDeliveryReport.mockReset();
  getBom.mockReset();
  physicalStatus = "pending";
  getDeliveryReport.mockImplementation(async () => makeReport());
  getBom.mockImplementation(async () => ({ projectId: "p1", generatedAt: "g", items: [{
    id: "b1", displayName: "Soil sensor", componentId: "soil-1", identityStatus: "verified",
    manufacturerPartNumber: "SEN-1", supplierSku: "C1", quantity: 1, notes: null,
    priceObservations: [],
  }] }));
  appState.current = { lang: "en", project: { id: "p1", name: "P1" } };
  appActions.current = {};
});

afterEach(() => {
  cleanup();
});

describe("useDeliveryGates 共享 seam", () => {
  it("多个表面共享同一次 delivery-report 拉取（覆盖面扩大不倍增请求）", async () => {
    function Surface({ tag }: { tag: string }) {
      const gates = useDeliveryGates("p1");
      return (
        <div data-testid={`surface-${tag}`}>
          <ReadinessBadgeStrip gates={gates} lang="en" />
        </div>
      );
    }
    render(<div><Surface tag="a" /><Surface tag="b" /></div>);
    await screen.findAllByText("Local build ready · READY");
    expect(getDeliveryReport).toHaveBeenCalledTimes(1);
  });

  it("refreshDeliveryGates 原地传播新状态到已挂载消费者（无需重新挂载）", async () => {
    function Surface() {
      const gates = useDeliveryGates("p1");
      return <ReadinessBadgeStrip gates={gates} lang="en" />;
    }
    render(<Surface />);
    await screen.findByText("Physical acceptance · PENDING");
    physicalStatus = "ready";
    await refreshDeliveryGates("p1");
    expect(await screen.findByText("Physical acceptance · READY")).toBeTruthy();
    expect(screen.queryByText("Physical acceptance · PENDING")).toBeNull();
  });
});

describe("companion 动作 → 可见物理门禁翻转", () => {
  it("检测动作触发门禁刷新后，已挂载表面的 physical 徽章由 PENDING 翻为 READY", async () => {
    appState.current = {
      lang: "en", project: { id: "p1", name: "P1" },
      runtime: { deviceStage: "idle", serialStage: "disconnected", serialSession: null, deviceTruth: null },
      companion: { flashProgress: 0, moisture: null, pumpActive: false, temperature: null, serialLines: [] },
    };
    appActions.current = {
      detectBoard: () => { void refreshDeliveryGates("p1"); },
      openSerial: () => {}, closeSerial: () => {}, flashWithConfirmation: () => {},
      simulateMoisture: () => {}, togglePump: () => {},
    };
    function Surface() {
      const gates = useDeliveryGates("p1");
      return <ReadinessBadgeStrip gates={gates} lang="en" />;
    }
    render(<div><CompanionView /><Surface /></div>);
    await screen.findByText("Physical acceptance · PENDING");
    physicalStatus = "ready";
    const detectButton = screen.getAllByRole("button").find((b) => /detect/i.test(b.textContent ?? ""));
    expect(detectButton).toBeTruthy();
    fireEvent.click(detectButton!);
    await screen.findByText("Physical acceptance · READY");
  });
});

describe("各表面徽章在位（共享组件，不自造状态）", () => {
  it("hardware 卡渲染三态条", async () => {
    appState.current = {
      lang: "en", project: { id: "p1", name: "P1" },
      candidates: [], peripherals: [], selectedMcu: null,
      artifacts: { hardware: { status: "current", version: 0 }, pinmap: { status: "current", version: 0 } },
    };
    appActions.current = { selectMcu: () => {}, generatePins: () => {}, setSidebar: () => {}, refreshMcuCandidates: () => {} };
    render(<HardwareSelectionView />);
    expect((await screen.findAllByTestId("readiness-badge-strip")).length).toBeGreaterThan(0);
  });

  it("pinmap 卡渲染三态条", async () => {
    appState.current = {
      lang: "en",
      wiring: { stage: "ready", verified: false, issues: [], validation: null, pinMappings: [] },
      artifacts: { pinmap: { status: "current", version: 1 }, wiring: { status: "current", version: 0 } },
      pinmapVersions: [],
      project: { id: "p1", name: "P1" },
    };
    appActions.current = { verifyRules: () => {}, generateFirmware: () => {}, editPin: () => {}, setSidebar: () => {}, refreshPinmapVersions: () => {} };
    render(<WiringGuidanceView />);
    expect((await screen.findAllByTestId("readiness-badge-strip")).length).toBeGreaterThan(0);
  });

  it("firmware 卡渲染三态条", async () => {
    appState.current = {
      lang: "en", project: { id: "p1", name: "P1" },
      firmware: { version: 1, code: "", proposal: null, stage: "ready" },
      artifacts: { firmware: { status: "current", version: 1 }, pinmap: { status: "current", version: 1 } },
      wiring: { pinMappings: [] },
    };
    appActions.current = { generateFirmware: () => {}, acceptFirmwareProposal: () => {}, rejectFirmwareProposal: () => {} };
    render(<FirmwareView />);
    expect((await screen.findAllByTestId("readiness-badge-strip")).length).toBeGreaterThan(0);
  });

  it("BOM 区块渲染三态条，且每行携带 local-ready 门禁徽章", async () => {
    appState.current = { lang: "en", project: { id: "p1", name: "P1" } };
    render(<BomView />);
    expect((await screen.findAllByTestId("readiness-badge-strip")).length).toBeGreaterThan(0);
    // "Soil sensor" 同时出现在行与选中详情区 → 用多匹配查询。
    expect((await screen.findAllByText("Soil sensor")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId("readiness-badge-local-ready").length).toBeGreaterThanOrEqual(1);
  });

  it("交付报告分区携带对应单门禁徽章", async () => {
    appState.current = {
      lang: "en", project: { id: "p1", name: "P1" },
      build: { buildId: "b1" }, companion: { serialLines: [] },
    };
    render(<ReadinessView />);
    await screen.findByTestId("readiness-section-hardware");
    expect(screen.getByTestId("readiness-section-hardware").getAttribute("data-gate")).toBe("physical-accepted");
    expect(screen.getByTestId("readiness-section-build").getAttribute("data-gate")).toBe("local-ready");
    expect(screen.getByTestId("readiness-section-simulation").getAttribute("data-gate")).toBe("simulation-ready");
    expect(screen.getByTestId("readiness-section-physical").getAttribute("data-gate")).toBe("physical-accepted");
  });
});

// issues/12：版本身份用户可见——Settings 头卡渲染构建期注入的 __APP_VERSION__。
describe("version visibility (issues/12)", () => {
  it("Settings header shows the app version", async () => {
    const { SettingsView } = await import("@/app/src/components/SettingsView");
    appState.current = {
      lang: "en", theme: "light", selectedMcu: null, project: null,
      runtime: { deviceStage: "idle", serialStage: "disconnected", deviceId: null },
    };
    appActions.current = { dispatch: () => {}, selectMcu: () => {}, detectBoard: () => {} };
    const { container } = render(<SettingsView />);
    expect(container.textContent).toMatch(/v0\.1\.0/);
  });
});
