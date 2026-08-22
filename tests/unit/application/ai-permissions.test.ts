// unit/application/ai-permissions — R4 权限三级表不变量（应用架构评审 2026-08-22）
import { describe, expect, it } from "vitest";
import {
  AI_FORBIDDEN_OPERATIONS,
  AI_PERMISSION_TABLE,
  aiPermissionFor,
} from "@/src/application/ai-permissions";

describe("ai permissions table", () => {
  it("covers exactly the six registered command capabilities", () => {
    expect(AI_PERMISSION_TABLE.map((entry) => entry.capability).sort()).toEqual(
      [
        "analyze_requirement",
        "generate_firmware",
        "generate_pin_map",
        "recommend_mcu",
        "revalidate_artifact",
        "select_mcu",
      ].sort(),
    );
  });

  it("never grants auto-readonly to a write-path capability", () => {
    const readonly = AI_PERMISSION_TABLE.filter((entry) => entry.tier === "auto-readonly").map((entry) => entry.capability);
    expect(readonly).toEqual(["recommend_mcu"]);
  });

  it("forbids physical and irreversible operations from the command surface", () => {
    const forbidden = AI_FORBIDDEN_OPERATIONS.map((entry) => entry.capability);
    expect(forbidden).toContain("flash_device");
    expect(forbidden).toContain("archive_project");
    expect(forbidden).toContain("modify_accepted_version");
  });

  it("returns null for unregistered capabilities so callers can fail closed", () => {
    expect(aiPermissionFor("delete_everything")).toBeNull();
    expect(aiPermissionFor("")).toBeNull();
  });

  it("resolves registered tiers", () => {
    expect(aiPermissionFor("recommend_mcu")).toBe("auto-readonly");
    expect(aiPermissionFor("generate_firmware")).toBe("proposal-required");
    expect(aiPermissionFor("flash_device")).toBe("forbidden");
  });
});
