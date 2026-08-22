// app/src/components/ErrorBoundary.tsx — React 渲染错误兜底（诊断切片）
// 捕获子树渲染异常 → 上报诊断端点 → 显示可恢复的降级 UI（刷新按钮）。
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "../lib/report-client-error";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError({
      message: error.message,
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n---\n"),
      extra: { kind: "react-boundary" },
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-lg font-semibold">界面出现了一个错误</h1>
          <p className="max-w-md text-sm opacity-70">
            错误已自动记录，帮助我们定位问题。刷新页面通常可以恢复。
          </p>
          <button
            type="button"
            className="rounded border px-4 py-2 text-sm hover:bg-black/5"
            onClick={() => window.location.reload()}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
