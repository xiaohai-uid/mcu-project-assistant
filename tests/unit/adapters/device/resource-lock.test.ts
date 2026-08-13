import { describe, expect, it } from "vitest";
import { createResourceLock } from "@/src/adapters/device/resource-lock";

describe("device resource lease", () => {
  it("allows one owner, protects the next owner, and releases idempotently", () => {
    const lock = createResourceLock();
    const first = lock.tryAcquire("device:1", "first");
    expect(first).toMatchObject({ key: "device:1", ownerId: "first" });
    expect(lock.tryAcquire("device:1", "second")).toBeNull();
    first?.release();
    first?.release();
    const second = lock.tryAcquire("device:1", "second");
    expect(second).toMatchObject({ key: "device:1", ownerId: "second" });
    second?.release();
  });

  it("cannot release another owner's replacement lease", () => {
    const lock = createResourceLock();
    const first = lock.tryAcquire("device:1", "first");
    first?.release();
    const second = lock.tryAcquire("device:1", "second");
    first?.release();
    expect(lock.tryAcquire("device:1", "third")).toBeNull();
    second?.release();
    expect(lock.tryAcquire("device:1", "third")).not.toBeNull();
  });
});
