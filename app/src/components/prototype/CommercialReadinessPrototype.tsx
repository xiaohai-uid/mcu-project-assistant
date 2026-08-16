import React, { useEffect, useState } from "react";
import "./commercial-readiness-prototype.css";

type Variant = "A" | "B" | "C";
type Tone = "done" | "partial" | "blocked" | "pending";

const variantNames: Record<Variant, string> = {
  A: "交付路线",
  B: "证据账本",
  C: "物料档案",
};

const gates: Array<{ number: string; label: string; status: string; tone: Tone; detail: string; evidence: string }> = [
  { number: "01", label: "硬件身份", status: "已确认", tone: "done", detail: "开发板、模组、内存规格和版本已写清楚。", evidence: "Espressif 官方用户指南" },
  { number: "02", label: "接线规则", status: "部分确认", tone: "partial", detail: "接口方向明确，但两个外设还没有精确到模块料号。", evidence: "项目规则库" },
  { number: "03", label: "本地编译", status: "未完成", tone: "blocked", detail: "没有固定工具版本、命令和输出，结果无法复现。", evidence: "本机工具链" },
  { number: "04", label: "真机回读", status: "未执行", tone: "pending", detail: "还没有上传程序，也没有串口现象记录。", evidence: "实体开发板" },
];

const parts = [
  { name: "ESP32-S3-DevKitC-1-N8R8", type: "主控开发板", identity: "精确到开发板型号", observation: "待抓取", tone: "done" as Tone },
  { name: "BMP280 模块", type: "气压 / 温度", identity: "只确认到传感器家族", observation: "料号待绑定", tone: "partial" as Tone },
  { name: "0.96 寸 OLED", type: "数据显示", identity: "控制器与模块未拆开", observation: "暂不承诺", tone: "blocked" as Tone },
];

function StatusPip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`crp2-status crp2-status-${tone}`}><i aria-hidden="true" />{children}</span>;
}

function Source({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return <span className="crp2-source">{children}</span>;
  return <a className="crp2-source crp2-source-link" href={href} target="_blank" rel="noreferrer">{children} ↗</a>;
}

function readVariant(): Variant {
  if (typeof window === "undefined") return "A";
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return value === "B" || value === "C" ? value : "A";
}

function replaceVariantUrl(next: Variant) {
  const url = new URL(window.location.href);
  url.searchParams.set("prototype", "commercial-readiness");
  url.searchParams.set("variant", next);
  return `${url.pathname}${url.search}${url.hash}`;
}

function Masthead() {
  return (
    <>
      <header className="crp2-masthead">
        <div className="crp2-brand">
          <span className="crp2-brand-mark">M</span>
          <div>
            <strong>MCU 工程助手</strong>
            <span>项目交付观察 / 01</span>
          </div>
        </div>
        <div className="crp2-masthead-meta">
          <span className="crp2-live-dot" />开发预览
          <span className="crp2-date">2026.08.16</span>
        </div>
      </header>
      <div className="crp2-rule" />
    </>
  );
}

function Intro() {
  return (
    <section className="crp2-intro">
      <div className="crp2-kicker">PROJECT READINESS / HANDOFF GATE</div>
      <h1>这个项目，<em>现在</em>能交付吗？</h1>
      <p>把资料、编译、真机和采购放进同一张状态台。这里不猜完成度，只展示已经留下的证据。</p>
    </section>
  );
}

function Verdict() {
  return (
    <section className="crp2-verdict">
      <div className="crp2-verdict-main">
        <div className="crp2-kicker">当前判断 / HANDOFF</div>
        <div className="crp2-verdict-word">NOT YET</div>
        <h2>还不能交给别人直接使用</h2>
        <p>硬件身份已经有依据，但编译记录和真机回读还没有完成。现在适合继续开发，不适合承诺交付。</p>
      </div>
      <div className="crp2-verdict-count">
        <strong>02<span>/04</span></strong>
        <small>关键关口已留下证据</small>
      </div>
    </section>
  );
}

function NextMove() {
  return (
    <aside className="crp2-next-move">
      <div className="crp2-kicker">NEXT MOVE / 现在做什么</div>
      <div className="crp2-next-number">03</div>
      <h2>先让它在本机稳定编译</h2>
      <p>固定工具版本、编译命令和输出文件。后面的真机上传，才有可复核的起点。</p>
      <div className="crp2-next-tag">本地准备 / LOCAL READY</div>
    </aside>
  );
}

function GateList({ dense = false }: { dense?: boolean }) {
  return (
    <div className={`crp2-gates ${dense ? "crp2-gates-dense" : ""}`}>
      {gates.map((gate) => (
        <div className="crp2-gate-row" key={gate.number}>
          <span className="crp2-gate-number">{gate.number}</span>
          <div className="crp2-gate-title"><strong>{gate.label}</strong><StatusPip tone={gate.tone}>{gate.status}</StatusPip></div>
          <p>{gate.detail}</p>
          <Source>{gate.evidence}</Source>
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ index, eyebrow, title, note }: { index: string; eyebrow: string; title: string; note?: string }) {
  return (
    <div className="crp2-section-heading">
      <span className="crp2-section-index">{index}</span>
      <div>
        <div className="crp2-kicker">{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {note && <span className="crp2-section-note">{note}</span>}
    </div>
  );
}

function IdentityStrip() {
  return (
    <section className="crp2-identity">
      <div className="crp2-identity-label">HARDWARE IDENTITY / 主控身份</div>
      <div className="crp2-identity-name">ESP32-S3-DevKitC-1-N8R8</div>
      <div className="crp2-identity-sub">ESP32-S3-WROOM-1-N8R8 · 开发板 v1.1</div>
      <div className="crp2-identity-facts"><span>FLASH <b>8 MB</b></span><span>PSRAM <b>8 MB</b></span><span>身份 <b className="crp2-green">已确认</b></span></div>
      <Source href="https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html">Espressif 官方用户指南</Source>
    </section>
  );
}

function SourceStrip() {
  return (
    <section className="crp2-source-strip">
      <div className="crp2-source-strip-heading"><span className="crp2-kicker">SOURCE POLICY / 资料边界</span><strong>来源决定能说到哪一步</strong></div>
      <div className="crp2-source-rule"><span className="crp2-source-mark source-official" />官方资料 <b>确认型号与规格</b></div>
      <div className="crp2-source-rule"><span className="crp2-source-mark source-store" />供应商页面 <b>只观察价格与库存</b></div>
      <div className="crp2-source-rule"><span className="crp2-source-mark source-physical" />实体开发板 <b>证明上传与现象</b></div>
    </section>
  );
}

function RouteVariant() {
  return (
    <>
      <div className="crp2-route-layout">
        <Verdict />
        <NextMove />
      </div>
      <section className="crp2-section">
        <SectionHeading index="01" eyebrow="DELIVERY CHECK / 交付关口" title="从资料到真机，一条线看完" note="当前停在第 2 关" />
        <GateList />
      </section>
      <div className="crp2-bottom-layout"><IdentityStrip /><SourceStrip /></div>
    </>
  );
}

function LedgerVariant() {
  return (
    <>
      <section className="crp2-ledger-intro">
        <div><div className="crp2-kicker">AUDIT SHEET / 证据账本</div><h2>每个结论，都要能回答：凭什么？</h2></div>
        <div className="crp2-audit-stamp">REVIEW<br /><b>02 / 04</b></div>
      </section>
      <section className="crp2-ledger">
        <div className="crp2-ledger-head"><span>检查项</span><span>状态</span><span>事实和依据</span><span>交付影响</span></div>
        {gates.map((gate) => (
          <div className="crp2-ledger-row" key={gate.number}>
            <div className="crp2-ledger-item"><span>{gate.number}</span><strong>{gate.label}</strong></div>
            <StatusPip tone={gate.tone}>{gate.status}</StatusPip>
            <div><strong>{gate.evidence}</strong><p>{gate.detail}</p></div>
            <span className={gate.tone === "done" ? "crp2-impact-ok" : "crp2-impact-block"}>{gate.tone === "done" ? "可以继续" : "暂不承诺"}</span>
          </div>
        ))}
      </section>
      <div className="crp2-ledger-foot"><div><span className="crp2-kicker">RULE / 判断原则</span><strong>不知道，就保留为未知，不补猜。</strong></div><Source href="https://docs.lceda.cn/cn/Schematic/Export-BOM/index.html">嘉立创 BOM 说明</Source></div>
    </>
  );
}

function RegistryVariant() {
  return (
    <>
      <section className="crp2-registry-head">
        <div><div className="crp2-kicker">PARTS REGISTRY / 物料档案</div><h2>能买到，不等于已经适配。</h2><p>采购观察只回答“可能从哪里买”，不替代型号、接线和真机证据。</p></div>
        <div className="crp2-registry-summary"><strong>0</strong><span>个物料拥有完整采购观察</span></div>
      </section>
      <IdentityStrip />
      <section className="crp2-parts">
        <div className="crp2-parts-head"><span>物料</span><span>身份确认</span><span>采购观察</span><span>当前结论</span></div>
        {parts.map((part, index) => (
          <div className="crp2-part-row" key={part.name}>
            <span className="crp2-part-index">0{index + 1}</span>
            <div className="crp2-part-name"><strong>{part.name}</strong><small>{part.type}</small></div>
            <div className="crp2-part-fact"><span>身份</span><strong>{part.identity}</strong></div>
            <div className="crp2-part-fact"><span>立创商城</span><strong>{part.observation}</strong></div>
            <StatusPip tone={part.tone}>{part.tone === "done" ? "已确认" : part.tone === "partial" ? "待补资料" : "不能承诺"}</StatusPip>
          </div>
        ))}
      </section>
      <div className="crp2-parts-note"><span>i</span><span>价格、库存、供应商 SKU 和观察时间会单独保存。它们永远不会变成兼容性或安全性的证明。</span><Source href="https://docs.lceda.cn/cn/PCB/Order-PCB/index.html">采购流程说明</Source></div>
    </>
  );
}

function VariantSwitcher({ variant, onChange }: { variant: Variant; onChange: (next: Variant) => void }) {
  const order: Variant[] = ["A", "B", "C"];
  const current = order.indexOf(variant);
  const previous = order[(current + order.length - 1) % order.length] ?? "A";
  const next = order[(current + 1) % order.length] ?? "A";
  return (
    <div className="crp2-switcher" role="toolbar" aria-label="切换原型方案">
      <button type="button" onClick={() => onChange(previous)} aria-label="上一个方案">←</button>
      <span><b>{variant}</b> {variantNames[variant]}</span>
      <button type="button" onClick={() => onChange(next)} aria-label="下一个方案">→</button>
    </div>
  );
}

export const CommercialReadinessPrototype: React.FC = () => {
  const [variant, setVariant] = useState<Variant>(readVariant);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const order: Variant[] = ["A", "B", "C"];
      const current = order.indexOf(variant);
      const nextIndex = event.key === "ArrowRight" ? (current + 1) % order.length : (current + order.length - 1) % order.length;
      const next = order[nextIndex] ?? "A";
      setVariant(next);
      window.history.replaceState(null, "", replaceVariantUrl(next));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);

  const chooseVariant = (next: Variant) => {
    setVariant(next);
    window.history.replaceState(null, "", replaceVariantUrl(next));
  };

  return (
    <div className="crp2-shell" lang="zh-CN">
      <Masthead />
      <Intro />
      {variant === "A" && <RouteVariant />}
      {variant === "B" && <LedgerVariant />}
      {variant === "C" && <RegistryVariant />}
      <VariantSwitcher variant={variant} onChange={chooseVariant} />
    </div>
  );
};
