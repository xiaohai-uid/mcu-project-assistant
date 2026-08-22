// shared/client-rate-limit.ts — ISSUE-002：面向公测暴露面的限流原语。
// 信任根是 socket 远端地址；X-Forwarded-For 仅在部署显式声明可信反代后，
// 从链右端向左跳过可信跳，取第一个非可信跳作为客户端键。

export function normalizeIp(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
}

export interface ClientAddressInput {
  remoteAddress?: string;
  forwardedFor?: string;
}

export function resolveClientAddress(
  input: ClientAddressInput,
  trustedProxies: readonly string[],
): string {
  const remote = input.remoteAddress ? normalizeIp(input.remoteAddress) : "unknown";
  if (!input.forwardedFor || trustedProxies.length === 0) return remote;
  const trusted = new Set(trustedProxies.map(normalizeIp));
  // 只有当直连对端本身就是可信反代时 XFF 链才可信；否则绕过反代直连源站的
  // 客户端可以用轮换伪造头击穿限流——正是 ISSUE-002 要禁止的攻击。
  if (!trusted.has(remote)) return remote;
  const hops = input.forwardedFor.split(",").map(normalizeIp).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]!;
    if (!trusted.has(hop)) return hop;
  }
  return remote;
}

export interface ClientRateLimiter {
  /** Consume one slot for `key`; false means the caller must be rejected. */
  take(key: string, nowMs?: number): boolean;
  /** Witness for the hard-cap invariant (regression tests / ops checks); production flow must not branch on it. */
  size(): number;
}

/**
 * Fixed-window counter with a hard key cap. Expired entries are swept lazily
 * on the insert path only (hot keys stay O(1)); when live keys would exceed
 * `maxKeys`, the least-recently-*used* key is evicted first, so resident
 * memory has a deterministic bound without letting fresh-key floods reset an
 * active client's counter.
 */
export function createClientRateLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys: number;
}): ClientRateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return {
    take(key: string, nowMs = Date.now()): boolean {
      const hit = hits.get(key);
      if (hit && hit.resetAt > nowMs) {
        hit.count += 1;
        hits.delete(key);
        hits.set(key, hit); // LRU: 刷新使用序，活跃键不被新键洪水淘汰
        return hit.count <= options.limit;
      }
      if (hit) hits.delete(key); // expired: re-insert below with fresh order
      for (const [k, v] of hits) {
        if (v.resetAt <= nowMs) hits.delete(k);
      }
      while (hits.size >= options.maxKeys) {
        const oldest = hits.keys().next();
        if (oldest.done) break;
        hits.delete(oldest.value);
      }
      hits.set(key, { count: 1, resetAt: nowMs + options.windowMs });
      return true;
    },
    size: () => hits.size,
  };
}
