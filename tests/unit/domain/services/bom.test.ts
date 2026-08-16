import { describe, expect, it } from "vitest";
import { exportBom } from "@/src/domain/services/bom";
import type { BomItemDto, PriceObservationDto } from "@/src/shared-contracts/types";

const item = (patch: Partial<BomItemDto> = {}): BomItemDto => ({
  id: "bom-1",
  projectId: "project-1",
  componentId: "sensor.bmp280",
  displayName: "BMP280",
  sourceKind: "system-suggestion",
  identityStatus: "exact",
  manufacturer: "Bosch Sensortec",
  manufacturerPartNumber: "BMP280",
  supplierSku: "C25879",
  quantity: 1,
  unresolvedReason: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  ...patch,
});

const observation = (patch: Partial<PriceObservationDto> = {}): PriceObservationDto => ({
  id: "price-1",
  bomItemId: "bom-1",
  supplier: "LCSC",
  supplierSku: "C25879",
  manufacturerPartNumber: "BMP280",
  quantityTier: 1,
  currency: "CNY",
  unitPrice: 3.2,
  lineTotal: 3.2,
  shipping: 5,
  tax: null,
  fees: null,
  stockStatus: "in-stock",
  sourceUrl: "https://so.szlcsc.com/global.html?k=C25879",
  observedAt: "2026-08-17T00:00:00.000Z",
  ...patch,
});

describe("BOM export", () => {
  it("keeps exact identity, unresolved state, quantity tiers, and fees separate", () => {
    const unresolved = item({ id: "bom-2", componentId: "actuator.relay", displayName: "Relay module", sourceKind: "user-input", identityStatus: "unresolved", manufacturer: null, manufacturerPartNumber: null, supplierSku: null, unresolvedReason: "Module part number not confirmed" });
    const csv = exportBom([item(), unresolved], [observation(), observation({ id: "price-10", quantityTier: 10, unitPrice: 2.8, lineTotal: 28, shipping: null })], "csv");
    expect(csv).toContain("supplier_sku");
    expect(csv).toContain("C25879");
    expect(csv).toContain("10");
    expect(csv).toContain("Module part number not confirmed");
    expect(csv).toContain("5");
  });

  it("exports Markdown as a procurement observation, not an order", () => {
    const markdown = exportBom([item()], [observation({ quantityTier: 100, unitPrice: null, lineTotal: null, stockStatus: "unknown" })], "markdown");
    expect(markdown).toContain("采购观察");
    expect(markdown).toContain("LCSC");
    expect(markdown).toContain("100");
    expect(markdown).toContain("unknown");
    expect(markdown).not.toMatch(/创建订单|POST \/api/i);
  });
});
