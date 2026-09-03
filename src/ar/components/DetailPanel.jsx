import { useState } from "react";
import { C, F, COL } from "../lib/tokens";
import { fmt, daysOverdue, invKey, custNoteKey, fmtTs, parseDate, toDateStr, toISODate, fromISO } from "../lib/utils";
import { useAR } from "../lib/ARContext";
import { exportDetailView } from "../lib/exportUtils";

function AgeBadge({ bucket }) {
  const m = { over90: { l: "91+", ...COL.o90 }, days90: { l: "61-90", ...COL.d90 }, days60: { l: "31-60", ...COL.d60 }, days30: { l: "1-30", ...COL.d30 }, current: { l: "Current", ...COL.cur } }[bucket] || { l: "?", bg: "#6b7280", lt: "#f3f4f6" };
  return <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: F.display, background: m.lt, color: m.bg }}>{m.l}</span>;
}

function FlagBadge({ label, bg, color }) {
  return <span style={{ fontSize: 9, fontWeight: 700, fontFamily: F.display, padding: "2px 7px", borderRadius: 4, background: bg, color, letterSpacing: "0.04em" }}>{label}</span>;
}

export default function DetailPanel({ customer, onClose }) {
  const ar = useAR();
  const [bucketFilter, setBucketFilter] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [noteInputs, setNoteInputs] = useState({});
  const c = customer;

  if (!c) return null;

  const email = ar.custEmails[c.name] || "";
  const bOrder = { over90: 0, days90: 1, days60: 2, days30: 3, current: 4 };
  const sorted = c.invoices.slice().sort((a, b) => {
    const bo = (bOrder[a.bucket] || 4) - (bOrder[b.bucket] || 4);
    return bo !== 0 ? bo : (a.date || "").localeCompare(b.date || "");
  });

  const now = new Date(); now.setHours(0, 0, 0, 0);

  function matchFilter(inv) {
    if (!bucketFilter) return true;
    if (bucketFilter === "retention") return ar.isRetention(inv, c.name);
    if (bucketFilter === "collections") return ar.isCollections(inv, c.name);
    if (bucketFilter === "goback") return ar.isGoback(inv, c.name);
    return inv.bucket === bucketFilter;
  }

  // Group invoices
  const weekEnd = new Date(now);
  const dayOfWeek = weekEnd.getDay();
  weekEnd.setDate(weekEnd.getDate() + (dayOfWeek <= 5 ? 5 - dayOfWeek : 0));
  weekEnd.setHours(23, 59, 59, 999);

  const groups = { overdue: [], thisWeek: [], future: [], retention: [], collections: [], goback: [], other: [] };
  sorted.forEach((inv, idx) => {
    inv._sortIdx = idx;
    if (ar.isCollections(inv, c.name)) { groups.collections.push(inv); return; }
    if (ar.isGoback(inv, c.name)) { groups.goback.push(inv); return; }
    if (ar.isRetention(inv, c.name)) { groups.retention.push(inv); return; }
    const due = parseDate(inv.dueDate);
    if (!due) { groups.other.push(inv); return; }
    if (due < now) groups.overdue.push(inv);
    else if (due <= weekEnd) groups.thisWeek.push(inv);
    else groups.future.push(inv);
  });

  const sections = [
    { key: "overdue", label: "Overdue", color: "#dc2626", items: groups.overdue },
    { key: "thisWeek", label: "This Week", color: "#d97706", items: groups.thisWeek },
    { key: "future", label: "Future", color: "#059669", items: groups.future },
    { key: "retention", label: "Retention", color: COL.ret.bg, items: groups.retention },
    { key: "goback", label: "Go Back Issues", color: COL.goback.bg, items: groups.goback },
    { key: "collections", label: "In Collections", color: COL.coll.bg, items: groups.collections },
    { key: "other", label: "Other", color: "#6b7280", items: groups.other },
  ];

  const buckets = [
    { l: "Current", k: "current", v: c.current, c: COL.cur },
    { l: "1-30", k: "days30", v: c.days30, c: COL.d30 },
    { l: "31-60", k: "days60", v: c.days60, c: COL.d60 },
    { l: "61-90", k: "days90", v: c.days90, c: COL.d90 },
    { l: "91+", k: "over90", v: c.over90, c: COL.o90 },
  ];
  const retTotal = ar.getCustRetTotal(c);
  const collTotal = ar.getCustCollTotal(c);
  const gobackTotal = ar.getCustGobackTotal(c);

  const toggleFlag = (flagType, inv) => {
    const k = invKey(c.name, inv.num, inv.date);
    const map = { ret: ar.retFlags, coll: ar.collFlags, goback: ar.gobackFlags, acct: ar.acctFlags };
    const updater = { ret: ar.updateRetFlags, coll: ar.updateCollFlags, goback: ar.updateGobackFlags, acct: ar.updateAcctFlags };
    const next = { ...map[flagType], [k]: !map[flagType][k] };
    updater[flagType](next);
  };

  const saveNote = (nk, text) => {
    if (!text) return;
    const next = { ...ar.notes, [nk]: [...(ar.notes[nk] || []), { text, ts: Date.now() }] };
    ar.updateNotes(next);
    setNoteInputs((p) => ({ ...p, [nk]: "" }));
  };

  const saveExpDate = (inv, isoVal) => {
    const d = fromISO(isoVal);
    if (!d) return;
    const k = invKey(c.name, inv.num, inv.date);
    const ds = toDateStr(d);
    ar.updateExpDates({ ...ar.expectedDates, [k]: ds });
    const nk = invKey(c.name, inv.num, inv.date);
    const next = { ...ar.notes, [nk]: [...(ar.notes[nk] || []), { text: "Expected payment date set to " + ds, ts: Date.now() }] };
    ar.updateNotes(next);
  };

  const saveEmail = (val) => { ar.updateEmails({ ...ar.custEmails, [c.name]: val }); };

  return (
    <>
      <div style={S.overlay} onClick={onClose} />
      <div style={S.panel}>
        <div style={S.header}>
          <div style={S.headerTop}>
            <div>
              <div style={S.label}>Customer</div>
              <div style={S.name}>{c.name}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button style={S.printBtn} onClick={(e) => { e.stopPropagation(); exportDetailView(ar, c, bucketFilter); }}>
                <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "currentColor" }}><path d="M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zM8 5h8v3H8V5zm8 14H8v-4h8v4zm2-4v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4h-2z"/></svg>
                Print
              </button>
              <button style={S.closeBtn} onClick={onClose}>&times;</button>
            </div>
          </div>

          {/* Bucket pills */}
          <div style={S.buckets}>
            {buckets.map((b) => {
              const active = bucketFilter === b.k;
              return (
                <div key={b.k} onClick={() => b.v ? setBucketFilter(bucketFilter === b.k ? null : b.k) : null}
                  style={{ ...S.bucket, cursor: b.v ? "pointer" : "default", background: b.v ? b.c.lt : "#f9fafb", border: `1px solid ${b.v ? b.c.bg + "33" : "#e5e7eb"}`, ...(active ? { outline: `2px solid ${b.c.bg}`, outlineOffset: 2 } : {}) }}>
                  <div style={{ ...S.bucketLabel, color: b.v ? b.c.tx : "#9ca3af" }}>{b.l}</div>
                  <div style={{ ...S.bucketVal, color: b.v ? b.c.bg : "#d1d5db" }}>{fmt(b.v)}</div>
                </div>
              );
            })}
            {retTotal > 0 && (
              <div onClick={() => setBucketFilter(bucketFilter === "retention" ? null : "retention")}
                style={{ ...S.bucket, cursor: "pointer", background: COL.ret.lt, border: `1px solid ${COL.ret.bg}33`, ...(bucketFilter === "retention" ? { outline: `2px solid ${COL.ret.bg}`, outlineOffset: 2 } : {}) }}>
                <div style={{ ...S.bucketLabel, color: COL.ret.tx }}>Retention</div>
                <div style={{ ...S.bucketVal, color: COL.ret.bg }}>{fmt(retTotal)}</div>
              </div>
            )}
            {collTotal > 0 && (
              <div onClick={() => setBucketFilter(bucketFilter === "collections" ? null : "collections")}
                style={{ ...S.bucket, cursor: "pointer", background: COL.coll.lt, border: `1px solid ${COL.coll.bg}33`, ...(bucketFilter === "collections" ? { outline: `2px solid ${COL.coll.bg}`, outlineOffset: 2 } : {}) }}>
                <div style={{ ...S.bucketLabel, color: COL.coll.tx }}>In Collections</div>
                <div style={{ ...S.bucketVal, color: COL.coll.bg }}>{fmt(collTotal)}</div>
              </div>
            )}
            {gobackTotal > 0 && (
              <div onClick={() => setBucketFilter(bucketFilter === "goback" ? null : "goback")}
                style={{ ...S.bucket, cursor: "pointer", background: COL.goback.lt, border: `1px solid ${COL.goback.bg}33`, ...(bucketFilter === "goback" ? { outline: `2px solid ${COL.goback.bg}`, outlineOffset: 2 } : {}) }}>
                <div style={{ ...S.bucketLabel, color: COL.goback.tx }}>Go Back</div>
                <div style={{ ...S.bucketVal, color: COL.goback.bg }}>{fmt(gobackTotal)}</div>
              </div>
            )}
          </div>

          <div style={S.totalBar}>
            <span style={S.totalLabel}>TOTAL OPEN</span>
            <span style={S.totalVal}>{fmt(c.total)}</span>
          </div>

          {/* Email */}
          <div style={S.emailBar}>
            <span style={S.emailLabel}>EMAIL:</span>
            <input style={S.emailInput} defaultValue={email} placeholder="customer@email.com"
              onBlur={(e) => saveEmail(e.target.value)} />
          </div>
        </div>

        {/* Content */}
        <div style={S.content}>
          <div style={S.sectionLabel}>Transactions ({sorted.length})</div>
          {sections.map((sec) => {
            if (!sec.items.length) return null;
            const matchCount = bucketFilter ? sec.items.filter(matchFilter).length : sec.items.length;
            if (bucketFilter && matchCount === 0) return null;
            const secTotal = sec.items.reduce((s, inv) => s + inv.openBalance, 0);
            return (
              <div key={sec.key} style={{ marginBottom: 16 }}>
                <div style={{ ...S.secHeader, background: sec.color + "11", borderLeft: `3px solid ${sec.color}` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: sec.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{sec.label} ({sec.items.length})</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: sec.color, fontFamily: "monospace" }}>{fmt(secTotal)}</span>
                </div>
                {sec.items.map((inv) => {
                  const idx = inv._sortIdx;
                  const isExp = expandedIdx === idx;
                  const dimmed = bucketFilter && !matchFilter(inv);
                  const nk = invKey(c.name, inv.num, inv.date);
                  const invNotes = ar.getNotes(nk);
                  const od = daysOverdue(inv.dueDate);
                  const expKey = invKey(c.name, inv.num, inv.date);
                  const expDate = ar.expectedDates[expKey] || "";

                  return (
                    <div key={nk + idx} style={{ ...S.invCard, ...(dimmed ? { opacity: 0.25, pointerEvents: "none" } : {}) }}>
                      <div style={S.invHeader} onClick={() => setExpandedIdx(isExp ? null : idx)}>
                        <div style={S.invTop}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={S.invNum}>#{inv.num || "\u2014"}</span>
                            <span style={{ ...S.invType, ...(inv.type === "Payment" ? { background: "#d1fae5", color: "#065f46" } : inv.type === "Credit Memo" ? { background: "#dbeafe", color: "#1e40af" } : {}) }}>{inv.type}</span>
                            <AgeBadge bucket={inv.bucket} />
                            {ar.isRetention(inv, c.name) && <FlagBadge label="Retention" bg={COL.ret.lt} color={COL.ret.bg} />}
                            {ar.isCollections(inv, c.name) && <FlagBadge label="In Collections" bg={COL.coll.lt} color={COL.coll.bg} />}
                            {ar.isGoback(inv, c.name) && <FlagBadge label="Go Back" bg={COL.goback.lt} color={COL.goback.bg} />}
                            {invNotes.length > 0 && <div style={S.noteDot} />}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={S.invBal}>{fmt(inv.openBalance)}</span>
                            <div style={{ ...S.expand, transform: isExp ? "rotate(90deg)" : "none" }}>{"\u203A"}</div>
                          </div>
                        </div>
                        {inv.job && <div style={S.invJob}>{inv.job}</div>}
                        <div style={S.invMeta}>
                          <span>Date: {inv.date}</span>
                          <span style={{ margin: "0 6px" }}>{"\u00B7"}</span>
                          <span>Due: {inv.dueDate}</span>
                          {od > 0 && <><span style={{ margin: "0 6px" }}>{"\u00B7"}</span><span style={{ color: "#dc2626", fontWeight: 700 }}>{od}d overdue</span></>}
                          {Math.abs(inv.amount - inv.openBalance) > 0.01 && <><span style={{ margin: "0 6px" }}>{"\u00B7"}</span><span>Orig: {fmt(inv.amount)}</span></>}
                          {expDate && <><span style={{ margin: "0 6px" }}>{"\u00B7"}</span><span style={{ color: "#059669" }}>Exp: {expDate}</span></>}
                        </div>
                      </div>

                      {/* Expanded panel */}
                      {isExp && (
                        <div style={S.invExpanded}>
                          {/* Flag toggles */}
                          {[
                            { flag: "ret", label: "Mark as Retention", checked: ar.isRetention(inv, c.name) },
                            { flag: "coll", label: "In Collections", checked: ar.isCollections(inv, c.name) },
                            { flag: "goback", label: "Go Back Issue", checked: ar.isGoback(inv, c.name) },
                            { flag: "acct", label: "Accountant Review", checked: ar.isAccountantReview(inv, c.name) },
                          ].map((f) => (
                            <label key={f.flag} style={S.flagToggle}>
                              <input type="checkbox" checked={f.checked} onChange={() => toggleFlag(f.flag, inv)} style={{ display: "none" }} />
                              <div style={{ ...S.checkbox, ...(f.checked ? { background: C.tealDark, borderColor: C.tealDark, color: "#fff" } : {}) }}>{"\u2713"}</div>
                              <span style={S.flagLabel}>{f.label}</span>
                            </label>
                          ))}

                          {/* Expected date */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#6b7280" }}>EXPECTED PAYMENT:</span>
                            <input type="date" defaultValue={expDate ? toISODate(parseDate(expDate)) : ""}
                              style={S.dateInput}
                              onChange={(e) => saveExpDate(inv, e.target.value)} />
                          </div>

                          {/* Notes */}
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e5e7eb" }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#6b7280", textTransform: "uppercase", marginBottom: 8 }}>Notes ({invNotes.length})</div>
                            <textarea style={S.noteInput} placeholder="Add a note..." rows={2}
                              value={noteInputs[nk] || ""}
                              onChange={(e) => setNoteInputs((p) => ({ ...p, [nk]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(nk, noteInputs[nk]); }} />
                            <div style={S.noteActions}>
                              <span style={{ fontSize: 10, color: "#9ca3af" }}>Ctrl+Enter to save</span>
                              <button style={S.noteSaveBtn} onClick={() => saveNote(nk, noteInputs[nk])}>Save</button>
                            </div>
                            {invNotes.map((n, ni) => (
                              <div key={ni} style={S.noteCard}>
                                <div style={{ fontSize: 12, color: C.textBody }}>{n.text}</div>
                                <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>{fmtTs(n.ts)}</div>
                              </div>
                            ))}
                            {!invNotes.length && <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>No notes yet</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* General customer notes */}
          {(() => {
            const ck = custNoteKey(c.name);
            const cn = ar.getNotes(ck);
            return (
              <div style={{ marginTop: 20 }}>
                <div style={S.sectionLabel}>General Customer Notes ({cn.length})</div>
                <textarea style={S.noteInput} placeholder="Add a general note..." rows={3}
                  value={noteInputs[ck] || ""}
                  onChange={(e) => setNoteInputs((p) => ({ ...p, [ck]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(ck, noteInputs[ck]); }} />
                <div style={S.noteActions}>
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>Ctrl+Enter to save</span>
                  <button style={S.noteSaveBtn} onClick={() => saveNote(ck, noteInputs[ck])}>Save</button>
                </div>
                {cn.map((n, ni) => (
                  <div key={ni} style={S.noteCard}>
                    <div style={{ fontSize: 12, color: C.textBody }}>{n.text}</div>
                    <div style={{ fontSize: 10, color: C.textFaint, marginTop: 4 }}>{fmtTs(n.ts)}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}

const S = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 },
  panel: { position: "fixed", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "100vw", background: C.linen, zIndex: 201, display: "flex", flexDirection: "column", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)" },
  header: { background: C.dark, padding: "20px 24px 16px", flexShrink: 0 },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  label: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" },
  name: { fontFamily: F.display, fontSize: 22, fontWeight: 800, color: "#fff", marginTop: 2 },
  printBtn: { background: C.darkRaised, border: `1px solid ${C.darkBorder}`, borderRadius: 6, padding: "5px 12px", color: "rgba(255,255,255,0.6)", fontFamily: F.display, fontSize: 11, cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: 5 },
  closeBtn: { background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 28, cursor: "pointer", padding: "0 4px", lineHeight: 1 },
  buckets: { display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" },
  bucket: { borderRadius: 8, padding: "8px 12px", textAlign: "center", minWidth: 70 },
  bucketLabel: { fontFamily: F.display, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" },
  bucketVal: { fontFamily: F.display, fontSize: 16, fontWeight: 800, marginTop: 2 },
  totalBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "10px 16px", background: C.darkRaised, borderRadius: 8 },
  totalLabel: { fontFamily: F.display, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.5)" },
  totalVal: { fontFamily: F.display, fontSize: 22, fontWeight: 800, color: C.pop },
  emailBar: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 },
  emailLabel: { fontFamily: F.display, fontSize: 10, fontWeight: 700, color: C.textFaint, letterSpacing: "0.08em" },
  emailInput: { flex: 1, background: C.darkRaised, border: `1px solid ${C.darkBorder}`, borderRadius: 6, padding: "5px 10px", color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: F.body },
  content: { flex: 1, overflowY: "auto", padding: "16px 24px 40px" },
  sectionLabel: { fontFamily: F.display, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textMuted, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}` },
  secHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: "0 8px 8px 0", marginBottom: 8 },
  invCard: { border: `1px solid ${C.borderStrong}`, borderRadius: 10, marginBottom: 8, overflow: "hidden", background: C.linenCard },
  invHeader: { padding: "12px 14px", cursor: "pointer" },
  invTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  invNum: { fontFamily: F.display, fontSize: 14, fontWeight: 800, color: C.textHead },
  invType: { fontSize: 9, fontWeight: 700, fontFamily: F.display, padding: "2px 7px", borderRadius: 4, background: C.linenCard, color: C.textMuted, letterSpacing: "0.04em" },
  invBal: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: C.textHead },
  expand: { fontSize: 18, color: C.textFaint, transition: "transform 0.15s", fontWeight: 700 },
  invJob: { fontSize: 11, color: C.textLight, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  invMeta: { fontSize: 10, color: C.textFaint, marginTop: 4 },
  invExpanded: { padding: "12px 14px", borderTop: `1px solid ${C.border}`, background: C.linenDeep },
  noteDot: { width: 8, height: 8, borderRadius: "50%", background: C.teal },
  flagToggle: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, border: "2px solid #d1d5db", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "transparent", transition: "all 0.15s" },
  flagLabel: { fontSize: 11, fontWeight: 600, color: C.textMuted },
  dateInput: { background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: C.textBody },
  noteInput: { width: "100%", background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontFamily: F.body, color: C.textBody, resize: "vertical" },
  noteActions: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 8 },
  noteSaveBtn: { background: C.tealDark, color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", fontSize: 10, fontWeight: 700, fontFamily: F.display, cursor: "pointer" },
  noteCard: { background: C.linenLight, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
};
