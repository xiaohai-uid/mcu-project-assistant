import { createHash } from "node:crypto";

export interface IdempotencyRequest {
  scope: string;
  key: string;
  requestHash: string;
  createdAt: string;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestHash: string;
  responseStatus: number;
  responseBodyJson: string;
  createdAt: string;
}

export type IdempotencyClaim =
  | { kind: "new" }
  | { kind: "replay"; record: IdempotencyRecord }
  | { kind: "conflict"; record: IdempotencyRecord };

export class InvalidIdempotencyKeyError extends Error {
  readonly code = "invalid_idempotency_key";
  constructor() {
    super("Idempotency-Key must be 1-128 printable ASCII characters");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict";
  constructor() {
    super("Idempotency-Key was already used with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export function parseIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^[\x21-\x7e]{1,128}$/.test(value)) throw new InvalidIdempotencyKeyError();
  return value;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers cannot be canonicalized");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  if (value === undefined) return null;
  throw new TypeError("Unsupported value cannot be canonicalized");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function makeIdempotencyRequest(
  headerValue: string | undefined,
  scope: string,
  payload: unknown,
  createdAt: string,
): IdempotencyRequest | undefined {
  const key = parseIdempotencyKey(headerValue);
  return key === null ? undefined : { scope, key, requestHash: hashCanonical(payload), createdAt };
}
