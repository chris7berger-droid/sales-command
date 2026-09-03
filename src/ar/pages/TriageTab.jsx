import { useState, useMemo } from "react";
import { C, F, COL } from "../lib/tokens";
import { fmt, daysOverdue, invKey, fmtTs, parseDate, toDateStr, toISODate, fromISO } from "../lib/utils";
import { useAR } from "../lib/ARContext";
import { getRecommendedAction } from "../lib/decisionEngine";
import { ReasonPicker, PlaybookPanel } from "../components/QBPlaybook";

const STATUSES = [
  { id: "good",    label: "Good",    icon: "\u2705", col: COL.tGood },
  { id: "unsure",  label: "Unsure",  icon: "\u2753", col: COL.tUnsure },
  { id: "problem", label: "Problem", icon: "\ud83d\udeab", col: COL.tProblem },
];

const STATUS_MAP = {};
STATUSES.forEach((s) => { STATUS_MAP[s.id] = s; });

function getIK(custName, inv) {
  return invKey(custName, inv.num, inv.date);
}

function isNonInvoice(inv) {
  const t = (inv.type || "").toLowerCase();
  return t.includes("journal") || t.includes("credit memo");
}

function AgeBadge({ bucket }) {
  const m = { over90: { l: "91+", ...COL.o90 }, days90: { l: "61-90", ...COL.d90 }, days60: { l: "31-60", ...COL.d60 }, days30: { l: "1-30", ...COL.d30 }, current: { l: "Current", ...COL.cur } }[bucket] || { l: "?", bg: "#6b7280", lt: "#f3f4f6" };
  return <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: F.display, background: m.lt, color: m.bg }}>{m.l}</span>;
}

function FlagBadge({ label, bg, color }) {
  return <span style={{ fontSize: 9, fontWeight: 700, fontFamily: F.display, padding: "2px 7px", borderRadius: 4, background: bg, color, letterSpacing: "0.04em" }}>{label}</span>;
}

function TriageBadge({ status }) {
  if (!status) return null;
  const s = STATUS_MAP[status];
  if (!s) return null;
  return <span style={{ fontSize: 9, fontWeight: 700, fontFamily: F.display, padding: "2px 7px", borderRadius: 4, background: s.col.bg, color: "#fff", letterSpacing: "0.04em" }}>{s.icon} {s.label}</span>;
}

function InvCard({ inv, custName, showCustName, ar, expandedInvKey, setExpandedInvKey, setInvTriage, toggleFlag, saveExpDate, saveNote, noteInputs, setNoteInputs, setDecision }) {
  const nk = invKey(custName, inv.num, inv.date);
  const isExp = expandedInvKey === nk;
  const invNotes = ar.getNotes(nk);
  const od = daysOverdue(inv.dueDate);
  const expDate = ar.expectedDates[nk] || "";
  const triageStatus = ar.triageFlags[nk];
  const decision = ar.decisions[nk] || null;
  const showDecisionEngine = triageStatus === "problem" || triageStatus === "unsure";

  return (
    <div style={S.invCard}>
      <div style={S.invHeader} onClick={() => setExpandedInvKey(isExp ? null : nk)}>
        <div style={S.invTop}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={S.invNum}>#{inv.num || "\u2014"}</span>
            <span style={{ ...S.invType, ...(inv.type === "Payment" ? { background: "#d1fae5", color: "#065f46" } : inv.type === "Credit Memo" ? { background: "#dbeafe", color: "#1e40af" } : {}) }}>{inv.type}</span>
            <AgeBadge bucket={inv.bucket} />
            {ar.isRetention(inv, custName) && <FlagBadge label="Retention" bg={COL.ret.lt} color={COL.ret.bg} />}
            {ar.isCollections(inv, custName) && <FlagBadge label="In Collections" bg={COL.coll.lt} color={COL.coll.bg} />}
            {ar.isGoback(inv, custName) && <FlagBadge label="Go Back" bg={COL.goback.lt} color={COL.goback.bg} />}
            {decision?.confirmedAt && <FlagBadge label="Action Set" bg="rgba(48,207,172,0.15)" color={C.tealDark} />}
            <TriageBadge status={triageStatus} />
            {invNotes.length > 0 && <div style={S.noteDot} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={S.invBal}>{fmt(inv.openBalance)}</span>
            <div style={S.quickBtns} onClick={(e) => e.stopPropagation()}>
              {STATUSES.map((s) => {
                const active = triageStatus === s.id;
                return (
                  <button key={s.id} onClick={() => setInvTriage(custName, inv, s.id)}
                    style={{ ...S.quickBtn, background: active ? s.col.bg : "transparent", color: active ? "#fff" : s.col.bg, border: `1.5px solid ${active ? s.col.bg : s.col.bg + "55"}` }}
                    title={s.label}>
                    {s.icon}
                  </button>
                );
              })}
            </div>
            <div style={{ ...S.expand, transform: isExp ? "rotate(90deg)" : "none" }}>{"\u203A"}</div>
          </div>
        </div>
        {showCustName && <div style={S.invCust}>{custName}</div>}
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

      {isExp && (
        <div style={S.invExpanded}>
          <div style={S.triageRow}>
            <span style={S.triageRowLabel}>TRIAGE:</span>
            {STATUSES.map((s) => {
              const active = triageStatus === s.id;
              return (
                <button key={s.id} onClick={() => setInvTriage(custName, inv, s.id)}
                  style={{
                    ...S.triageBtn,
                    background: active ? s.col.bg : C.dark,
                    color: active ? "#fff" : s.col.lt,
                    border: `2px solid ${s.col.bg}`,
                    ...(active ? { boxShadow: `0 2px 12px ${s.col.bg}55` } : {}),
                  }}>
                  <span>{s.icon}</span>
                  <span style={S.triageBtnLabel}>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Decision Engine — shown for Problem and Unsure invoices */}
          {showDecisionEngine && (
            <>
              <ReasonPicker currentReason={decision?.reason}
                onSelect={(reasonId) => {
                  const action = getRecommendedAction(reasonId, inv);
                  setDecision(nk, { reason: reasonId, action, overrideAction: null, confirmedAt: null });
                }} />
              {decision?.reason && (
                <PlaybookPanel reasonId={decision.reason} inv={inv} custName={custName} decision={decision}
                  onConfirm={(actionId) => {
                    setDecision(nk, { ...decision, action: actionId, confirmedAt: Date.now() });
                  }}
                  onOverride={(actionId) => {
                    setDecision(nk, { ...decision, overrideAction: actionId, confirmedAt: null });
                  }} />
              )}
            </>
          )}

          <div style={{ marginTop: 12 }}>
            {[
              { flag: "ret", label: "Mark as Retention", checked: ar.isRetention(inv, custName) },
              { flag: "coll", label: "In Collections", checked: ar.isCollections(inv, custName) },
              { flag: "goback", label: "Go Back Issue", checked: ar.isGoback(inv, custName) },
              { flag: "acct", label: "Accountant Review", checked: ar.isAccountantReview(inv, custName) },
            ].map((f) => (
              <label key={f.flag} style={S.flagToggle}>
                <input type="checkbox" checked={f.checked} onChange={() => toggleFlag(f.flag, inv, custName)} style={{ display: "none" }} />
                <div style={{ ...S.checkbox, ...(f.checked ? { background: C.tealDark, borderColor: C.tealDark, color: "#fff" } : {}) }}>{"\u2713"}</div>
                <span style={S.flagLabel}>{f.label}</span>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6b7280" }}>EXPECTED PAYMENT:</span>
            <input type="date" defaultValue={expDate ? toISODate(parseDate(expDate)) : ""}
              style={S.dateInput}
              onChange={(e) => saveExpDate(inv, custName, e.target.value)} />
          </div>

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
}

export default function TriageTab() {
  const ar = useAR();
  const [selectedCustIdx, setSelectedCustIdx] = useState(0);
  const [expandedInvKey, setExpandedInvKey] = useState(null);
  const [noteInputs, setNoteInputs] = useState({});
  const [scoreFilter, setScoreFilter] = useState(null); // null=all, "untriaged","good","unsure","problem"

  const custList = useMemo(() => {
    return ar.customers.slice().sort((a, b) => b.total - a.total);
  }, [ar.customers]);

  // Filter customer list based on scorecard selection
  const filteredCusts = useMemo(() => {
    if (!scoreFilter) return custList;
    return custList.filter((c) => c.invoices.some((inv) => {
      if (scoreFilter === "journal") return isNonInvoice(inv);
      if (isNonInvoice(inv)) return false;
      const s = ar.triageFlags[getIK(c.name, inv)];
      if (scoreFilter === "untriaged") return !s;
      return s === scoreFilter;
    }));
  }, [custList, ar.triageFlags, scoreFilter]);

  const selected = filteredCusts[selectedCustIdx] || filteredCusts[0] || null;

  // Stats — counts and dollar amounts per status
  const stats = useMemo(() => {
    let total = 0, triaged = 0;
    const count = { good: 0, unsure: 0, problem: 0, untriaged: 0, journal: 0 };
    const amt = { good: 0, unsure: 0, problem: 0, untriaged: 0, journal: 0 };
    ar.customers.forEach((c) => {
      c.invoices.forEach((inv) => {
        total++;
        if (isNonInvoice(inv)) {
          count.journal++; amt.journal += inv.openBalance;
          return;
        }
        const s = ar.triageFlags[getIK(c.name, inv)];
        if (s && count[s] !== undefined) {
          triaged++; count[s]++; amt[s] += inv.openBalance;
        } else {
          count.untriaged++; amt.untriaged += inv.openBalance;
        }
      });
    });
    return { total, triaged, count, amt };
  }, [ar.customers, ar.triageFlags]);

  const getCustTriageSummary = (c) => {
    let total = 0, triaged = 0;
    c.invoices.forEach((inv) => {
      if (isNonInvoice(inv)) return;
      total++;
      if (ar.triageFlags[getIK(c.name, inv)]) triaged++;
    });
    return { total, triaged, done: total > 0 && triaged === total };
  };

  const setInvTriage = (custName, inv, status) => {
    const k = getIK(custName, inv);
    const current = ar.triageFlags[k];
    if (current === status) {
      const next = { ...ar.triageFlags };
      delete next[k];
      ar.updateTriage(next);
    } else {
      ar.updateTriage({ ...ar.triageFlags, [k]: status });
    }
  };

  const triageAllForCust = (custName, invoices, status) => {
    const next = { ...ar.triageFlags };
    invoices.forEach((inv) => { next[getIK(custName, inv)] = status; });
    ar.updateTriage(next);
  };

  const toggleFlag = (flagType, inv, custName) => {
    const k = invKey(custName, inv.num, inv.date);
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

  const setDecision = (nk, decisionData) => {
    ar.updateDecisions({ ...ar.decisions, [nk]: decisionData });
  };

  const saveExpDate = (inv, custName, isoVal) => {
    const d = fromISO(isoVal);
    if (!d) return;
    const k = invKey(custName, inv.num, inv.date);
    const ds = toDateStr(d);
    ar.updateExpDates({ ...ar.expectedDates, [k]: ds });
    const next = { ...ar.notes, [k]: [...(ar.notes[k] || []), { text: "Expected payment date set to " + ds, ts: Date.now() }] };
    ar.updateNotes(next);
  };

  const pct = stats.total > 0 ? Math.round((stats.triaged / stats.total) * 100) : 0;

  // Flat list of all invoices matching the active scorecard filter (across all customers)
  const flatFilteredInvs = useMemo(() => {
    if (!scoreFilter || scoreFilter === "untriaged") return null; // use per-customer view
    const list = [];
    ar.customers.forEach((c) => {
      c.invoices.forEach((inv) => {
        if (scoreFilter === "journal") {
          if (isNonInvoice(inv)) list.push({ inv, custName: c.name });
        } else {
          if (isNonInvoice(inv)) return;
          const s = ar.triageFlags[getIK(c.name, inv)];
          if (s === scoreFilter) list.push({ inv, custName: c.name });
        }
      });
    });
    list.sort((a, b) => b.inv.openBalance - a.inv.openBalance);
    return list;
  }, [ar.customers, ar.triageFlags, scoreFilter]);

  // Sort invoices by aging bucket (oldest first) then by balance
  const bOrder = { over90: 0, days90: 1, days60: 2, days30: 3, current: 4 };
  const sortedInvoices = selected
    ? selected.invoices.slice()
        .filter((inv) => scoreFilter === "journal" ? isNonInvoice(inv) : !isNonInvoice(inv))
        .sort((a, b) => {
          const bo = (bOrder[a.bucket] || 4) - (bOrder[b.bucket] || 4);
          return bo !== 0 ? bo : b.openBalance - a.openBalance;
        })
    : [];

  const selectedUntriaged = selected
    ? selected.invoices.filter((inv) => !ar.triageFlags[getIK(selected.name, inv)]).length
    : 0;

  return (
    <div style={S.wrap}>
      {/* Scorecards */}
      <div style={S.scoreRow}>
        {[
          { id: "untriaged", label: "Untriaged", icon: "\u2014", bg: "#6b7280" },
          ...STATUSES.map((s) => ({ id: s.id, label: s.label, icon: s.icon, bg: s.col.bg })),
        ].map((s) => {
          const active = scoreFilter === s.id;
          const count = stats.count[s.id] || 0;
          const amount = stats.amt[s.id] || 0;
          return (
            <div key={s.id}
              onClick={() => { setScoreFilter(scoreFilter === s.id ? null : s.id); setSelectedCustIdx(0); setExpandedInvKey(null); }}
              style={{
                ...S.scoreCard,
                ...(active ? { background: s.bg, borderColor: s.bg, transform: "translateY(-2px)", boxShadow: `0 6px 20px ${s.bg}33` } : {}),
              }}>
              <div style={S.scoreLabel}>{s.icon} {s.label}</div>
              <div style={{ ...S.scoreAmt, color: active ? "#fff" : s.bg }}>{fmt(amount)}</div>
              <div style={{ ...S.scoreCount, ...(active ? { color: "rgba(255,255,255,0.7)" } : {}) }}>{count} invoice{count !== 1 ? "s" : ""}</div>
            </div>
          );
        })}
        <div style={{ ...S.scoreCard, ...(scoreFilter === "journal" ? { background: "#6366f1", borderColor: "#6366f1", transform: "translateY(-2px)", boxShadow: "0 6px 20px #6366f133" } : {}) }}
          onClick={() => { setScoreFilter(scoreFilter === "journal" ? null : "journal"); setSelectedCustIdx(0); setExpandedInvKey(null); }}>
          <div style={S.scoreLabel}>Credits / JEs</div>
          <div style={{ ...S.scoreAmt, color: scoreFilter === "journal" ? "#fff" : "#6366f1" }}>{fmt(stats.amt.journal)}</div>
          <div style={{ ...S.scoreCount, ...(scoreFilter === "journal" ? { color: "rgba(255,255,255,0.7)" } : {}) }}>{stats.count.journal} items</div>
        </div>
        <div style={{ ...S.scoreCard, ...(!scoreFilter ? { background: C.dark, borderColor: C.dark, transform: "translateY(-2px)" } : {}) }}
          onClick={() => { setScoreFilter(null); setSelectedCustIdx(0); setExpandedInvKey(null); }}>
          <div style={S.scoreLabel}>All</div>
          <div style={{ ...S.scoreAmt, color: !scoreFilter ? C.pop : C.textHead }}>{fmt(stats.amt.good + stats.amt.unsure + stats.amt.problem + stats.amt.untriaged)}</div>
          <div style={{ ...S.scoreCount, ...(!scoreFilter ? { color: "rgba(255,255,255,0.7)" } : {}) }}>{stats.total} invoices {"\u00b7"} {pct}% triaged</div>
        </div>
      </div>

      {/* Main layout */}
      <div style={S.main}>
        {/* Left — customer list */}
        <div style={S.left}>
          <div style={S.listHeader}>
            <span style={S.listTitle}>Customers</span>
            <span style={S.listCount}>{filteredCusts.length}</span>
          </div>
          <div style={S.listBody}>
            {filteredCusts.map((c, i) => {
              const isSelected = selected && c.name === selected.name;
              const summary = getCustTriageSummary(c);
              return (
                <div key={c.name} onClick={() => { setSelectedCustIdx(i); setExpandedInvKey(null); }}
                  style={{ ...S.listRow, ...(isSelected ? { background: C.linenDeep, borderLeftColor: C.teal } : {}) }}>
                  <div style={S.listRowTop}>
                    <span style={S.listName}>{c.name}</span>
                    <span style={S.listTotal}>{fmt(c.total)}</span>
                  </div>
                  <div style={S.listMeta}>
                    <span>{c.invoices.length} inv</span>
                    {summary.done ? (
                      <span style={{ color: COL.tGood.bg, fontWeight: 700 }}> {"\u2713"} Done</span>
                    ) : summary.triaged > 0 ? (
                      <span style={{ color: COL.tUnsure.bg, fontWeight: 600 }}> {summary.triaged}/{summary.total}</span>
                    ) : null}
                    {c.over90 > 0 && <span style={{ color: COL.o90.bg, fontWeight: 700 }}> {"\u00b7"} {fmt(c.over90)} 91+</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center — invoices with full detail expand */}
        <div style={S.center}>
          {flatFilteredInvs ? (
            /* Flat list view — all matching invoices across customers */
            <>
              <div style={S.centerHeader}>
                <div>
                  <div style={S.centerName}>{scoreFilter === "journal" ? "Credits / JEs" : STATUS_MAP[scoreFilter]?.label || scoreFilter}</div>
                  <div style={S.centerSub}>{flatFilteredInvs.length} invoices {"\u00b7"} {fmt(flatFilteredInvs.reduce((s, x) => s + x.inv.openBalance, 0))} total</div>
                </div>
              </div>
              <div style={S.invScroll}>
                {flatFilteredInvs.map(({ inv, custName }, i) => (
                  <InvCard key={getIK(custName, inv) + i} inv={inv} custName={custName} showCustName
                    ar={ar} expandedInvKey={expandedInvKey} setExpandedInvKey={setExpandedInvKey}
                    setInvTriage={setInvTriage} toggleFlag={toggleFlag} saveExpDate={saveExpDate}
                    saveNote={saveNote} noteInputs={noteInputs} setNoteInputs={setNoteInputs} setDecision={setDecision} />
                ))}
                {!flatFilteredInvs.length && <div style={S.noSelect}>No invoices in this category</div>}
              </div>
            </>
          ) : selected ? (
            /* Per-customer view */
            <>
              <div style={S.centerHeader}>
                <div>
                  <div style={S.centerName}>{selected.name}</div>
                  <div style={S.centerSub}>{selected.invoices.length} invoices {"\u00b7"} {fmt(selected.total)} total</div>
                </div>
              </div>

              {/* Aging summary */}
              <div style={S.buckets}>
                {[
                  { l: "Current", v: selected.current, c: COL.cur },
                  { l: "1-30", v: selected.days30, c: COL.d30 },
                  { l: "31-60", v: selected.days60, c: COL.d60 },
                  { l: "61-90", v: selected.days90, c: COL.d90 },
                  { l: "91+", v: selected.over90, c: COL.o90 },
                ].map((b) => (
                  <div key={b.l} style={{ ...S.bucket, background: b.v ? b.c.lt : "#f3f4f6", border: `1px solid ${b.v ? b.c.bg + "33" : "#e5e7eb"}` }}>
                    <div style={{ ...S.bLabel, color: b.v ? b.c.tx : "#9ca3af" }}>{b.l}</div>
                    <div style={{ ...S.bVal, color: b.v ? b.c.bg : "#d1d5db" }}>{fmt(b.v)}</div>
                  </div>
                ))}
              </div>

              <div style={S.invScroll}>
                {sortedInvoices.map((inv, i) => (
                  <InvCard key={invKey(selected.name, inv.num, inv.date) + i} inv={inv} custName={selected.name}
                    ar={ar} expandedInvKey={expandedInvKey} setExpandedInvKey={setExpandedInvKey}
                    setInvTriage={setInvTriage} toggleFlag={toggleFlag} saveExpDate={saveExpDate}
                    saveNote={saveNote} noteInputs={noteInputs} setNoteInputs={setNoteInputs} setDecision={setDecision} />
                ))}
              </div>
            </>
          ) : (
            <div style={S.noSelect}>Select a customer from the list</div>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  wrap: { maxWidth: 1260, margin: "0 auto", padding: "20px 16px" },

  // Scorecards
  scoreRow: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  scoreCard: { flex: "1 1 120px", minWidth: 120, border: `2px solid ${C.borderStrong}`, borderRadius: 10, padding: "16px 14px 14px", cursor: "pointer", textAlign: "left", transition: "all 0.2s", background: C.linenCard },
  scoreLabel: { fontFamily: F.display, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textMuted, marginBottom: 6 },
  scoreAmt: { fontFamily: F.display, fontSize: 22, fontWeight: 800, lineHeight: 1.1 },
  scoreCount: { fontSize: 11, color: C.textFaint, marginTop: 4 },

  // Main layout
  main: { display: "flex", gap: 16, height: "calc(100vh - 220px)" },
  left: { width: 300, flexShrink: 0, display: "flex", flexDirection: "column", background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden" },
  center: { flex: 1, display: "flex", flexDirection: "column", background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden" },

  // Customer list
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: C.dark, flexShrink: 0 },
  listTitle: { fontFamily: F.display, fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" },
  listCount: { fontFamily: F.display, fontSize: 11, fontWeight: 700, color: C.pop, background: C.darkRaised, padding: "2px 8px", borderRadius: 4 },
  listBody: { flex: 1, overflowY: "auto", minHeight: 0 },
  listRow: { padding: "10px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", borderLeft: "3px solid transparent", transition: "background 0.1s" },
  listRowTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  listName: { fontWeight: 600, fontSize: 12, color: C.textBody, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 },
  listTotal: { fontFamily: F.display, fontWeight: 800, fontSize: 13, color: C.textHead, flexShrink: 0, marginLeft: 8 },
  listMeta: { fontSize: 10, color: C.textFaint, marginTop: 2 },

  // Center header
  centerHeader: { background: C.dark, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
  centerName: { fontFamily: F.display, fontSize: 18, fontWeight: 800, color: "#fff" },
  centerSub: { fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 },
  bulkBtns: { display: "flex", alignItems: "center", gap: 6 },
  bulkLabel: { fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: F.display, letterSpacing: "0.06em" },
  bulkBtn: { background: C.darkRaised, border: "2px solid", borderRadius: 8, padding: "6px 10px", fontSize: 14, cursor: "pointer", transition: "all 0.15s" },

  // Buckets
  buckets: { display: "flex", gap: 6, padding: "10px 20px", flexWrap: "wrap", flexShrink: 0 },
  bucket: { borderRadius: 6, padding: "6px 10px", textAlign: "center", flex: "1 1 60px" },
  bLabel: { fontFamily: F.display, fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" },
  bVal: { fontFamily: F.display, fontSize: 14, fontWeight: 800, marginTop: 1 },

  // Invoice scroll
  invScroll: { flex: 1, overflowY: "auto", padding: "8px 16px 16px", minHeight: 0 },

  // Invoice card — matches DetailPanel
  invCard: { border: `1px solid ${C.borderStrong}`, borderRadius: 10, marginBottom: 8, overflow: "hidden", background: C.linenCard },
  invHeader: { padding: "12px 14px", cursor: "pointer" },
  invTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  invNum: { fontFamily: F.display, fontSize: 14, fontWeight: 800, color: C.textHead },
  invType: { fontSize: 9, fontWeight: 700, fontFamily: F.display, padding: "2px 7px", borderRadius: 4, background: C.linenCard, color: C.textMuted, letterSpacing: "0.04em" },
  invBal: { fontFamily: F.display, fontSize: 16, fontWeight: 800, color: C.textHead },
  quickBtns: { display: "flex", gap: 4 },
  quickBtn: { width: 28, height: 28, borderRadius: 6, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "all 0.12s" },
  expand: { fontSize: 18, color: C.textFaint, transition: "transform 0.15s", fontWeight: 700 },
  invCust: { fontSize: 12, fontWeight: 700, color: C.tealDark, marginTop: 4 },
  invJob: { fontSize: 11, color: C.textLight, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  invMeta: { fontSize: 10, color: C.textFaint, marginTop: 4 },
  noteDot: { width: 8, height: 8, borderRadius: "50%", background: C.teal },

  // Expanded panel — matches DetailPanel
  invExpanded: { padding: "12px 14px", borderTop: `1px solid ${C.border}`, background: C.linenDeep },

  // Triage buttons inside expanded
  triageRow: { display: "flex", alignItems: "center", gap: 8, paddingBottom: 12, borderBottom: `1px dashed ${C.border}` },
  triageRowLabel: { fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.08em", marginRight: 4 },
  triageBtn: { flex: 1, padding: "10px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 15 },
  triageBtnLabel: { fontFamily: F.display, fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" },

  // Flag toggles — matches DetailPanel
  flagToggle: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, border: "2px solid #d1d5db", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "transparent", transition: "all 0.15s" },
  flagLabel: { fontSize: 11, fontWeight: 600, color: C.textMuted },
  dateInput: { background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, color: C.textBody },
  noteInput: { width: "100%", background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontFamily: F.body, color: C.textBody, resize: "vertical" },
  noteActions: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 8 },
  noteSaveBtn: { background: C.tealDark, color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", fontSize: 10, fontWeight: 700, fontFamily: F.display, cursor: "pointer" },
  noteCard: { background: C.linenLight, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", marginBottom: 6 },

  noSelect: { padding: 60, textAlign: "center", color: C.textFaint, fontSize: 14, margin: "auto" },
};
