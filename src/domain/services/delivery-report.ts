import { ESP32_S3_REFERENCE_KIT_ID } from "@/src/domain/services/build-profile";
import { deriveCommercialReadiness } from "@/src/domain/services/commercial-readiness";
import type { BuildRecord } from "@/src/domain/models/build-record";
import type { DeliveryBoardIdentityDto, DeliveryReportDto, DeliveryRiskDto, DeviceTruthDto, PhysicalAcceptanceRecordDto, ProjectBomDto, ReadinessEvidenceDto, ValidationRecordDto } from "@/src/shared-contracts/types";

export interface DeliveryReportInput {
  projectId: string;
  projectName: string;
  generatedAt: string;
  hardware: {
    versionId: string | null;
    observedAt: string | null;
    identity: DeliveryBoardIdentityDto | null;
  };
  wiring: {
    versionId: string | null;
    validation: ValidationRecordDto | null;
  };
  build: BuildRecord | null;
  physical: DeviceTruthDto | null;
  physicalAcceptance: PhysicalAcceptanceRecordDto | null;
  simulation: DeviceTruthDto | null;
  bom: ProjectBomDto;
}

function evidence(kind: string, ref: string, observedAt: string, detail: string): ReadinessEvidenceDto {
  return { kind, ref, observedAt, detail };
}

function risk(
  id: string,
  severity: DeliveryRiskDto["severity"],
  title: string,
  detail: string,
  nextAction: string | null,
  evidenceRefs: ReadinessEvidenceDto[] = [],
): DeliveryRiskDto {
  return { id, severity, title, detail, nextAction, evidence: evidenceRefs };
}

function simulationStatus(truth: DeviceTruthDto | null): DeliveryReportDto["simulation"] {
  if (!truth) return { status: "not-run", reason: "Optional simulation has not been run." };
  if (truth.executionReality === "simulation" && truth.verification === "verified") return { status: "ready", reason: null };
  return { status: "blocked", reason: "Simulation evidence is present but not verified as a simulation result." };
}

function risks(input: DeliveryReportInput, readiness: DeliveryReportDto): DeliveryRiskDto[] {
  const result: DeliveryRiskDto[] = [];
  if (!input.physicalAcceptance || input.physicalAcceptance.status !== "accepted") {
    const gate = readiness.gates.find((item) => item.id === "physical-accepted");
    result.push(risk(
      "physical-acceptance",
      "required",
      "Physical acceptance is not complete",
      input.physicalAcceptance?.reason ?? "No accepted physical upload, verification, and serial record is saved.",
      gate?.nextAction ?? "Connect the exact board, upload the saved build, verify it, and record serial evidence.",
      gate?.evidence ?? [],
    ));
  }
  if (!input.hardware.identity || input.hardware.identity.referenceKitId !== ESP32_S3_REFERENCE_KIT_ID) {
    result.push(risk(
      "hardware-identity",
      "required",
      "Approved Reference Kit identity is missing or mismatched",
      `The commercial path requires ${ESP32_S3_REFERENCE_KIT_ID}.`,
      `Select ${ESP32_S3_REFERENCE_KIT_ID} and regenerate downstream artifacts.`,
      input.hardware.versionId ? [evidence("hardware-version", input.hardware.versionId, input.hardware.observedAt ?? input.generatedAt, "Current hardware artifact identity.")] : [],
    ));
  }
  if (!input.wiring.validation || input.wiring.validation.result !== "pass") {
    result.push(risk(
      "wiring-validation",
      "required",
      "Wiring validation has not passed",
      input.wiring.validation ? `Pin Map validation is ${input.wiring.validation.result}.` : "No Pin Map validation record is saved.",
      "Validate the current Pin Map and resolve every blocking diagnostic.",
      input.wiring.validation ? [evidence("wiring-validation", input.wiring.validation.id, input.wiring.validation.completedAt ?? input.wiring.validation.startedAt, `Validation result: ${input.wiring.validation.result}.`)] : [],
    ));
  }
  const binary = input.build?.outputs.find((output) => output.kind === "bin" && /^[a-f0-9]{64}$/i.test(output.sha256));
  if (!binary) {
    result.push(risk(
      "artifact-hash",
      "required",
      "Firmware artifact hash is missing",
      "The final report cannot point to a verified binary without a SHA-256 artifact record.",
      "Run the pinned build and save a non-empty binary output with its SHA-256 hash.",
      input.build ? [evidence("build-record", input.build.id, input.build.completedAt ?? input.build.startedAt, `Build outputs: ${input.build.outputs.length}.`)] : [],
    ));
  }
  for (const item of input.bom.items.filter((candidate) => candidate.identityStatus === "unresolved")) {
    result.push(risk(
      `bom-unresolved:${item.id}`,
      "optional",
      `BOM identity unresolved: ${item.displayName}`,
      item.unresolvedReason ?? "This item has no exact manufacturer and supplier identity.",
      "Supply an exact manufacturer part number and LCSC supplier SKU before procurement.",
      [evidence("bom-item", item.id, item.createdAt, `${item.componentId} remains unresolved.`)],
    ));
  }
  return result;
}

export function deriveDeliveryReport(input: DeliveryReportInput): DeliveryReportDto {
  const readiness = deriveCommercialReadiness({
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    hardware: {
      referenceKitId: input.hardware.identity?.referenceKitId ?? null,
      versionId: input.hardware.versionId,
      observedAt: input.hardware.observedAt,
    },
    wiring: input.wiring,
    build: input.build,
    simulation: input.simulation,
    physical: input.physical,
    physicalAcceptance: input.physicalAcceptance,
  });
  const report: DeliveryReportDto = {
    ...readiness,
    project: { name: input.projectName },
    hardware: input.hardware,
    componentIdentities: input.bom.items.filter((item) => !item.componentId.startsWith("board:")),
    wiring: input.wiring,
    build: input.build,
    physicalAcceptance: input.physicalAcceptance,
    simulation: simulationStatus(input.simulation),
    bom: input.bom,
    priceObservationTimestamps: input.bom.items.flatMap((item) => item.priceObservations.map((observation) => ({ bomItemId: item.id, observedAt: observation.observedAt }))),
    risks: [],
  };
  report.risks = risks(input, report);
  return report;
}
