import React, { useCallback, useEffect, useState } from "react";
import type { BomItemWithObservationsDto } from "@/src/shared-contracts/types";
import { api as clientApi } from "../api/client";
import { t } from "../lib/i18n";
import { useApp } from "../state/AppContext";
import { InfoBanner } from "./ui";

export const BomView: React.FC = () => {
  const { state } = useApp();
  const { lang, project } = state;
  const [items, setItems] = useState<BomItemWithObservationsDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [userItem, setUserItem] = useState({ componentId: "", displayName: "", manufacturer: "", manufacturerPartNumber: "", supplierSku: "", quantity: "1" });
  const [observation, setObservation] = useState({ supplierSku: "", quantityTier: "1", unitPrice: "", lineTotal: "", shipping: "", sourceUrl: "", stockStatus: "unknown" });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!project?.id) return;
    setLoading(true);
    setError(false);
    try {
      const result = await clientApi.getBom(project.id, signal);
      setItems(result.items);
      setSelectedItemId((current) => current || result.items[0]?.id || "");
    } catch {
      if (!signal?.aborted) setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const download = async (format: "csv" | "markdown") => {
    if (!project?.id) return;
    const result = await clientApi.exportBom(project.id, format);
    const blob = new Blob([result.content], { type: format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mcu-bom.${format === "csv" ? "csv" : "md"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveUserItem = async () => {
    if (!project?.id) return;
    try {
      const exact = Boolean(userItem.manufacturer && userItem.manufacturerPartNumber && userItem.supplierSku);
      await clientApi.createBomItem(project.id, {
        componentId: userItem.componentId,
        displayName: userItem.displayName,
        identityStatus: exact ? "exact" : "unresolved",
        manufacturer: userItem.manufacturer || null,
        manufacturerPartNumber: userItem.manufacturerPartNumber || null,
        supplierSku: userItem.supplierSku || null,
        quantity: Number(userItem.quantity),
        unresolvedReason: exact ? null : "User has not supplied a complete manufacturer and supplier identity.",
      });
      setNotice(t(lang, "bomSave"));
      setUserItem({ componentId: "", displayName: "", manufacturer: "", manufacturerPartNumber: "", supplierSku: "", quantity: "1" });
      await refresh();
    } catch {
      setError(true);
    }
  };

  const saveObservation = async () => {
    if (!project?.id || !selectedItemId) return;
    try {
      await clientApi.addPriceObservation(project.id, selectedItemId, {
        supplierSku: observation.supplierSku,
        manufacturerPartNumber: null,
        quantityTier: Number(observation.quantityTier) as 1 | 10 | 100,
        unitPrice: observation.unitPrice === "" ? null : Number(observation.unitPrice),
        lineTotal: observation.lineTotal === "" ? null : Number(observation.lineTotal),
        shipping: observation.shipping === "" ? null : Number(observation.shipping),
        tax: null,
        fees: null,
        stockStatus: observation.stockStatus as "in-stock" | "out-of-stock" | "unknown",
        sourceUrl: observation.sourceUrl,
      });
      setNotice(t(lang, "bomSave"));
      await refresh();
    } catch {
      setError(true);
    }
  };

  const selected = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const componentOptions = Array.from(new Set([
    ...items.filter((item) => !item.componentId.startsWith("board:")).map((item) => item.componentId),
    "sensor.soil_moisture",
    "actuator.relay",
    "display.oled_096",
  ]));
  const inputClass = "w-full px-2.5 py-1.5 rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] text-[11px] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#007aff]";

  return (
    <div className="flex-1 px-6 py-6 max-w-[1100px] mx-auto flex flex-col gap-5 pb-20">
      <header className="flex items-center justify-between gap-3 mac-card p-4">
        <div>
          <div className="flex items-center gap-1.5 text-[#007aff] dark:text-[#0a84ff] text-xs font-semibold mb-0.5"><span className="material-symbols-outlined text-sm">inventory_2</span><span>PROCUREMENT / BOM</span></div>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{t(lang, "bomTitle")}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{t(lang, "bomSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void download("csv")} disabled={!project || loading} className="px-3 py-1.5 mac-button-secondary rounded-md text-xs disabled:opacity-40">{t(lang, "bomExportCsv")}</button>
          <button onClick={() => void download("markdown")} disabled={!project || loading} className="px-3 py-1.5 mac-button-primary rounded-md text-xs disabled:opacity-40">{t(lang, "bomExportMarkdown")}</button>
        </div>
      </header>

      {error && <InfoBanner icon="error" title="BOM unavailable" desc="The local BOM or observation record could not be saved or read." lang={lang} tone="amber" />}
      {notice && <InfoBanner icon="check_circle" title={notice} desc="Procurement observations remain separate from compatibility, safety, build, and physical acceptance." lang={lang} tone="blue" />}

      <section className="mac-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--panel-border-subtle)] bg-[var(--control-bg)] flex items-center justify-between"><span className="text-xs font-semibold text-[var(--text-primary)]">{t(lang, "bomTitle")}</span><button onClick={() => void refresh()} className="text-[11px] text-[#007aff]">{loading ? "…" : "Refresh"}</button></div>
        {items.length === 0 ? <div className="p-5 text-xs text-[var(--text-secondary)]">{t(lang, "bomNoItems")}</div> : <div className="divide-y divide-[var(--panel-border-subtle)]">
          {items.map((item) => <div key={item.id} className="p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div><div className="text-sm font-semibold text-[var(--text-primary)]">{item.displayName}</div><div className="text-[10px] font-mono text-[var(--text-muted)] mt-1">{item.componentId} · {item.sourceKind}</div></div>
              <span className={`px-2 py-1 rounded border text-[10px] font-mono ${item.identityStatus === "exact" ? "text-emerald-600 border-emerald-500/20 bg-emerald-500/5" : "text-amber-600 border-amber-500/20 bg-amber-500/5"}`}>{item.identityStatus}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              <div><span className="text-[var(--text-muted)]">{t(lang, "bomManufacturer")}</span><div className="font-mono text-[var(--text-primary)]">{item.manufacturer ?? "—"}</div></div>
              <div><span className="text-[var(--text-muted)]">{t(lang, "bomPartNumber")}</span><div className="font-mono text-[var(--text-primary)]">{item.manufacturerPartNumber ?? "—"}</div></div>
              <div><span className="text-[var(--text-muted)]">{t(lang, "bomSupplierSku")}</span><div className="font-mono text-[var(--text-primary)]">{item.supplierSku ?? "—"}</div></div>
              <div><span className="text-[var(--text-muted)]">{t(lang, "bomQuantity")}</span><div className="font-mono text-[var(--text-primary)]">{item.quantity}</div></div>
            </div>
            {item.unresolvedReason && <div className="text-[11px] text-amber-700 dark:text-amber-300">{item.unresolvedReason}</div>}
            <div className="rounded-md bg-[var(--control-bg)] border border-[var(--panel-border-subtle)] p-3">
              <div className="text-[10px] font-mono uppercase text-[var(--text-muted)] mb-2">{t(lang, "bomObservedPrices")}</div>
              {item.priceObservations.length === 0 ? <div className="text-[11px] text-[var(--text-muted)]">{t(lang, "bomNoObservations")}</div> : <div className="flex flex-wrap gap-2">{item.priceObservations.map((price) => <div key={price.id} className="text-[11px] font-mono text-[var(--text-primary)] border border-[var(--panel-border-subtle)] rounded px-2 py-1">{price.supplier} · qty {price.quantityTier} · {price.unitPrice ?? "—"} CNY · {price.stockStatus} · {price.observedAt}</div>)}</div>}
            </div>
          </div>)}
        </div>}
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="mac-card p-4"><h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t(lang, "bomAddItem")}</h2><div className="grid grid-cols-2 gap-2">
          <input list="bom-component-options" className={inputClass} placeholder={t(lang, "bomComponentId")} value={userItem.componentId} onChange={(e) => setUserItem({ ...userItem, componentId: e.target.value })} />
          <datalist id="bom-component-options">{componentOptions.map((componentId) => <option key={componentId} value={componentId} />)}</datalist>
          <input className={inputClass} placeholder={t(lang, "bomDisplayName")} value={userItem.displayName} onChange={(e) => setUserItem({ ...userItem, displayName: e.target.value })} />
          <input className={inputClass} placeholder={t(lang, "bomManufacturer")} value={userItem.manufacturer} onChange={(e) => setUserItem({ ...userItem, manufacturer: e.target.value })} />
          <input className={inputClass} placeholder={t(lang, "bomPartNumber")} value={userItem.manufacturerPartNumber} onChange={(e) => setUserItem({ ...userItem, manufacturerPartNumber: e.target.value })} />
          <input className={inputClass} placeholder={t(lang, "bomSupplierSku")} value={userItem.supplierSku} onChange={(e) => setUserItem({ ...userItem, supplierSku: e.target.value })} />
          <input className={inputClass} type="number" min="1" placeholder={t(lang, "bomQuantity")} value={userItem.quantity} onChange={(e) => setUserItem({ ...userItem, quantity: e.target.value })} />
        </div><p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">Use the canonical component ID shown above to bind an exact user BOM item to wiring. Exact purchase identity does not replace missing electrical-source facts.</p><button onClick={() => void saveUserItem()} className="mt-3 px-3 py-1.5 mac-button-primary rounded-md text-xs">{t(lang, "bomSave")}</button></div>

        <div className="mac-card p-4"><h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t(lang, "bomAddObservation")}</h2><select className={inputClass} value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)}><option value="">—</option>{items.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><div className="grid grid-cols-2 gap-2 mt-2">
          <input className={inputClass} placeholder={t(lang, "bomSupplierSku")} value={observation.supplierSku} onChange={(e) => setObservation({ ...observation, supplierSku: e.target.value })} />
          <select className={inputClass} value={observation.quantityTier} onChange={(e) => setObservation({ ...observation, quantityTier: e.target.value })}><option value="1">1</option><option value="10">10</option><option value="100">100</option></select>
          <input className={inputClass} type="number" placeholder={t(lang, "bomUnitPrice")} value={observation.unitPrice} onChange={(e) => setObservation({ ...observation, unitPrice: e.target.value })} />
          <input className={inputClass} type="number" placeholder={t(lang, "bomLineTotal")} value={observation.lineTotal} onChange={(e) => setObservation({ ...observation, lineTotal: e.target.value })} />
          <input className={inputClass} type="number" placeholder={t(lang, "bomShipping")} value={observation.shipping} onChange={(e) => setObservation({ ...observation, shipping: e.target.value })} />
          <select className={inputClass} value={observation.stockStatus} onChange={(e) => setObservation({ ...observation, stockStatus: e.target.value })}><option value="unknown">unknown</option><option value="in-stock">in-stock</option><option value="out-of-stock">out-of-stock</option></select>
          <input className={`${inputClass} col-span-2`} placeholder={t(lang, "bomSourceUrl")} value={observation.sourceUrl} onChange={(e) => setObservation({ ...observation, sourceUrl: e.target.value })} />
        </div><button onClick={() => void saveObservation()} disabled={!selected || selected.identityStatus !== "exact"} className="mt-3 px-3 py-1.5 mac-button-primary rounded-md text-xs disabled:opacity-40">{t(lang, "bomSave")}</button></div>
      </section>
    </div>
  );
};
