// ports/events.ts — EventPort（implementation-spec §9；ISSUE-002 §3/§9）
// 逻辑事件（logical-events 域；传输无关）。M1 无 Event Store / 无 replay。
// S2：EventPort 占位（publish 记录到内存/日志）；SSE 端点延后 S3A（ISSUE-002 §3）。
import type { ArtifactKind } from "@/src/shared-contracts/types";

export type LogicalEvent =
  | {
      type: "artifact.version.created";
      projectId: string;
      artifactId: string;
      versionId: string;
      kind: ArtifactKind;
      versionNo: number;
      createdAt: string;
    };

export interface EventPort {
  publish(event: LogicalEvent): void;
}
