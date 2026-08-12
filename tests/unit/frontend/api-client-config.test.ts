import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production frontend API endpoint contract", () => {
  it("uses same-origin relative API paths and has no production localhost fallback", () => {
    const client = readFileSync(resolve(process.cwd(), "app/src/api/client.ts"), "utf8");

    expect(client).toContain("fetch(path, init)");
    expect(client).not.toMatch(/https?:\/\//i);
    expect(client).not.toContain("localhost");
    expect(client).not.toContain("127.0.0.1");
    expect(client).not.toContain("VITE_API");
  });
});
