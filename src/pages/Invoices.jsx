import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmtD } from "../lib/utils";
import { INV_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

// ── WTC calc helpers (same as Proposals.jsx / WTCCalculator.jsx) ──────────
function calcMaterialRowLocal(item) {
  const price = parseFloat(item.price_per_unit) || 0;
  const qty   = parseFloat(item.qty) || 0;
  const base  = price * qty;
  const tax   = base * ((parseFloat(item.tax) || 0) / 100);
  const freight = parseFloat(item.freight) || 0;
  const subtotal = base + tax + freight;
  const markup = subtotal * ((parseFloat(item.markup_pct) || 0) / 100);
  return subtotal + markup;
}

function calcTravelLocal(t) {
  if (!t) return 0;
  const drive    = (t.drive_rate || 0) * (t.drive_miles || 0);
  const fly      = (t.fly_rate || 0) * (t.fly_tickets || 0);
  const stay     = (t.stay_rate || 0) * (t.stay_nights || 0);
  const per_diem = (t.per_diem_rate || 0) * (t.per_diem_days || 0) * (t.per_diem_crew || 0);
  return drive + fly + stay + per_diem;
}

function calcLaborLocal({ regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate }) {
  const regularCost = (regular_hours || 0) * (burden_rate || 0);
  const otCost = (ot_hours || 0) * (ot_burden_rate || 0);
  const subtotal = regularCost + otCost;
  const markupAmt = subtotal * ((markup_pct || 0) / 100);
  const total = subtotal + markupAmt;
  return { total };
}

function calcWtcPrice(wtc) {
  const rate = wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLaborLocal({ regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours, markup_pct: wtc.markup_pct, burden_rate: rate, ot_burden_rate: otRate });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRowLocal(i), 0);
  const trav = calcTravelLocal(wtc.travel);
  return labor.total + mats + trav - (wtc.discount || 0);
}

// ── Shared styles ─────────────────────────────────────────────────────────
const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  boxSizing: "border-box",
  WebkitAppearance: "none",
};

const labelStyle = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
  textTransform: "uppercase", color: C.textFaint,
  fontFamily: F.display, marginBottom: 6,
};

// ── New Invoice Modal ─────────────────────────────────────────────────────
function NewInvoiceModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1); // 1=select proposal, 2=billing %
  const [proposals, setProposals] = useState([]);
  const [search, setSearch] = useState("");
  const [selProposal, setSelProposal] = useState(null);
  const [wtcs, setWtcs] = useState([]);
  const [billingPcts, setBillingPcts] = useState({});
  const [existingLines, setExistingLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dueDate, setDueDate] = useState("");

  // Step 1: load Sold proposals
  useEffect(() => {
    async function loadProposals() {
      const { data } = await supabase
        .from("proposals")
        .select("id, customer, total, proposal_number, call_log_id, call_log(display_job_number, customer_name, job_name)")
        .eq("status", "Sold")
        .order("created_at", { ascending: false });
      setProposals(data || []);
    }
    loadProposals();
  }, []);

  // Step 2: load WTCs + existing invoice lines for selected proposal
  async function selectProposal(p) {
    setSelProposal(p);
    setError(null);

    const [{ data: wtcData }, { data: linesData }] = await Promise.all([
      supabase.from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", p.id),
      supabase.from("invoice_lines")
        .select("proposal_wtc_id, billing_pct")
        .in("invoice_id",
          (await supabase.from("invoices").select("id").eq("proposal_id", p.id)).data?.map(i => i.id) || []
        ),
    ]);

    setWtcs(wtcData || []);
    setExistingLines(linesData || []);

    // Init billing pcts to 0
    const pcts = {};
    (wtcData || []).forEach(w => { pcts[w.id] = ""; });
    setBillingPcts(pcts);
    setStep(2);
  }

  function getBilledPct(wtcId) {
    return existingLines
      .filter(l => l.proposal_wtc_id === wtcId)
      .reduce((sum, l) => sum + (parseFloat(l.billing_pct) || 0), 0);
  }

  function getRemainingPct(wtcId) {
    return 100 - getBilledPct(wtcId);
  }

  function getLineAmount(wtc) {
    const pct = parseFloat(billingPcts[wtc.id]) || 0;
    return calcWtcPrice(wtc) * (pct / 100);
  }

  const invoiceTotal = wtcs.reduce((sum, w) => sum + getLineAmount(w), 0);
  const hasAnyPct = Object.values(billingPcts).some(v => parseFloat(v) > 0);

  function validatePcts() {
    for (const w of wtcs) {
      const pct = parseFloat(billingPcts[w.id]) || 0;
      if (pct < 0) return "Billing % cannot be negative";
      if (pct > getRemainingPct(w.id)) return `${w.work_types?.name || "WTC"} exceeds remaining % (${getRemainingPct(w.id)}% left)`;
    }
    if (!hasAnyPct) return "Enter a billing % for at least one work type";
    return null;
  }

  async function handleCreate() {
    const valErr = validatePcts();
    if (valErr) { setError(valErr); return; }
    setSaving(true);
    setError(null);

    const jobNum = selProposal.call_log?.display_job_number || selProposal.call_log?.job_name || "";
    const jobName = selProposal.call_log?.job_name || selProposal.customer || "";

    // Create invoice
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert([{
        job_id: jobNum,
        job_name: jobName,
        status: "New",
        amount: Math.round(invoiceTotal * 100) / 100,
        discount: 0,
        proposal_id: selProposal.id,
        due_date: dueDate || null,
      }])
      .select()
      .single();

    if (invErr) { setError(invErr.message); setSaving(false); return; }

    // Create invoice lines
    const lines = wtcs
      .filter(w => parseFloat(billingPcts[w.id]) > 0)
      .map(w => ({
        invoice_id: inv.id,
        proposal_wtc_id: w.id,
        billing_pct: parseFloat(billingPcts[w.id]),
        amount: Math.round(getLineAmount(w) * 100) / 100,
      }));

    if (lines.length > 0) {
      const { error: lineErr } = await supabase.from("invoice_lines").insert(lines);
      if (lineErr) { setError(lineErr.message); setSaving(false); return; }
    }

    setSaving(false);
    onCreated(inv);
  }

  const filtered = proposals.filter(p => {
    const q = search.toLowerCase();
    const jobNum = (p.call_log?.display_job_number || "").toLowerCase();
    const cust = (p.call_log?.customer_name || p.customer || "").toLowerCase();
    return jobNum.includes(q) || cust.includes(q);
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: step === 1 ? 540 : 640, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {step === 1 ? "New Invoice" : "Select Billing %"}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        {step === 1 && (
          <>
            <div style={labelStyle}>Select a Sold Proposal</div>
            <input
              placeholder="Search job # or customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              style={{ ...inputStyle, marginBottom: 12 }}
            />
            <div style={{ flex: 1, overflowY: "auto", maxHeight: 340 }}>
              {filtered.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>
                  {proposals.length === 0 ? "No Sold proposals found" : "No matches"}
                </div>
              )}
              {filtered.map(p => (
                <div key={p.id} onClick={() => selectProposal(p)}
                  style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = C.linenDeep}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.textHead, fontFamily: F.display }}>
                      {p.call_log?.display_job_number || `Proposal #${p.id}`} P{p.proposal_number || 1}
                    </div>
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>{p.call_log?.customer_name || p.customer}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontFamily: F.display, color: C.textHead }}>{fmt$(p.total)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginBottom: 16 }}>
              <span style={{ fontWeight: 800, color: C.textHead }}>{selProposal.call_log?.display_job_number || `Proposal #${selProposal.id}`}</span>
              {" · "}{selProposal.call_log?.customer_name || selProposal.customer}
              <button onClick={() => setStep(1)} style={{ marginLeft: 12, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: F.display }}>← Change</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", maxHeight: 380 }}>
              {wtcs.map(w => {
                const total = calcWtcPrice(w);
                const billed = getBilledPct(w.id);
                const remaining = getRemainingPct(w.id);
                const pctVal = parseFloat(billingPcts[w.id]) || 0;
                const lineAmt = total * (pctVal / 100);

                return (
                  <div key={w.id} style={{ background: C.linenDeep, borderRadius: 10, padding: 16, marginBottom: 10, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: C.textHead, fontFamily: F.display }}>{w.work_types?.name || `WTC ${w.id}`}</div>
                        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>Total: {fmt$(total)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, fontFamily: F.ui, color: billed > 0 ? C.amber : C.textFaint }}>
                          {billed > 0 ? `${billed}% billed` : "Not yet billed"}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: F.ui, color: C.green, fontWeight: 700 }}>{remaining}% remaining</div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "center" }}>
                      <div>
                        <div style={{ ...labelStyle, marginBottom: 4 }}>Bill %</div>
                        <div style={{ position: "relative" }}>
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            step="1"
                            value={billingPcts[w.id]}
                            onChange={e => setBillingPcts(prev => ({ ...prev, [w.id]: e.target.value }))}
                            placeholder="0"
                            style={{ ...inputStyle, paddingRight: 28 }}
                          />
                          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: C.textFaint, fontSize: 13, fontFamily: F.ui }}>%</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                        <button onClick={() => setBillingPcts(prev => ({ ...prev, [w.id]: String(remaining) }))}
                          style={{ background: C.dark, border: `1px solid ${C.darkBorder}`, borderRadius: 6, padding: "6px 12px", color: C.teal, fontSize: 11, fontWeight: 700, fontFamily: F.display, cursor: "pointer", marginBottom: 0, whiteSpace: "nowrap" }}>
                          Bill Remaining
                        </button>
                        {pctVal > 0 && (
                          <div style={{ fontSize: 14, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>= {fmt$(lineAmt)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Due date */}
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Due Date (optional)</div>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, width: 200, cursor: "pointer" }} />
            </div>

            {/* Total + Create */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoice Total</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>{fmt$(invoiceTotal)}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {error && <div style={{ color: C.red, fontSize: 12, fontFamily: F.ui, maxWidth: 200 }}>{error}</div>}
                <Btn onClick={handleCreate} disabled={saving || !hasAnyPct}>
                  {saving ? "Creating…" : "Create Invoice"}
                </Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Invoice Detail ────────────────────────────────────────────────────────
function InvoiceDetail({ invoice, onBack, onUpdated }) {
  const [inv, setInv] = useState(invoice);
  const [lines, setLines] = useState([]);
  const [wtcMap, setWtcMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDetail() {
      // Fetch invoice lines with WTC info
      const { data: lineData } = await supabase
        .from("invoice_lines")
        .select("*, proposal_wtc:proposal_wtc_id(*, work_types(name))")
        .eq("invoice_id", inv.id);
      setLines(lineData || []);

      // Build WTC map for totals
      const map = {};
      (lineData || []).forEach(l => {
        if (l.proposal_wtc) map[l.proposal_wtc_id] = l.proposal_wtc;
      });
      setWtcMap(map);
      setLoading(false);
    }
    loadDetail();
  }, [inv.id]);

  async function updateStatus(newStatus) {
    const updates = { status: newStatus };
    if (newStatus === "Sent" && !inv.sent_at) updates.sent_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    setInv(prev => ({ ...prev, ...updates }));
    onUpdated && onUpdated();
  }

  const aging = () => {
    if (!inv.due_date) return null;
    return Math.round((new Date() - new Date(inv.due_date)) / 86400000);
  };
  const ageDays = aging();

  const statusActions = {
    "New":  [{ label: "Mark as Sent", status: "Sent" }],
    "Sent": [{ label: "Mark Waiting for Payment", status: "Waiting for Payment" }, { label: "Mark as Paid", status: "Paid" }],
    "Waiting for Payment": [{ label: "Mark as Paid", status: "Paid" }, { label: "Mark Past Due", status: "Past Due" }],
    "Past Due": [{ label: "Mark as Paid", status: "Paid" }],
  };

  const actions = statusActions[inv.status] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <button onClick={onBack} style={{ background: C.dark, border: "none", cursor: "pointer", color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 14px", borderRadius: 6, marginBottom: 20, alignSelf: "flex-start" }}>
        ← Invoices
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>
          Invoice #{inv.id}
        </h2>
        <Pill label={inv.status} cm={INV_C} />
        {ageDays !== null && (
          <span style={{ fontSize: 12, fontWeight: 800, fontFamily: F.display, color: ageDays > 0 ? C.red : ageDays === 0 ? C.amber : C.green }}>
            {ageDays > 0 ? `${ageDays}d overdue` : ageDays === 0 ? "Due today" : `${Math.abs(ageDays)}d until due`}
          </span>
        )}
      </div>
      <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui, marginBottom: 28 }}>
        {inv.job_id && `Job: ${inv.job_id}`}{inv.job_name ? ` · ${inv.job_name}` : ""}
        {inv.sent_at ? ` · Sent ${fmtD(inv.sent_at)}` : ""}
        {inv.due_date ? ` · Due ${fmtD(inv.due_date)}` : ""}
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Invoice Amount" value={fmt$(inv.amount)} accent={C.teal} />
        <StatCard label="Discount" value={inv.discount > 0 ? fmt$(inv.discount) : "—"} accent={C.amber} />
        <StatCard label="Net Total" value={fmt$((inv.amount || 0) - (inv.discount || 0))} accent={C.green} />
      </div>

      {/* Line items */}
      <div style={{ marginBottom: 24 }}>
        <div style={labelStyle}>Line Items</div>
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading…</div>
        ) : lines.length === 0 ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>No line items</div>
        ) : (
          <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
              <thead>
                <tr style={{ background: C.dark }}>
                  {["Work Type", "WTC Total", "Billing %", "Line Amount"].map(h => (
                    <th key={h} style={{ padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `1px solid ${C.darkBorder}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const wtc = l.proposal_wtc;
                  const wtcTotal = wtc ? calcWtcPrice(wtc) : 0;
                  return (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      <td style={{ padding: "12px 15px", fontWeight: 700, color: C.textHead }}>{wtc?.work_types?.name || "—"}</td>
                      <td style={{ padding: "12px 15px", fontVariantNumeric: "tabular-nums" }}>{fmt$(wtcTotal)}</td>
                      <td style={{ padding: "12px 15px" }}>
                        <span style={{ background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 6, fontWeight: 800, fontSize: 12 }}>{l.billing_pct}%</span>
                      </td>
                      <td style={{ padding: "12px 15px", fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status actions */}
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 10 }}>
          {actions.map(a => (
            <Btn key={a.status} sz="sm" onClick={() => updateStatus(a.status)}>{a.label}</Btn>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Invoices Page ────────────────────────────────────────────────────
export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [sel, setSel] = useState(null);

  const load = async () => {
    const { data } = await supabase.from("invoices").select("*").order("sent_at", { ascending: false });
    setInvoices(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const drafted = invoices.filter(i => i.status === "New").reduce((a, i) => a + (i.amount || 0), 0);
  const pending = invoices.filter(i => ["Sent","Waiting for Payment","Past Due"].includes(i.status)).reduce((a, i) => a + (i.amount || 0), 0);
  const paid    = invoices.filter(i => i.status === "Paid").reduce((a, i) => a + (i.amount || 0), 0);

  const aging = (inv) => {
    if (!inv.due_date) return null;
    return Math.round((new Date() - new Date(inv.due_date)) / 86400000);
  };

  if (sel) return <InvoiceDetail invoice={sel} onBack={() => { setSel(null); load(); }} onUpdated={load} />;

  return (
    <>
      {showModal && (
        <NewInvoiceModal
          onClose={() => setShowModal(false)}
          onCreated={(inv) => { setShowModal(false); setSel(inv); load(); }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Invoices" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Invoice</Btn>} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          <StatCard label="Total Drafted" value={fmt$(drafted)} accent={C.teal} />
          <StatCard label="Total Pending" value={fmt$(pending)} accent={C.amber} />
          <StatCard label="Total Paid"    value={fmt$(paid)}    accent={C.green} />
        </div>

        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",       l: "Invoice #", r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
              { k: "job_id",   l: "Job #",     r: v => <span style={{ fontWeight: 700, fontFamily: F.display }}>{v}</span> },
              { k: "job_name", l: "Job Name",  r: v => <span style={{ maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span> },
              { k: "status",   l: "Status",    r: v => <Pill label={v} cm={INV_C} /> },
              { k: "amount",   l: "Amount",    r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "discount", l: "Discount",  r: v => v > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
              { k: "sent_at",  l: "Sent",      r: v => fmtD(v) },
              { k: "due_date", l: "Due",       r: v => fmtD(v) },
              { k: "_aging",   l: "Aging",     r: (_, row) => {
                const d = aging(row);
                if (d === null) return <span style={{ color: C.textFaint }}>—</span>;
                return <span style={{ fontWeight: 800, fontFamily: F.display, color: d > 0 ? C.red : d === 0 ? C.amber : C.green }}>
                  {d > 0 ? `${d}d overdue` : d === 0 ? "Due today" : `${Math.abs(d)}d`}
                </span>;
              }},
            ]}
            rows={invoices}
            onRow={row => setSel(row)}
          />
        )}
      </div>
    </>
  );
}
