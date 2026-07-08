/**
 * Tests for search key resolver.
 * The search key resolver should return the decrypted search API key from the database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Top-level mocks
vi.mock("@/lib/database", () => ({
  db: { query: vi.fn() },
}));

vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((val: string) => "decrypted-" + val),
}));

describe("resolveDecryptedSearchKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returns decrypted search key when present", async () => {
    const db = await import("@/lib/database");
    const { resolveDecryptedSearchKey } = await import("@/lib/api-key-resolver");

    vi.spyOn(db.db, "query").mockResolvedValue({
      rows: [{ key_value_encrypted: "encrypted-search-key" }],
    });

    const result = await resolveDecryptedSearchKey("user-1");
    expect(result).toBe("decrypted-encrypted-search-key");
    // Verify query was called with search key type
    expect(db.db.query).toHaveBeenCalled();
    const [sql, params] = db.db.query.mock.calls[0];
    expect(sql).toContain("key_type = 'search'");
    expect(params).toEqual(["user-1"]);
  });

  it("returns undefined when no search key exists", async () => {
    const db = await import("@/lib/database");
    const { resolveDecryptedSearchKey } = await import("@/lib/api-key-resolver");

    vi.spyOn(db.db, "query").mockResolvedValue({ rows: [] });

    const result = await resolveDecryptedSearchKey("user-1");
    expect(result).toBeUndefined();
  });

  it("returns undefined and logs warning when decrypt fails", async () => {
    const db = await import("@/lib/database");
    const encryption = await import("@/lib/encryption");
    const { resolveDecryptedSearchKey } = await import("@/lib/api-key-resolver");
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.spyOn(db.db, "query").mockResolvedValue({
      rows: [{ key_value_encrypted: "corrupted-key" }],
    });
    vi.spyOn(encryption, "decrypt").mockImplementation(() => {
      throw new Error("Decrypt failed");
    });

    const result = await resolveDecryptedSearchKey("user-1");
    expect(result).toBeUndefined();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to decrypt search API key for user user-1")
    );
  });
});