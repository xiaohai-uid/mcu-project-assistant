// adapters/http/basic-auth.ts — optional Basic Auth perimeter for internal deployments
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

const AUTHENTICATION_REQUIRED = "Authentication required";
const INVALID_CREDENTIALS = "Invalid credentials";
const SESSION_COOKIE = "mcu_session";
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseAuthorization(value: string | undefined): BasicAuthCredentials | null {
  if (!value) return null;
  const match = /^Basic\s+([^\s]+)$/i.exec(value);
  const encoded = match?.[1];
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

function parseCookie(value: string | undefined, name: string): string | null {
  if (!value) return null;
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}

function isSecureRequest(req: Request): boolean {
  return req.secure || req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim() === "https";
}

export interface BrowserSessionAuth {
  isValid(req: Request): boolean;
  login(req: Request, res: Response, username: string, password: string): boolean;
  clear(res: Response, req?: Request): void;
}

export function createBrowserSessionAuth(credentials: BasicAuthCredentials | null | undefined): BrowserSessionAuth {
  const signingSecret = credentials ? `${credentials.username}\u0000${credentials.password}` : "local-session";

  const signatureFor = (payload: string): string => createHmac("sha256", signingSecret).update(payload, "utf8").digest("base64url");

  const setCookie = (res: Response, value: string, req?: Request, maxAge = SESSION_MAX_AGE_SECONDS): void => {
    const secure = req && isSecureRequest(req) ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  };

  return {
    isValid(req) {
      if (!credentials) return true;
      const raw = parseCookie(req.header("cookie"), SESSION_COOKIE);
      if (!raw) return false;
      const separator = raw.lastIndexOf(".");
      if (separator < 1) return false;
      const payload = raw.slice(0, separator);
      const signature = raw.slice(separator + 1);
      const issuedAt = Number(payload.split(".", 1)[0]);
      if (!Number.isInteger(issuedAt) || issuedAt <= 0 || Math.floor(Date.now() / 1000) - issuedAt > SESSION_MAX_AGE_SECONDS) return false;
      return safeEqual(signature, signatureFor(payload));
    },
    login(req, res, username, password) {
      if (credentials && (!safeEqual(username, credentials.username) || !safeEqual(password, credentials.password))) return false;
      const payload = `${Math.floor(Date.now() / 1000)}.${randomUUID()}`;
      setCookie(res, `${payload}.${signatureFor(payload)}`, req);
      return true;
    },
    clear(res, req) {
      setCookie(res, "", req, 0);
    },
  };
}

function unauthorized(req: Request, res: Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="MCU Project Assistant", charset="UTF-8"');
  res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api")) {
    res.status(401).json({ error: { code: "authentication_required", message: AUTHENTICATION_REQUIRED } });
    return;
  }
  res.status(401).type("text/plain").send(AUTHENTICATION_REQUIRED + "\n");
}

export function createBasicAuthMiddleware(credentials: BasicAuthCredentials | null | undefined, sessions?: BrowserSessionAuth): RequestHandler {
  if (!credentials) return (_req: Request, _res: Response, next: NextFunction) => next();

  return (req, res, next) => {
    if (sessions?.isValid(req)) {
      next();
      return;
    }
    const provided = parseAuthorization(req.header("authorization"));
    if (!provided || !safeEqual(provided.username, credentials.username) || !safeEqual(provided.password, credentials.password)) {
      unauthorized(req, res);
      return;
    }
    next();
  };
}

export function invalidCredentials(res: Response): void {
  res.status(401).json({ error: { code: "invalid_credentials", message: INVALID_CREDENTIALS } });
}

/**
 * 操作员专用判定：只接受 Authorization: Basic 头，不接受网页会话 Cookie。
 * 用于诊断/运营端点——公网内测用户只有 Cookie，天然被挡在外面。
 * 未配置凭据（本地单机）视为操作员本机。
 */
export function hasOperatorBasicCredentials(req: Request, credentials: BasicAuthCredentials | null | undefined): boolean {
  if (!credentials) return true;
  const provided = parseAuthorization(req.header("authorization"));
  if (!provided) return false;
  return safeEqual(provided.username, credentials.username) && safeEqual(provided.password, credentials.password);
}
