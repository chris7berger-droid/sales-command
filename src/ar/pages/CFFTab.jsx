import { useState } from "react";
import { C, F, COL } from "../lib/tokens";
import { fmt, fmtShort, parseDate, toDateStr, toISODate, fromISO, invKey, getPeriodRange } from "../lib/utils";
import { useAR } from "../lib/ARContext";
import PeriodNav from "../components/PeriodNav";

export default function CFFTab({ onSelectInvoice }) {
  const ar = useAR();
  const [mode, setMode] = useState("week");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("scheduled");

  const range = getPeriodRange(mode, offset);

  function getExpectedDate(inv) {
    const k = invKey(inv.customer, inv.num, inv.date);
    if (ar.expectedDates[k]) return parseDate(ar.expectedDates[k]);
    const due = parseDate(inv.dueDate);
    if (!due) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return due >= now ? due : null;
  }

  const openInvs = ar.allInvoices.filter((inv) => {
    if (inv.type !== "Invoice" || inv.openBalance <= 0) return false;
    if (ar.isCollections(inv, inv.customer) || ar.isGoback(inv, inv.customer)) return false;
    const k = invKey(inv.customer, inv.num, inv.date);
    if (ar.decisions?.[k]?.confirmedAt) return false;
    return true;
  });

  const unscheduled = [], scheduled = [], retentionInvs = [];
  openInvs.forEach((inv) => {
    if (ar.isRetention(inv, inv.customer)) { retentionInvs.push(inv); return; }
    const exp = getExpectedDate(inv);
    if (!exp) { unscheduled.push(inv); return; }
    if (exp >= range.start && exp < range.end) scheduled.push(inv);
  });

  const schedTotal = scheduled.reduce((s, i) => s + i.openBalance, 0);
  const unschedTotal = unscheduled.reduce((s, i) => s + i.openBalance, 0);
  const retTotal = retentionInvs.reduce((s, i) => s + i.openBalance, 0);

  const cards = [
    { id: "scheduled", label: "Expected This Period", amount: schedTotal, count: scheduled.length, bg: "#059669", sub: "invoice" },
    { id: "unscheduled", label: "Unscheduled", amount: unschedTotal, count: unscheduled.length, bg: "#dc2626", sub: "need dates" },
    { id: "retention", label: "Retention", amount: retTotal, count: retentionInvs.length, bg: COL.ret.bg, sub: "invoice" },
  ];

  // Build time buckets for scheduled view
  let buckets = [];
  if (filter === "scheduled") {
    if (mode === "week") {
      for (let d = new Date(range.start); d < range.end; d = new Date(d.getTime() + 86400000)) {
        const dayStart = new Date(d); const dayEnd = new Date(d.getTime() + 86400000);
        const dayInvs = scheduled.filter((inv) => { const exp = getExpectedDate(inv); return exp >= dayStart && exp < dayEnd; });
        if (dayInvs.length) buckets.push({ label: dayStart.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), invs: dayInvs, total: dayInvs.reduce((s, i) => s + i.openBalance, 0) });
      }
    } else if (mode === "month") {
      let weekNum = 1;
      for (let d = new Date(range.start); d < range.end;) {
        const wEnd = new Date(Math.min(d.getTime() + 7 * 86400000, range.end));
        const wInvs = scheduled.filter((inv) => { const exp = getExpectedDate(inv); return exp >= d && exp < wEnd; });
        if (wInvs.length) buckets.push({ label: `Week ${weekNum} (${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(wEnd.getTime() - 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`, invs: wInvs, total: wInvs.reduce((s, i) => s + i.openBalance, 0) });
        d = wEnd; weekNum++;
      }
    } else {
      let ms = new Date(range.start);
      while (ms < range.end) {
        const mEnd = new Date(ms.getFullYear(), ms.getMonth() + 1, 1);
        const cappedEnd = mEnd > range.end ? range.end : mEnd;
        const mInvs = scheduled.filter((inv) => { const exp = getExpectedDate(inv); return exp >= ms && exp < cappedEnd; });
        if (mInvs.length) buckets.push({ label: ms.toLocaleDateString("en-US", { month: "long", year: "numeric" }), invs: mInvs, total: mInvs.reduce((s, i) => s + i.openBalance, 0) });
        ms = cappedEnd;
      }
    }
  }

  const displayInvs = filter === "unscheduled" ? unscheduled : filter === "retention" ? retentionInvs : null;

  const saveExpDate = (inv, isoVal) => {
    const d = fromISO(isoVal);
    if (!d) return;
    const k = invKey(inv.customer, inv.num, inv.date);
    const ds = toDateStr(d);
    ar.updateExpDates({ ...ar.expectedDates, [k]: ds });
    ar.updateNotes({ ...ar.notes, [k]: [...(ar.notes[k] || []), { text: "Expected payment date set to " + ds, ts: Date.now() }] });
  };

  return (
    <div>
      <PeriodNav mode={mode} offset={offset}
        onModeChange={(m) => { setMode(m); setOffset(0); }}
        onOffsetChange={setOffset} />

      <div style={S.cards}>
        {cards.map((c) => {
          const active = filter === c.id;
          return (
            <div key={c.id} onClick={() => setFilter(c.id)}
              style={{ ...S.card, ...(active ? { background: c.bg, borderColor: c.bg, transform: "translateY(-2px)", boxShadow: `0 6px 20px ${c.bg}33` } : {}) }}>
              <div style={S.cardLabel}>{c.label}</div>
              <div style={{ ...S.cardAmt, color: active ? "#fff" : c.bg }}>{fmtShort(c.amount)}</div>
              <div style={{ ...S.cardCount, ...(active ? { color: "rgba(255,255,255,0.7)" } : {}) }}>{c.count} {c.count !== 1 ? c.sub + "s" : c.sub}</div>
            </div>
          );
        })}
      </div>

      <div style={S.body}>
        {/* Scheduled buckets view */}
        {filter === "scheduled" && !buckets.length && <div style={S.empty}>No expected payments in this period</div>}
        {filter === "scheduled" && buckets.map((b, bi) => (
          <div key={bi} style={S.bucket}>
            <div style={S.bucketHeader}>
              <div><span style={S.bucketTitle}>{b.label}</span><span style={S.bucketCount}>{b.invs.length} invoices</span></div>
              <span style={S.bucketAmt}>{fmt(b.total)}</span>
            </div>
            <div style={S.bucketBody}>
              {b.invs.map((inv, ii) => <CFFInvRow key={ii} inv={inv} onSaveDate={saveExpDate} onClick={() => onSelectInvoice(inv)} expectedDates={ar.expectedDates} />)}
            </div>
          </div>
        ))}

        {/* Flat list views */}
        {displayInvs && !displayInvs.length && <div style={S.empty}>{filter === "unscheduled" ? "No unscheduled invoices \u2014 nice work!" : "No retention invoices"}</div>}
        {displayInvs && displayInvs.length > 0 && (
          <div style={S.bucket}>
            <div style={{ ...S.bucketHeader, ...(filter === "retention" ? { background: COL.ret.lt } : {}) }}>
              <div>
                <span style={{ ...S.bucketTitle, ...(filter === "retention" ? { color: COL.ret.bg } : {}) }}>
                  {filter === "unscheduled" ? "\u26A0 Set Expected Payment Dates" : "Retention Invoices"}
                </span>
                <span style={S.bucketCount}>{displayInvs.length} invoices</span>
              </div>
              <span style={{ ...S.bucketAmt, ...(filter === "retention" ? { color: COL.ret.bg } : {}) }}>
                {fmt(displayInvs.reduce((s, i) => s + i.openBalance, 0))}
              </span>
            </div>
            <div style={S.bucketBody}>
              {displayInvs.map((inv, ii) => <CFFInvRow key={ii} inv={inv} onSaveDate={saveExpDate} onClick={() => onSelectInvoice(inv)} expectedDates={ar.expectedDates} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CFFInvRow({ inv, onSaveDate, onClick, expectedDates }) {
  const k = invKey(inv.customer, inv.num, inv.date);
  const exp = expectedDates[k] || "";
  const expISO = exp ? toISODate(parseDate(exp)) : "";

  return (
    <div style={RS.row} onClick={onClick}>
      <div style={RS.info}>
        <div style={RS.cust}>{inv.customer}</div>
        <div style={RS.detail}>#{inv.num} {"\u2022"} Due: {inv.dueDate} {"\u2022"} {(inv.job || "").substring(0, 50)}</div>
      </div>
      <div style={RS.amt}>{fmt(inv.openBalance)}</div>
      <div style={RS.dateWrap} onClick={(e) => e.stopPropagation()}>
        <input type="date" defaultValue={expISO} style={RS.dateInput}
          onChange={(e) => onSaveDate(inv, e.target.value)} />
      </div>
    </div>
  );
}

const S = {
  cards: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  card: { flex: "1 1 140px", minWidth: 140, border: `2px solid ${C.borderStrong}`, borderRadius: 10, padding: "16px 14px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", background: C.linenCard },
  cardLabel: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMuted, marginBottom: 6 },
  cardAmt: { fontFamily: F.display, fontSize: 22, fontWeight: 800, lineHeight: 1.1 },
  cardCount: { fontSize: 11, color: C.textFaint, marginTop: 4 },
  body: { maxHeight: "calc(100vh - 360px)", overflowY: "auto" },
  bucket: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  bucketHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.linenDeep },
  bucketTitle: { fontFamily: F.display, fontSize: 13, fontWeight: 700, color: C.textHead },
  bucketCount: { fontSize: 10, color: C.textFaint, marginLeft: 8 },
  bucketAmt: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: C.textHead },
  bucketBody: { padding: "4px 0" },
  empty: { padding: 40, textAlign: "center", color: C.textFaint },
};

const RS = {
  row: { display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", gap: 12 },
  info: { flex: 1, minWidth: 0 },
  cust: { fontWeight: 600, fontSize: 12, color: C.textBody },
  detail: { fontSize: 10, color: C.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  amt: { fontFamily: F.display, fontWeight: 800, fontSize: 14, color: C.textHead, minWidth: 80, textAlign: "right" },
  dateWrap: { minWidth: 120 },
  dateInput: { background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: C.textBody, width: "100%" },
};
