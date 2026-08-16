import type { BomItemDto, PriceObservationDto } from "@/src/shared-contracts/types";

export type BomExportFormat = "csv" | "markdown";

const columns = [
  "component_id", "display_name", "source_kind", "identity_status", "manufacturer", "manufacturer_part_number", "supplier_sku", "bom_quantity", "unresolved_reason",
  "supplier", "quantity_tier", "currency", "unit_price", "line_total", "shipping", "tax", "fees", "stock_status", "source_url", "observed_at",
];

function value(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function escapeCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function rows(items: BomItemDto[], observations: PriceObservationDto[]): string[][] {
  const byItem = new Map<string, PriceObservationDto[]>();
  for (const observation of observations) byItem.set(observation.bomItemId, [...(byItem.get(observation.bomItemId) ?? []), observation]);
  return items.flatMap((item) => {
    const itemObservations = byItem.get(item.id) ?? [];
    const source = itemObservations.length ? itemObservations : [null];
    return source.map((observation) => [
      item.componentId,
      item.displayName,
      item.sourceKind,
      item.identityStatus,
      value(item.manufacturer),
      value(item.manufacturerPartNumber),
      value(item.supplierSku),
      value(item.quantity),
      value(item.unresolvedReason),
      observation ? observation.supplier : "",
      observation ? value(observation.quantityTier) : "",
      observation ? observation.currency : "",
      observation ? value(observation.unitPrice) : "",
      observation ? value(observation.lineTotal) : "",
      observation ? value(observation.shipping) : "",
      observation ? value(observation.tax) : "",
      observation ? value(observation.fees) : "",
      observation ? observation.stockStatus : "",
      observation ? observation.sourceUrl : "",
      observation ? observation.observedAt : "",
    ]);
  });
}

export function exportBom(items: BomItemDto[], observations: PriceObservationDto[], format: BomExportFormat): string {
  const data = rows(items, observations);
  if (format === "csv") return [columns, ...data].map((row) => row.map(escapeCsv).join(",")).join("\n") + "\n";
  const header = "| " + columns.join(" | ") + " |";
  const divider = "| " + columns.map(() => "---").join(" | ") + " |";
  const body = data.map((row) => "| " + row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ") + " |");
  return ["# BOM / 采购观察", "", "价格与库存是带时间的观察，不是兼容性、安全性或下单承诺。", "", header, divider, ...body, ""].join("\n");
}
