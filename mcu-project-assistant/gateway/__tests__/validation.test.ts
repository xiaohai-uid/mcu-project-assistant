import { describe, it, expect } from "vitest";
import { isValidEmail, isValidPassword } from "@/lib/validation";

describe("Input Validation", () => {
  describe("isValidEmail", () => {
    it("accepts valid emails", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("a.b@c.co")).toBe(true);
      expect(isValidEmail("test+tag@domain.org")).toBe(true);
    });

    it("rejects invalid emails", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("notanemail")).toBe(false);
      expect(isValidEmail("@domain.com")).toBe(false);
      expect(isValidEmail("user@")).toBe(false);
      expect(isValidEmail("user@.com")).toBe(false);
    });
  });

  describe("isValidPassword", () => {
    it("accepts passwords >= 8 chars", () => {
      expect(isValidPassword("12345678")).toBe(true);
      expect(isValidPassword("a".repeat(100))).toBe(true);
    });

    it("rejects passwords < 8 chars", () => {
      expect(isValidPassword("1234567")).toBe(false);
      expect(isValidPassword("")).toBe(false);
    });
  });
});
