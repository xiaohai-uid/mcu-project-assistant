import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import packageJson from "../../../package.json";

describe("repository Node.js runtime contract", () => {
  const root = resolve(process.cwd());

  it("declares Node.js 20.x in package metadata and the version file", () => {
    const nvmrc = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();

    expect(packageJson.engines?.node).toBe("20.x");
    expect(nvmrc).toBe("20");
  });

  it("keeps the documented prerequisite and CI runtime aligned", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf8");
    const ci = readFileSync(resolve(root, ".github", "workflows", "ci.yml"), "utf8");

    expect(readme).toContain("Node.js 20.x");
    expect(ci).toMatch(/node-version:\s*20(?:\s|$)/);
  });
});
