// app/src/lib/report-client-error.ts — 客户端错误上报（诊断切片）
// 会话级限流 + fire-and-forget；绝不携带凭据/输入内容，只带错误本体与页面位置。
const ENDPOINT = "/api/v1/diagnostics/client-errors";
const MAX_REPORTS_PER_SESSION = 20;

let reportCount = 0;
let sessionId = "";

export function initClientSessionId(): string {
  if (!sessionId) {
    sessionId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return sessionId;
}

export interface ClientErrorInput {
  message: string;
  stack?: string | null;
  url?: string | null;
  extra?: Record<string, unknown>;
}

/** 失败静默：诊断上报永远不影响用户路径。 */
export function reportClientError(input: ClientErrorInput): void {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  reportCount += 1;
  const payload = {
    message: input.message.slice(0, 2000),
    stack: input.stack ? input.stack.slice(0, 16000) : undefined,
    url: (input.url ?? window.location.href).slice(0, 500),
    userAgent: window.navigator.userAgent.slice(0, 200),
    sessionId: initClientSessionId(),
    extra: input.extra,
  };
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* 上报失败忽略 */
  }
}

export function installGlobalErrorHandlers(): void {
  initClientSessionId();
  window.addEventListener("error", (event) => {
    reportClientError({ message: event.message || "window.error", stack: event.error instanceof Error ? event.error.stack : null });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      message: reason instanceof Error ? reason.message : String(reason ?? "unhandledrejection"),
      stack: reason instanceof Error ? reason.stack : null,
      extra: { kind: "unhandledrejection" },
    });
  });
}
