// ports/events.ts — EventPort（implementation-spec §9；ISSUE-002 §3/§9；ISSUE-003 §3）
// 逻辑事件（logical-events 域；传输无关）。M1 无 Event Store / 无 replay。
// S2：EventPort 占位（publish 记录到内存/日志）；S3A：SSE 适配器（/projects/:id/events，断线→Query 续流）。
import type { AnalysisCapabilityDto, ArtifactKind } from "@/src/shared-contracts/types";

export type LogicalEvent =
  | {
      type: "artifact.version.created";
      projectId: string;
      artifactId: string;
      versionId: string;
      kind: ArtifactKind;
      versionNo: number;
      createdAt: string;
    }
  // ---------- S3A Analysis ----------
  | { type: "requirement.analysis.started"; projectId: string; analysisId: string; taskId: string }
  | {
      type: "requirement.analysis.progress";
      projectId: string;
      analysisId: string;
      stage: "streaming" | "capabilities" | "finalizing";
      chunk?: string;
    }
  | {
      type: "requirement.analysis.clarification.requested";
      projectId: string;
      analysisId: string;
      roundId: number;
      question: string;
      detail?: string;
    }
  | {
      type: "requirement.analysis.completed";
      projectId: string;
      analysisId: string;
      capabilities: AnalysisCapabilityDto[];
    }
  | { type: "requirement.analysis.failed"; projectId: string; analysisId: string; reason: string }
  | { type: "requirement.analysis.cancelled"; projectId: string; analysisId: string }
  // ---------- S5B Revalidate ----------
  | { type: "artifact.revalidating"; projectId: string; artifactId: string; kind: ArtifactKind }
  | {
      type: "artifact.revalidated";
      projectId: string;
      artifactId: string;
      kind: ArtifactKind;
      outcome: "validated" | "proposal_created" | "error";
    }
  | { type: "proposal.created"; projectId: string; proposalId: string; kind: ArtifactKind }
  | { type: "provider.unavailable"; provider: string; reason: string };

export interface EventPort {
  publish(event: LogicalEvent): void;
}
