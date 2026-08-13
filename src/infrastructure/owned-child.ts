import { spawn, type ChildProcess } from "node:child_process";

/**
 * A process-local owner for one external operation child.
 *
 * The owner is deliberately a tiny node process with an IPC channel back to
 * this server. If the server is hard-killed, the channel disconnects and the
 * owner terminates only the child tree it started. This avoids process-name
 * scans and keeps normal cancellation operation-local.
 */
const OWNER_SOURCE = String.raw`
const { spawn } = require("node:child_process");
let child = null;
let stopping = false;
let stopTimer = null;

function killTree(force) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    if (force) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      try { child.kill("SIGKILL"); } catch {}
    } else {
      try { child.kill("SIGTERM"); } catch {}
    }
    return;
  }
  try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM"); }
  catch { try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {} }
}

function stopOwner() {
  if (stopping) return;
  stopping = true;
  killTree(true);
  if (!child) { process.exit(1); return; }
  // The exact child has already received a forceful termination request. Do
  // not keep the caller waiting on stream-close ordering during cancellation.
  stopTimer = setTimeout(() => process.exit(1), 100);
}

process.on("disconnect", stopOwner);
process.on("SIGTERM", stopOwner);
process.on("SIGINT", stopOwner);
process.on("message", (message) => {
  if (!message) return;
  if (message.type === "stop") { stopOwner(); return; }
  if (message.type !== "start" || child) return;
  child = spawn(message.command, message.args, {
    cwd: message.cwd,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout && child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr && child.stderr.on("data", (data) => process.stderr.write(data));
  child.on("error", (error) => {
    process.stderr.write(String(error && error.message ? error.message : error) + "\\n");
  });
  child.on("close", (code) => {
    if (stopTimer) clearTimeout(stopTimer);
    process.exit(stopping ? 1 : (code == null ? 1 : code));
  });
});
`;

export interface OwnedChildOptions {
  command: string;
  args: string[];
  cwd: string;
}

export function spawnOwnedChild(options: OwnedChildOptions): ChildProcess {
  const owner = spawn(process.execPath, ["-e", OWNER_SOURCE], {
    cwd: options.cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const start = (): void => {
    if (!owner.connected) return;
    owner.send({ type: "start", command: options.command, args: options.args, cwd: options.cwd }, (error) => {
      if (error) owner.kill();
    });
  };
  owner.once("spawn", start);
  return owner;
}

/** Ask the owner to terminate its exact child tree before falling back to a process signal. */
export function stopOwnedChild(owner: ChildProcess, force = false): void {
  if (process.platform === "win32" && owner.pid) {
    // The owner is the root of this operation's private process tree. Kill
    // exactly that tree so Windows does not wait for the grandchild to close.
    spawn("taskkill", ["/PID", String(owner.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  if (owner.connected) {
    owner.send({ type: "stop", force }, () => undefined);
    return;
  }
  if (force) owner.kill("SIGKILL");
  else owner.kill("SIGTERM");
}
