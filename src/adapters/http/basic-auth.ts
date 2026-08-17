// adapters/http/basic-auth.ts — optional Basic Auth perimeter for internal deployments
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

const AUTHENTICATION_REQUIRED = "Authentication required";

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

function unauthorized(req: Request, res: Response): void {
  res.setHeader("WWW-Authenticate", 'Basic realm="MCU Project Assistant", charset="UTF-8"');
  res.setHeader("Cache-Control", "no-store");
  if (req.path.startsWith("/api")) {
    res.status(401).json({ error: { code: "authentication_required", message: AUTHENTICATION_REQUIRED } });
    return;
  }
  res.status(401).type("text/plain").send(AUTHENTICATION_REQUIRED + "\n");
}

export function createBasicAuthMiddleware(credentials: BasicAuthCredentials | null | undefined): RequestHandler {
  if (!credentials) return (_req: Request, _res: Response, next: NextFunction) => next();

  return (req, res, next) => {
    const provided = parseAuthorization(req.header("authorization"));
    if (!provided || !safeEqual(provided.username, credentials.username) || !safeEqual(provided.password, credentials.password)) {
      unauthorized(req, res);
      return;
    }
    next();
  };
}
