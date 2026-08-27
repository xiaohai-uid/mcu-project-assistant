import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/database", () => ({
  db: {
    query: vi.fn(),
  },
}));

describe("resolveDecryptedApiKey", () => {
  let resolveDecryptedApiKey: typeof import("@/lib/api-key-resolver").resolveDecryptedApiKey;
  let dbQuerySpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-12345";
    ({ resolveDecryptedApiKey } = await import("@/lib/api-key-resolver"));

    const db = await import("@/lib/database");
    dbQuerySpy = vi.spyOn(db.db, "query");
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns decrypted key on success", async () => {
    const encryption = await import("@/lib/encryption");
    const decryptSpy = vi.spyOn(encryption, "decrypt").mockReturnValue("sk-decrypted-key");

    dbQuerySpy.mockResolvedValue({
      rows: [{ key_value_encrypted: "valid-encrypted-string" }],
    });

    const result = await resolveDecryptedApiKey("user-1");
    expect(result).toBe("sk-decrypted-key");
    expect(decryptSpy).toHaveBeenCalledWith("valid-encrypted-string");
  });

  it("returns undefined when no active key is found", async () => {
    dbQuerySpy.mockResolvedValue({ rows: [] });

    const result = await resolveDecryptedApiKey("user-2");
    expect(result).toBeUndefined();
  });

  it("returns undefined and logs warning when decrypt fails (corrupted key)", async () => {
    const encryption = await import("@/lib/encryption");
    const decryptSpy = vi.spyOn(encryption, "decrypt");
    decryptSpy.mockImplementation(() => {
      throw new Error("Invalid auth tag");
    });

    dbQuerySpy.mockResolvedValue({
      rows: [{ key_value_encrypted: "corrupted-data" }],
    });

    const result = await resolveDecryptedApiKey("user-3");
    expect(result).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to decrypt API key for user user-3")
    );
  });

  it("falls back to free API when key is corrupted", async () => {
    const encryption = await import("@/lib/encryption");
    vi.spyOn(encryption, "decrypt").mockImplementation(() => {
      throw new Error("MAC mismatch");
    });

    dbQuerySpy.mockResolvedValue({
      rows: [{ key_value_encrypted: "tampered" }],
    });

    const result = await resolveDecryptedApiKey("user-4");
    expect(result).toBeUndefined();
  });
});