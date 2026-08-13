import { createHash } from "node:crypto";
import type { ArtifactVersion } from "@/src/domain/models/artifact";
import type { ArtifactContentPort } from "@/src/ports/artifact-content";

export type PersistenceIntegrityCode =
  | "database_integrity_failed"
  | "unsupported_database_schema"
  | "database_schema_incomplete"
  | "artifact_content_missing"
  | "artifact_content_hash_mismatch"
  | "artifact_content_unreadable"
  | "persisted_record_corrupt"
  | "idempotency_record_corrupt";

export class PersistenceIntegrityError extends Error {
  readonly code: PersistenceIntegrityCode;

  constructor(code: PersistenceIntegrityCode, message: string) {
    super(message);
    this.name = "PersistenceIntegrityError";
    this.code = code;
  }
}

export class IdempotencyRecordCorruptError extends PersistenceIntegrityError {
  constructor() {
    super("idempotency_record_corrupt", "Persisted idempotency record is corrupt");
    this.name = "IdempotencyRecordCorruptError";
  }
}

export class PersistedRecordCorruptError extends PersistenceIntegrityError {
  constructor(recordType: string, recordId: string, field: string) {
    super("persisted_record_corrupt", `Persisted ${recordType} record ${recordId} has invalid ${field}`);
    this.name = "PersistedRecordCorruptError";
  }
}

export class ArtifactContentMissingError extends PersistenceIntegrityError {
  constructor() {
    super("artifact_content_missing", "Referenced artifact content is missing");
    this.name = "ArtifactContentMissingError";
  }
}

export class ArtifactContentHashMismatchError extends PersistenceIntegrityError {
  constructor() {
    super("artifact_content_hash_mismatch", "Referenced artifact content failed integrity verification");
    this.name = "ArtifactContentHashMismatchError";
  }
}

export class ArtifactContentUnreadableError extends PersistenceIntegrityError {
  constructor() {
    super("artifact_content_unreadable", "Referenced artifact content is unreadable");
    this.name = "ArtifactContentUnreadableError";
  }
}

export class DatabaseIntegrityError extends PersistenceIntegrityError {
  constructor() {
    super("database_integrity_failed", "SQLite integrity check failed");
    this.name = "DatabaseIntegrityError";
  }
}

export class UnsupportedDatabaseSchemaError extends PersistenceIntegrityError {
  constructor() {
    super("unsupported_database_schema", "SQLite schema is newer than this application supports");
    this.name = "UnsupportedDatabaseSchemaError";
  }
}

export class IncompleteDatabaseSchemaError extends PersistenceIntegrityError {
  constructor() {
    super("database_schema_incomplete", "SQLite schema is incomplete");
    this.name = "IncompleteDatabaseSchemaError";
  }
}

export function parsePersistedJson<T>(
  value: string,
  recordType: string,
  recordId: string,
  field: string,
  isValid: (value: unknown) => value is T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PersistedRecordCorruptError(recordType, recordId, field);
  }
  if (!isValid(parsed)) throw new PersistedRecordCorruptError(recordType, recordId, field);
  return parsed;
}

export function parseIdempotencyResponse<T>(
  responseBodyJson: string,
  isValid: (value: unknown) => value is T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBodyJson);
  } catch {
    throw new IdempotencyRecordCorruptError();
  }
  if (!isValid(parsed)) throw new IdempotencyRecordCorruptError();
  return parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isDiagnosticArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item)) return false;
    return typeof item.code === "string" && typeof item.severity === "string" && typeof item.message === "string" &&
      (item.details === undefined || isRecord(item.details));
  });
}

export function isBuildOutputArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => {
    if (!isRecord(item)) return false;
    return typeof item.path === "string" && (item.kind === "bin" || item.kind === "elf" || item.kind === "hex") &&
      typeof item.sizeBytes === "number" && Number.isInteger(item.sizeBytes) && item.sizeBytes >= 0 && isSha256(item.sha256);
  });
}

export function isDecisionHistory(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((item) => isRecord(item) &&
    (item.status === "pending" || item.status === "accepted" || item.status === "rejected") && typeof item.at === "string");
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export async function loadVerifiedArtifactContent(
  version: ArtifactVersion,
  content: ArtifactContentPort,
): Promise<string> {
  let value: string;
  try {
    value = await content.load(version.contentRef);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) throw new ArtifactContentMissingError();
    throw new ArtifactContentUnreadableError();
  }

  let actualHash: string;
  try {
    actualHash = await content.hash(value);
  } catch {
    throw new ArtifactContentUnreadableError();
  }
  if (actualHash !== version.contentHash) throw new ArtifactContentHashMismatchError();
  return value;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
