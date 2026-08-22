// unit/domain/knowledge/platform-provenance — V1 审计的永久锁
// spec 实现决策："其他平台不能以未经核验的静态事实参与首发推荐或商业就绪判断"。
// 任何平台想进入候选矩阵（candidateTier），必须携带 objectLevel + source + facts，
// 且每条事实的 confidence 必须是官方系（official-direct / official-index / measured）。
import { describe, expect, it } from "vitest";
import { createPlatformRegistry } from "@/src/domain/knowledge/platforms";

const OFFICIAL_CONFIDENCE = new Set(["official-direct", "official-index", "measured"]);

describe("platform candidate matrix provenance (spec line 64)", () => {
  const registry = createPlatformRegistry();
  const candidates = registry.allIds
    .map((id) => registry.get(id))
    .filter((p) => p.candidateTier !== undefined);

  it("only contains platforms with complete official provenance", () => {
    for (const platform of candidates) {
      expect(platform.objectLevel, `${platform.id} 缺 objectLevel`).toBeDefined();
      expect(platform.source, `${platform.id} 缺平台级 source`).toBeDefined();
      const ownOrKitFacts = platform.facts ?? platform.referenceKit?.facts ?? [];
      expect(ownOrKitFacts.length, `${platform.id} 自身与参考套件均无事实数组——无事实不得进入候选矩阵`).toBeGreaterThanOrEqual(3);
      for (const fact of ownOrKitFacts) {
        expect(
          OFFICIAL_CONFIDENCE.has(fact.source.confidence),
          `${platform.id}.${fact.key} 的来源置信度 ${fact.source.confidence} 不是官方系`,
        ).toBe(true);
        expect(fact.source.url.startsWith("https://"), `${platform.id}.${fact.key} 来源必须是 https 官方 URL`).toBe(true);
      }
    }
  });

  it("matrix is exactly ESP32-S3 (recommended) and STM32F401RE (industrial) as of 2026-08-22 audit", () => {
    expect(candidates.map((p) => ({ id: p.id, tier: p.candidateTier }))).toEqual([
      { id: "ESP32-S3", tier: "recommended" },
      { id: "STM32F401RE", tier: "industrial" },
    ]);
  });

  it("keeps RP2040 suspended until first-party sources are verified (network-blocked 2026-08-22)", () => {
    const rp2040 = registry.getOrNone("RP2040");
    expect(rp2040).toBeDefined();
    expect(rp2040?.candidateTier, "RP2040 在补齐 raspberrypi.com 官方来源前不得回到候选矩阵").toBeUndefined();
  });

  it("recommended candidate carries a source-backed exact reference kit identity", () => {
    const esp32s3 = registry.get("ESP32-S3");
    expect(esp32s3.referenceKit).toBeDefined();
    expect(esp32s3.referenceKit?.source.confidence).toBe("official-direct");
    expect(esp32s3.referenceKit?.facts.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(esp32s3.referenceKit?.physicalAcceptance.status).toBe("pending");
  });
});
