// shared/correlation-id.ts — 请求关联 ID（x-request-id）生成。
// HTTP 层与诊断事件共用的中性原语；格式实现细节收敛在此处。
import { randomUUID } from "node:crypto";

export function newCorrelationId(): string {
  return randomUUID();
}
