import { useEffect, useState, type FormEvent, type ReactNode } from "react";

interface AuthGateProps {
  children: ReactNode;
}

interface SessionResponse {
  authenticated?: boolean;
}

interface ErrorResponse {
  error?: { message?: string };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export function AuthGate({ children }: AuthGateProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/auth/session", { credentials: "same-origin" })
      .then((response) => readJson<SessionResponse>(response))
      .then((session) => {
        if (active) setAuthenticated(session.authenticated === true);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await readJson<SessionResponse & ErrorResponse>(response);
      if (!response.ok || body.authenticated !== true) {
        setError(body.error?.message ?? "登录失败，请检查账号和密码");
        return;
      }
      setPassword("");
      setAuthenticated(true);
    } catch {
      setError("无法连接到工作区服务");
    } finally {
      setSubmitting(false);
    }
  }

  if (authenticated === null) {
    return <div className="min-h-screen flex items-center justify-center bg-[var(--canvas-bg)] text-[var(--text-secondary)]">正在连接工作区…</div>;
  }

  if (authenticated) return <>{children}</>;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--canvas-bg)] px-6 text-[var(--text-primary)]">
      <form onSubmit={submit} className="w-full max-w-sm mac-card p-6 shadow-xl" aria-label="内测登录">
        <div className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">MCU Project Assistant</p>
          <h1 className="mt-2 text-xl font-semibold">进入内测工作区</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">请使用内测账号登录，不会再弹出浏览器原生认证框。</p>
        </div>
        <label className="block text-sm font-medium" htmlFor="mcu-login-username">账号</label>
        <input
          id="mcu-login-username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-2 mb-4 w-full rounded-md border border-[var(--panel-border)] bg-[var(--panel-solid)] px-3 py-2 text-sm outline-none focus:border-[#007aff]"
          required
        />
        <label className="block text-sm font-medium" htmlFor="mcu-login-password">密码</label>
        <input
          id="mcu-login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-md border border-[var(--panel-border)] bg-[var(--panel-solid)] px-3 py-2 text-sm outline-none focus:border-[#007aff]"
          required
        />
        {error && <p className="mt-3 text-sm text-rose-500" role="alert">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-5 w-full mac-button-primary rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60">
          {submitting ? "登录中…" : "进入工作区"}
        </button>
      </form>
    </main>
  );
}
