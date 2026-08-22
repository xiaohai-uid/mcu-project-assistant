// tests/unit/shared/client-rate-limit.test.ts — ISSUE-002：限流键信任根 + 有界窗口计数器
import { describe, expect, it } from "vitest";
import {
  createClientRateLimiter,
  normalizeIp,
  resolveClientAddress,
} from "@/src/shared/client-rate-limit";

describe("normalizeIp", () => {
  it("strips the IPv4-mapped IPv6 prefix and lowercases", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("resolveClientAddress — socket remote address is the trust root", () => {
  const spoofed = {
    remoteAddress: "::ffff:203.0.113.9",
    forwardedFor: "198.51.100.1, 198.51.100.2",
  };

  it("ignores a forged XFF chain entirely when no trusted proxy is declared", () => {
    expect(resolveClientAddress(spoofed, [])).toBe("203.0.113.9");
  });

  it("falls back to unknown only when the socket has no address", () => {
    expect(resolveClientAddress({ remoteAddress: undefined }, [])).toBe("unknown");
  });

  it("walks the XFF chain right-to-left past declared trusted proxies", () => {
    // 反代 10.0.0.2 追加真实客户端地址；链左端是客户端可伪造的噪声
    expect(
      resolveClientAddress(
        { remoteAddress: "10.0.0.2", forwardedFor: "198.51.100.1, 198.51.100.2, 203.0.113.7" },
        ["10.0.0.2"],
      ),
    ).toBe("203.0.113.7");
  });

  it("skips every trusted hop in a multi-level proxy chain", () => {
    expect(
      resolveClientAddress(
        { remoteAddress: "10.0.0.3", forwardedFor: "spoofed.example, 203.0.113.7, 10.0.0.2" },
        ["10.0.0.2", "10.0.0.3"],
      ),
    ).toBe("203.0.113.7");
  });

  it("normalizes IPv4-mapped hops before trusting them", () => {
    expect(
      resolveClientAddress(
        { remoteAddress: "::ffff:10.0.0.2", forwardedFor: "203.0.113.7" },
        ["10.0.0.2"],
      ),
    ).toBe("203.0.113.7");
  });

  it("returns the socket address when every hop is trusted or the header is absent", () => {
    expect(
      resolveClientAddress({ remoteAddress: "10.0.0.2", forwardedFor: "10.0.0.2" }, ["10.0.0.2"]),
    ).toBe("10.0.0.2");
    expect(resolveClientAddress({ remoteAddress: "10.0.0.2", forwardedFor: "" }, ["10.0.0.2"])).toBe(
      "10.0.0.2",
    );
  });

  it("honors XFF only when the socket peer itself is a declared trusted proxy", () => {
    // 直连源站的对端不在可信列表——即使配置了可信反代，伪造链也必须被整体忽略
    expect(
      resolveClientAddress(
        { remoteAddress: "198.51.100.50", forwardedFor: "203.0.113.7" },
        ["10.0.0.2"],
      ),
    ).toBe("198.51.100.50");
    expect(
      resolveClientAddress({ remoteAddress: "::1", forwardedFor: "203.0.113.7, ::1" }, []),
    ).toBe("::1");
  });
});

describe("createClientRateLimiter — bounded fixed window", () => {
  it("allows up to the limit within one window and rejects beyond it", () => {
    const limiter = createClientRateLimiter({ limit: 3, windowMs: 600_000, maxKeys: 100 });
    for (let i = 0; i < 3; i += 1) expect(limiter.take("a", 1_000)).toBe(true);
    expect(limiter.take("a", 1_000)).toBe(false);
    expect(limiter.size()).toBe(1);
  });

  it("opens a fresh window after expiry", () => {
    const limiter = createClientRateLimiter({ limit: 2, windowMs: 600_000, maxKeys: 100 });
    limiter.take("a", 1_000);
    limiter.take("a", 1_000);
    expect(limiter.take("a", 1_000)).toBe(false);
    expect(limiter.take("a", 601_001)).toBe(true);
  });

  it("lazily drops expired entries on write so the map cannot retain stale keys forever", () => {
    const limiter = createClientRateLimiter({ limit: 1, windowMs: 600_000, maxKeys: 100 });
    for (let i = 0; i < 50; i += 1) limiter.take(`stale-${i}`, 1_000);
    expect(limiter.size()).toBe(50);
    // 窗口全过期后，任意一次写入都触发清理
    expect(limiter.take("fresh", 700_000)).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("never exceeds maxKeys even under sustained distinct-key pressure", () => {
    const limiter = createClientRateLimiter({ limit: 5, windowMs: 600_000, maxKeys: 32 });
    for (let i = 0; i < 500; i += 1) limiter.take(`peer-${i}`, 1_000);
    expect(limiter.size()).toBeLessThanOrEqual(32);
  });

  it("keeps counting correctly when eviction removes the oldest key", () => {
    const limiter = createClientRateLimiter({ limit: 5, windowMs: 600_000, maxKeys: 4 });
    for (let i = 0; i < 6; i += 1) limiter.take(`peer-${i}`, 1_000);
    expect(limiter.size()).toBe(4);
    // 幸存键 peer-5 窗口内计数保持连续，未因淘汰受扰
    expect(limiter.take("peer-5", 1_000)).toBe(true);
    // 被淘汰的 peer-0 重新插入即开新窗口
    expect(limiter.take("peer-0", 1_000)).toBe(true);
    expect(limiter.size()).toBe(4);
  });

  it("refreshes recency on access so active keys survive eviction pressure (LRU)", () => {
    const limiter = createClientRateLimiter({ limit: 5, windowMs: 600_000, maxKeys: 3 });
    limiter.take("hot", 1_000);
    limiter.take("a", 1_000);
    limiter.take("b", 1_000);
    limiter.take("hot", 1_000); // 触碰后 hot 成为最近使用
    limiter.take("c", 1_000); // 淘汰最久未用的 a
    limiter.take("d", 1_000); // 淘汰 b
    expect(limiter.size()).toBe(3);
    expect(limiter.take("hot", 1_000)).toBe(true); // 计数保持连续（3 ≤ 5）
  });
});
