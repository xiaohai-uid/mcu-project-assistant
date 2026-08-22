// shared-contracts/errors.ts — safe error DTO and stable code normalization.

export interface SafeError {
  code: string;
  message: string;
}

const SAFE_MESSAGES: Record<string, string> = {
  invalid_name: "Project name is invalid",
  invalid_kind: "Artifact kind is invalid",
  invalid_content: "Artifact content is invalid",
  invalid_description: "Description is invalid",
  invalid_capability: "Capability is invalid",
  invalid_mcu: "MCU selection is invalid",
  invalid_round: "Clarification round is invalid",
  invalid_analysis_state: "Analysis task is not in the required state",
  invalid_json: "Request body contains invalid JSON",
  invalid_request: "Request is invalid",
  payload_too_large: "Request body exceeds the supported size",
  input_too_large: "Input exceeds the supported size",
  serial_write_too_large: "Serial write exceeds the supported size",
  provider_response_too_large: "AI provider response exceeds the supported size",
  process_output_limit_exceeded: "External process output exceeds the supported size",
  subscriber_limit_reached: "Subscriber limit reached",
  resource_capacity_exceeded: "Resource capacity is currently exhausted",
  untrusted_origin: "Request origin is not trusted",
  untrusted_host: "Request host is not trusted",
  invalid_idempotency_key: "Idempotency-Key is invalid",
  idempotency_conflict: "Idempotency-Key was already used with a different request",
  not_found: "Requested resource was not found",
  conflict: "Request conflicts with the current state",
  internal: "Internal server error",
  provider_unavailable: "AI provider is unavailable",
  provider_timeout: "AI provider request timed out",
  provider_rate_limited: "AI provider rate limit or quota exceeded",
  provider_protocol_error: "AI provider returned an invalid response",
  unsupported_build_target: "Build target is unsupported",
  toolchain_unavailable: "Required firmware toolchain is unavailable",
  build_failed: "Firmware build failed",
  build_timeout: "Firmware build timed out",
  build_output_missing: "Firmware build produced no verified output",
  invalid_build_source: "Firmware build source is invalid",
  physical_tool_unavailable: "Physical programming tool is unavailable",
  physical_device_not_found: "Physical device was not found",
  physical_device_ambiguous: "Multiple physical devices matched",
  physical_device_changed: "The selected physical device changed",
  flash_build_not_verified: "Firmware build has not been verified",
  flash_firmware_missing: "Verified firmware artifact is missing",
  flash_firmware_hash_mismatch: "Firmware artifact hash does not match",
  flash_timeout: "Firmware flashing timed out",
  serial_session_not_open: "Serial session is not open",
  serial_device_not_found: "Serial device was not found",
  serial_device_changed: "The serial device changed",
  serial_transport_error: "Serial transport error",
  serial_line_too_large: "Serial line exceeded the supported size",
  outdated_proposal: "Proposal is based on an outdated artifact version",
  invalid_decision: "Decision is invalid",
  no_accepted_proposals: "No accepted proposals are available",
  no_hardware_selected: "No hardware has been selected",
  no_pin_map: "Pin map is required",
  no_stale: "No stale artifacts are available",
  blocking_stale: "Action is blocked by stale artifacts",
  invalid_build_state: "Build is not in the required state",
  build_not_failed: "Build has not failed",
  confirmation_missing: "Flash confirmation token is required",
  confirmation_invalid: "Flash confirmation token is invalid",
  confirmation_expired: "Flash confirmation token expired",
  token_reused: "Flash confirmation token was already used",
  device_mismatch: "Selected device does not match confirmation",
  device_disconnected: "Device is disconnected",
  device_busy: "Device is busy with another operation",
  physical_flash_blocked: "Physical flash was blocked",
  serial_session_not_found: "Serial session was not found",
  already_archived: "Project is already archived",
  archived_read_only: "Archived project is read-only",
  physical_flash_failed: "Physical firmware flashing failed",
  network_unavailable: "Local workspace server is unavailable",
  task_cancelled: "Task was cancelled",
  task_recovery_unsafe_replay: "Task cannot be safely replayed after restart",
  analysis_recovery_unsafe_replay: "Analysis was interrupted and cannot be safely replayed",
  build_recovery_orphaned: "Build record was interrupted before its task was durably linked",
  unknown: "An earlier task failure was recorded without a stable code",
  database_integrity_failed: "The local database failed its integrity check",
  unsupported_database_schema: "The local database schema is newer than this application supports",
  database_schema_incomplete: "The local database schema is incomplete",
  artifact_content_missing: "Referenced artifact content is missing",
  artifact_content_hash_mismatch: "Referenced artifact content failed integrity verification",
  artifact_content_unreadable: "Referenced artifact content is unreadable",
  persisted_record_corrupt: "A persisted record is corrupt",
  idempotency_record_corrupt: "A persisted idempotency record is corrupt",
  production_state_in_use: "Production state is already in use",
  server_draining: "Server is shutting down",
};

const CODE_ALIASES: Record<string, string> = {
  BUILD_TIMEOUT: "build_timeout",
  BUILD_OUTPUT_MISSING: "build_output_missing",
  BUILD_SOURCE_INVALID: "invalid_build_source",
  BUILD_TARGET_UNSUPPORTED: "unsupported_build_target",
  BUILD_START_FAILED: "build_failed",
  BUILD_FAILED: "build_failed",
  BUILD_EXECUTION_FAILED: "build_failed",
  BUILD_EXIT_NONZERO: "build_failed",
  PHYSICAL_TOOL_UNAVAILABLE: "physical_tool_unavailable",
  PHYSICAL_DEVICE_NOT_FOUND: "physical_device_not_found",
  PHYSICAL_DEVICE_AMBIGUOUS: "physical_device_ambiguous",
  PHYSICAL_DEVICE_CHANGED: "physical_device_changed",
  FLASH_BUILD_NOT_VERIFIED: "flash_build_not_verified",
  FLASH_FIRMWARE_MISSING: "flash_firmware_missing",
  FLASH_FIRMWARE_HASH_MISMATCH: "flash_firmware_hash_mismatch",
  FLASH_TIMEOUT: "flash_timeout",
  FLASH_EXIT_NONZERO: "physical_flash_failed",
  FLASH_CANCELLED: "task_cancelled",
  DEVICE_BUSY: "device_busy",
  SERIAL_SESSION_NOT_OPEN: "serial_session_not_open",
  SERIAL_DEVICE_NOT_FOUND: "serial_device_not_found",
  SERIAL_DEVICE_CHANGED: "serial_device_changed",
  SERIAL_LINE_TOO_LARGE: "serial_line_too_large",
  SERIAL_TRANSPORT_ERROR: "serial_transport_error",
  SERIAL_WRITE_TOO_LARGE: "serial_write_too_large",
  PROVIDER_RESPONSE_TOO_LARGE: "provider_response_too_large",
  PROCESS_OUTPUT_LIMIT_EXCEEDED: "process_output_limit_exceeded",
  SUBSCRIBER_LIMIT_REACHED: "subscriber_limit_reached",
  RESOURCE_CAPACITY_EXCEEDED: "resource_capacity_exceeded",
  TASK_CANCELLED: "task_cancelled",
  TASK_RECOVERY_UNSAFE_REPLAY: "task_recovery_unsafe_replay",
  ANALYSIS_RECOVERY_UNSAFE_REPLAY: "analysis_recovery_unsafe_replay",
  BUILD_RECOVERY_ORPHANED: "build_recovery_orphaned",
};

const KNOWN_CODES = new Set([
  ...Object.keys(SAFE_MESSAGES),
  "invalid_name", "invalid_kind", "invalid_content", "invalid_description", "invalid_capability", "invalid_mcu",
  "unknown_capability", "capability_forbidden",
  "invalid_round", "invalid_analysis_state", "outdated_proposal", "invalid_decision", "no_accepted_proposals",
  "no_hardware_selected", "no_pin_map", "no_stale", "blocking_stale", "invalid_build_state", "build_not_failed",
  "confirmation_missing", "confirmation_invalid", "confirmation_expired", "token_reused", "device_mismatch",
  "device_disconnected", "device_busy", "physical_flash_blocked", "physical_flash_failed", "serial_session_not_found",
  "already_archived", "archived_read_only", "network_unavailable",
  // 诊断切片：运营者边界与客户端上报限流
  "forbidden", "rate_limited",
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

export function normalizeErrorCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (SAFE_MESSAGES[value]) return value;
  if (CODE_ALIASES[value]) return CODE_ALIASES[value];
  if (KNOWN_CODES.has(value)) return value;
  const upper = value.toUpperCase();
  if (CODE_ALIASES[upper]) return CODE_ALIASES[upper];
  return null;
}

function codeFromError(error: unknown): string {
  const record = recordOf(error);
  const direct = normalizeErrorCode(record?.code);
  if (direct) return direct;
  const diagnostic = normalizeErrorCode(record?.diagnosticCode);
  if (diagnostic) return diagnostic;

  const name = typeof record?.name === "string" ? record.name : "";
  if (name === "ProviderUnavailableError") return "provider_unavailable";
  if (name === "ToolchainUnavailableError") return "toolchain_unavailable";
  if (name === "UnsupportedBuildTargetError") return "unsupported_build_target";
  if (name === "BuildTimeoutError") return "build_timeout";
  if (name === "PhysicalToolUnavailableError") return "physical_tool_unavailable";
  if (name === "SerialSessionNotOpenError") return "serial_session_not_open";
  if (name === "DeviceBusyError") return "device_busy";
  if (name === "AiProviderConfigurationError") return "invalid_request";

  if (typeof record?.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(record.code)) {
    return CODE_ALIASES[record.code] ?? "internal";
  }

  const message = typeof record?.message === "string" ? record.message : "";
  if (/^MCU_[A-Z0-9_]+\b/.test(message)) return "invalid_request";
  const token = message.match(/\b(BUILD_[A-Z_]+|FLASH_[A-Z_]+|SERIAL_[A-Z_]+|PHYSICAL_[A-Z_]+|TASK_[A-Z_]+)\b/);
  const fromMessage = normalizeErrorCode(token?.[1]);
  if (fromMessage) return fromMessage;
  if (/timeout/i.test(message)) return "provider_timeout";
  return "internal";
}

export function toSafeError(error: unknown): SafeError {
  const record = recordOf(error);
  const code = codeFromError(error);
  const fixedMessage = SAFE_MESSAGES[code];
  if (fixedMessage) return { code, message: fixedMessage };

  // ApiError messages are authored at the HTTP boundary and remain useful for
  // validation/resource errors. Unknown Error messages are never exposed.
  const isApiError = typeof record?.status === "number" && typeof record?.code === "string";
  if (isApiError && typeof record?.message === "string") return { code, message: record.message };
  return { code: "internal", message: SAFE_MESSAGES.internal ?? "Internal server error" };
}

export function serializeSafeError(error: unknown): string {
  return JSON.stringify(toSafeError(error));
}

export function parseSerializedError(value: string | null): SafeError | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const record = recordOf(parsed);
    if (typeof record?.code === "string" && typeof record?.message === "string") {
      const normalized = normalizeErrorCode(record.code);
      return normalized
        ? { code: normalized, message: safeMessageForCode(normalized) }
        : { code: "unknown", message: safeMessageForCode("unknown") };
    }
  } catch {
    // Legacy task rows used a plain string. Preserve them as explicitly legacy.
  }
  return { code: "unknown", message: value };
}

export function safeMessageForCode(code: string): string {
  return SAFE_MESSAGES[normalizeErrorCode(code) ?? code] ?? SAFE_MESSAGES.internal ?? "Internal server error";
}
