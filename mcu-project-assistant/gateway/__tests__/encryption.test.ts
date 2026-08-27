import { describe, it, expect, beforeAll, afterAll } from "vitest";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-12345";
});

afterAll(() => {
  if (ORIGINAL_KEY) process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  else delete process.env.ENCRYPTION_KEY;
});

async function loadEncryption() {
  return await import("@/lib/encryption");
}

describe("encryption round-trip", () => {
  it("encrypts and decrypts a simple string", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "sk-abc123def456";
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypts and decrypts a long API key", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "sk-proj-" + "x".repeat(200);
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypts and decrypts an empty string", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const ciphertext = encrypt("");
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe("");
  });

  it("encrypts and decrypts unicode text (Chinese)", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "我的API密钥是安全的!";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypts and decrypts special characters", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });
});

describe("encryption security properties", () => {
  it("produces different ciphertext each time (IV random)", async () => {
    const { encrypt } = await loadEncryption();
    const plaintext = "sk-abc123";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);
    expect(c1).not.toBe(c2);
  });

  it("detects tampered ciphertext (wrong auth tag)", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "sk-secret-key";
    const ciphertext = encrypt(plaintext);
    const parts = ciphertext.split(":");
    const tampered = `ffffffffffffffffffffffffffffffff:${parts[1]}:${parts[2]}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("detects truncated ciphertext", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const ciphertext = encrypt("sk-test");
    const truncated = ciphertext.slice(0, -10);
    expect(() => decrypt(truncated)).toThrow();
  });

  it("detects corrupted encrypted payload", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "sk-secret";
    const ciphertext = encrypt(plaintext);
    const parts = ciphertext.split(":");
    const corrupted = `${parts[0]}:${parts[1]}:deadbeef`;
    expect(() => decrypt(corrupted)).toThrow();
  });
});

describe("encryption key management", () => {
  it("throws error when ENCRYPTION_KEY missing at call time", async () => {
    const savedKey = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import("@/lib/encryption");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY not configured");
    process.env.ENCRYPTION_KEY = savedKey;
  });
});

describe("encryption output format", () => {
  it("outputs colon-separated iv:authTag:payload format", async () => {
    const { encrypt } = await loadEncryption();
    const plaintext = "sk-test-format";
    const ciphertext = encrypt(plaintext);
    const parts = ciphertext.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toHaveLength(32);
    expect(parts[1]).toHaveLength(32);
  });
});

describe("cross-instance decryption", () => {
  it("decrypts correctly with same key across instances", async () => {
    const { encrypt, decrypt } = await loadEncryption();
    const plaintext = "sk-persistent-key-test";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });
});
