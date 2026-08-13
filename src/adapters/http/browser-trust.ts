// adapters/http/browser-trust.ts — localhost browser-origin boundary
// Explicit browser origins are limited to the current loopback listener. Requests
// without Origin remain available to local non-browser operators, but still need
// a trusted Host. This is a source/transport guard, not an authentication system.
import type { NextFunction, Request, Response } from "express";

export type BrowserTrustFailure = "untrusted_host" | "untrusted_origin";

export interface BrowserTrustResult {
  ok: true;
  origin: string | null;
  host: string;
  port: number;
}

interface ParsedAuthority {
  hostname: string;
  port: number;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const TRUSTED_ORIGIN_MESSAGE = "Request origin is not trusted";
const TRUSTED_HOST_MESSAGE = "Request host is not trusted";

function localPort(req: Request): number | null {
  const port = req.socket.localPort;
  return typeof port === "number" && Number.isInteger(port) && port > 0 ? port : null;
}

function parseAuthority(raw: string, fallbackPort: number | null): ParsedAuthority | null {
  if (!raw || /[\s/?#@]/.test(raw)) return null;
  const separator = raw.lastIndexOf(":");
  const hasPort = separator > -1;
  const hostname = (hasPort ? raw.slice(0, separator) : raw).toLowerCase();
  const rawPort = hasPort ? raw.slice(separator + 1) : "";
  if (!LOOPBACK_HOSTNAMES.has(hostname)) return null;
  if (hasPort && !/^\d+$/.test(rawPort)) return null;
  const port = hasPort ? Number(rawPort) : fallbackPort;
  if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname, port };
}

function parseHostHeader(req: Request): ParsedAuthority | null {
  const raw = req.header("host");
  if (!raw) return null;
  // Non-default listener ports must be explicit in Host. Falling back to the
  // socket port for a missing authority would accept an ambiguous Host header.
  const listenerPort = localPort(req);
  const fallbackPort = listenerPort === null || listenerPort === 80 ? 80 : null;
  return parseAuthority(raw, fallbackPort);
}

function parseOrigin(raw: string, port: number): boolean {
  try {
    const origin = new URL(raw);
    if (origin.protocol !== "http:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
    if (!LOOPBACK_HOSTNAMES.has(origin.hostname.toLowerCase())) return false;
    const originPort = origin.port ? Number(origin.port) : 80;
    return originPort === port;
  } catch {
    return false;
  }
}

export function validateBrowserTrust(req: Request): BrowserTrustResult | { ok: false; failure: BrowserTrustFailure } {
  // This process is not behind a trusted proxy. Reject forwarded authority
  // metadata instead of letting intermediary-supplied data redefine the
  // listener boundary.
  if (req.header("x-forwarded-host") !== undefined) return { ok: false, failure: "untrusted_host" };
  const host = parseHostHeader(req);
  if (!host) return { ok: false, failure: "untrusted_host" };
  const port = localPort(req) ?? host.port;
  if (host.port !== port) return { ok: false, failure: "untrusted_host" };

  const origin = req.header("origin");
  if (origin !== undefined && (!parseOrigin(origin, port))) {
    return { ok: false, failure: "untrusted_origin" };
  }
  return { ok: true, origin: origin ?? null, host: host.hostname, port };
}

function failureResponse(res: Response, failure: BrowserTrustFailure): void {
  if (failure === "untrusted_origin") {
    res.status(403).json({ error: { code: "untrusted_origin", message: TRUSTED_ORIGIN_MESSAGE } });
    return;
  }
  res.status(403).json({ error: { code: "untrusted_host", message: TRUSTED_HOST_MESSAGE } });
}

export function browserTrustMiddleware(req: Request, res: Response, next: NextFunction): void {
  const result = validateBrowserTrust(req);
  if (!result.ok) {
    failureResponse(res, result.failure);
    return;
  }

  res.vary("Origin");
  if (result.origin !== null) res.setHeader("Access-Control-Allow-Origin", result.origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key");
    res.status(204).end();
    return;
  }
  next();
}
