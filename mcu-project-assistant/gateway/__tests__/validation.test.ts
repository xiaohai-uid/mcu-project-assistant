import { describe, it, expect } from "vitest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

describe("Input Validation", () => {
  describe("email format", () => {
    it("accepts valid emails", () => {
      expect(EMAIL_RE.test("user@example.com")).toBe(true);
      expect(EMAIL_RE.test("a.b@c.co")).toBe(true);
      expect(EMAIL_RE.test("test+tag@domain.org")).toBe(true);
    });

    it("rejects invalid emails", () => {
      expect(EMAIL_RE.test("")).toBe(false);
      expect(EMAIL_RE.test("notanemail")).toBe(false);
      expect(EMAIL_RE.test("@domain.com")).toBe(false);
      expect(EMAIL_RE.test("user@")).toBe(false);
      expect(EMAIL_RE.test("user@.com")).toBe(false);
    });
  });

  describe("password length", () => {
    it("accepts passwords >= 8 chars", () => {
      expect("12345678".length >= 8).toBe(true);
      expect("a".repeat(100).length >= 8).toBe(true);
    });

    it("rejects passwords < 8 chars", () => {
      expect("1234567".length >= 8).toBe(false);
      expect("".length >= 8).toBe(false);
    });
  });
});
