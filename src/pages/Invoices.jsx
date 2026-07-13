import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmt$, fmt$c, fmtD } from "../lib/utils";
import { calcWtcPrice, usesExactPricing, PROPOSAL_ERA } from "../lib/calc";
import { INV_C, PROP_C } from "../lib/mockData";
import { getTenantConfig, DEFAULTS } from "../lib/config";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import FilterBar from "../components/FilterBar";
import QBLinkModal from "../components/QBLinkModal";
import PayAppDetailModal from "../components/PayAppDetailModal";
import BillingScheduleSection from "../components/BillingScheduleSection";
import NewPayAppModal from "../components/NewPayAppModal";

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
export function NewInvoiceModal({ onClose, onCreated, preselectedProposal, onOpenPayApp }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(preselectedProposal ? 2 : 1); // 1=select proposal, 2=billing %
  const [proposals, setProposals] = useState([]);
  const [search, setSearch] = useState("");
  const [selProposal, setSelProposal] = useState(null);
  const [wtcs, setWtcs] = useState([]);
  const [billingPcts, setBillingPcts] = useState({});
  const [existingLines, setExistingLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [intro, setIntro] = useState("");
  const [archiveAmount, setArchiveAmount] = useState("");
  const [archiveBilled, setArchiveBilled] = useState(0);
  const [roundInvoice, setRoundInvoice] = useState(true);
  const [retentionPct, setRetentionPct] = useState("");
  const money = roundInvoice ? fmt$ : fmt$c;

  const tenantCfgRef = useRef(null);

  const [sovProposalIds, setSovProposalIds] = useState(new Set());

  // Step 1: load Sold proposals
  useEffect(() => {
    async function loadProposals() {
      const { data } = await supabase
        .from("proposals")
        .select(`id, customer, total, proposal_number, call_log_id, is_archive_proposal, historical_billed_amount, ${PROPOSAL_ERA}, call_log(display_job_number, customer_name, job_name, show_cents)`)
        .eq("status", "Sold")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      setProposals(data || []);
      const { data: scheds } = await supabase
        .from("billing_schedule")
        .select("proposal_id");
      if (scheds) setSovProposalIds(new Set(scheds.map(s => s.proposal_id)));
    }
    loadProposals();
  }, []);

  // Auto-select if a proposal was preselected (e.g. invoice modal opened from ProposalDetail)
  useEffect(() => {
    if (preselectedProposal && !selProposal) {
      selectProposal(preselectedProposal);
    }
  }, [preselectedProposal]);

  // Step 2: load WTCs + existing invoice lines for selected proposal
  async function selectProposal(p) {
    // If proposal has a billing schedule, route to pay app flow instead
    if (onOpenPayApp) {
      const { data: sch } = await supabase
        .from("billing_schedule")
        .select("id")
        .eq("proposal_id", p.id)
        .maybeSingle();
      if (sch) {
        onOpenPayApp(p);
        return;
      }
      // Customer flagged for pay apps but no schedule yet — auto-create from WTCs
      if (p.call_log_id) {
        const { data: cl } = await supabase.from("call_log").select("customer_id, customers(requires_pay_app)").eq("id", p.call_log_id).maybeSingle();
        if (cl?.customers?.requires_pay_app) {
          const { data: wtcRows } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id);
          if (wtcRows?.length) {
            const exact = usesExactPricing(p);
            const total = wtcRows.reduce((s, w) => s + calcWtcPrice(w, undefined, exact), 0);
            const { data: newSch } = await supabase.from("billing_schedule").insert({
              proposal_id: p.id, contract_sum: total, retainage_pct: 5, status: "active",
            }).select().single();
            if (newSch) {
              const lines = wtcRows.map((w, i) => ({
                billing_schedule_id: newSch.id,
                description: w.work_types?.name || `Work Type ${i + 1}`,
                scheduled_value: calcWtcPrice(w, undefined, exact),
                ordinal: i,
              }));
              await supabase.from("billing_schedule_lines").insert(lines);
              onOpenPayApp(p);
              return;
            }
          }
        }
      }
    }

    setSelProposal(p);
    setError(null);
    setIntro("");
    setDescription("");
    setRoundInvoice(!p.call_log?.show_cents);

    // Apply template substitutions for intro + description
    if (!tenantCfgRef.current) tenantCfgRef.current = await getTenantConfig();
    const cfg = tenantCfgRef.current;
    const jobNum = (p.call_log?.display_job_number || "").split(" - ")[0];
    const applySub = (t, workTypes) => t.replace("{job_number}", jobNum).replace("{work_type}", workTypes);

    if (p.is_archive_proposal) {
      const { data: priorInv } = await supabase
        .from("invoices")
        .select("amount")
        .eq("proposal_id", p.id)
        .is("deleted_at", null)
        .is("voided_at", null);
      const inSystem = (priorInv || []).reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
      const historical = parseFloat(p.historical_billed_amount) || 0;
      setArchiveBilled(inSystem + historical);
      setArchiveAmount("");
      const djn = p.call_log?.display_job_number || "";
      const parts = djn.split(" - ");
      const archiveWorkType = parts.length >= 3 ? parts[parts.length - 1] : p.call_log?.job_name || "";
      if (cfg.default_invoice_intro) setIntro(applySub(cfg.default_invoice_intro, archiveWorkType));
      if (cfg.default_invoice_description) setDescription(applySub(cfg.default_invoice_description, archiveWorkType));
      setStep(2);
      return;
    }

    const [{ data: wtcData }, { data: linesData }] = await Promise.all([
      supabase.from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", p.id)
        .order("created_at", { ascending: true }),
      supabase.from("invoice_lines")
        .select("proposal_wtc_id, billing_pct")
        .in("invoice_id",
          (await supabase.from("invoices").select("id").eq("proposal_id", p.id).is("deleted_at", null).is("voided_at", null)).data?.map(i => i.id) || []
        ),
    ]);

    setWtcs(wtcData || []);
    setExistingLines(linesData || []);

    const workTypeNames = (wtcData || []).map(w => w.work_types?.name).filter(Boolean).join(", ");
    if (cfg.default_invoice_intro) setIntro(applySub(cfg.default_invoice_intro, workTypeNames));
    if (cfg.default_invoice_description) setDescription(applySub(cfg.default_invoice_description, workTypeNames));

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
    // Exact/ceil choice lives ONLY on the per-WTC base inside calcWtcPrice.
    // Then cent-round EACH line for BOTH eras with Math.round (NOT roundPrice —
    // ceiling here would over-bill a legacy partial). invoiceTotal sums these
    // rounded lines, and invoice.amount = that sum, so header == Σ lines (no 1¢
    // detail/total split). (plan §3.2.1)
    const raw = calcWtcPrice(wtc, undefined, usesExactPricing(selProposal)) * (pct / 100);
    return Math.round(raw * 100) / 100;
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
    if (!dueDate) { setError("Due date is required."); return; }
    const isArchive = !!selProposal.is_archive_proposal;
    let archiveAmt = 0;
    if (isArchive) {
      archiveAmt = parseFloat(String(archiveAmount).replace(/[^0-9.\-]/g, ""));
      const remaining = (parseFloat(selProposal.total) || 0) - archiveBilled;
      if (!archiveAmt || archiveAmt <= 0) { setError("Enter an invoice amount."); return; }
      if (archiveAmt > remaining + 0.01) { setError(`Amount exceeds remaining (${(money)(remaining)} left).`); return; }
    } else {
      const valErr = validatePcts();
      if (valErr) { setError(valErr); return; }
    }
    setSaving(true);
    setError(null);

    const retPct = parseFloat(retentionPct) || 0;
    const grossForRetention = isArchive ? archiveAmt : invoiceTotal;
    const retAmt = Math.round(grossForRetention * (retPct / 100) * 100) / 100;

    // Generate next invoice ID — find the highest ID in the main sequence,
    // ignoring manually-renumbered outliers (e.g. 90360 matching a customer PO).
    const { data: recent } = await supabase
      .from("invoices")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(50);
    const nums = (recent || []).map(r => parseInt(r.id, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
    // Find the main cluster: use the median to identify the sequence, then take the max within 2x of median
    const median = nums.length ? nums[Math.floor(nums.length / 2)] : 10000;
    const seqNums = nums.filter(n => n <= median * 2);
    const lastNum = Math.max(seqNums.length ? seqNums[seqNums.length - 1] : 0, 9999);
    const nextId = String(lastNum + 1).padStart(5, "0");

    const jobNum = selProposal.call_log?.display_job_number || selProposal.call_log?.job_name || "";
    const jobName = selProposal.call_log?.job_name || selProposal.customer || "";
    const finalAmount = isArchive ? archiveAmt : invoiceTotal;

    // Create invoice — type set EXPLICITLY (Data Integrity #6): this handler only
    // mints regular/archive invoices ('regular'). A deposit is just a normal invoice
    // later pointed at by call_log.deposit_invoice_id (Mark-as-deposit toggle) — no
    // special create path. Pay-app invoices are minted in NewPayAppModal ('pay-app').
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert([{
        id: nextId,
        job_id: jobNum,
        call_log_id: selProposal.call_log_id,
        job_name: jobName,
        status: "New",
        type: "regular",
        amount: Math.round(finalAmount * 100) / 100,
        discount: 0,
        proposal_id: selProposal.id,
        due_date: dueDate || null,
        description: description.trim() || null,
        intro: intro.trim() || null,
        show_cents: !roundInvoice,
        retention_pct: retPct,
        retention_amount: retAmt,
      }])
      .select()
      .single();

    if (invErr) { setError(invErr.message); setSaving(false); return; }

    if (isArchive) {
      const { error: lineErr } = await supabase.from("invoice_lines").insert([{
        invoice_id: inv.id,
        proposal_wtc_id: null,
        billing_pct: null,
        amount: Math.round(archiveAmt * 100) / 100,
      }]);
      if (lineErr) { setError(lineErr.message); setSaving(false); return; }
    } else {
      const lines = wtcs
        .filter(w => parseFloat(billingPcts[w.id]) > 0)
        .map(w => ({
          invoice_id: inv.id,
          proposal_wtc_id: w.id,
          billing_pct: parseFloat(billingPcts[w.id]),
          amount: getLineAmount(w), // already cent-rounded (§3.2.1)
        }));
      if (lines.length > 0) {
        const { error: lineErr } = await supabase.from("invoice_lines").insert(lines);
        if (lineErr) { setError(lineErr.message); setSaving(false); return; }
      }
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
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.textHead, fontFamily: F.display, display: "flex", alignItems: "center", gap: 8 }}>
                      {p.call_log?.display_job_number || `Proposal #${p.id}`} P{p.proposal_number || 1}
                      {sovProposalIds.has(p.id) && (
                        <span style={{ background: C.dark, color: C.teal, fontSize: 9, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase" }}>Pay App</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>{p.call_log?.customer_name || p.customer}</div>
                  </div>
                  <span style={{ fontWeight: 800, fontFamily: F.display, color: C.textHead }}>{(p.call_log?.show_cents ? fmt$c : fmt$)(p.total)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 2 && selProposal && (
          <>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0, paddingRight: 4 }}>
            <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginBottom: 16 }}>
              <span style={{ fontWeight: 800, color: C.textHead }}>{selProposal.call_log?.display_job_number || `Proposal #${selProposal.id}`}</span>
              {" · "}{selProposal.call_log?.customer_name || selProposal.customer}
              {!preselectedProposal && (
                <button onClick={() => setStep(1)} style={{ marginLeft: 12, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: F.display }}>← Change</button>
              )}
            </div>

            {/* Rounding toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", background: C.linenDeep, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontFamily: F.display, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.06em" }}>Amount Display</div>
              <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                <button
                  onClick={() => setRoundInvoice(true)}
                  style={{ background: roundInvoice ? C.dark : "transparent", border: `1px solid ${roundInvoice ? C.teal : C.border}`, borderRadius: 6, padding: "6px 12px", color: roundInvoice ? C.teal : C.textFaint, fontSize: 11, fontWeight: 700, fontFamily: F.display, cursor: "pointer" }}
                >
                  Round
                </button>
                <button
                  onClick={() => setRoundInvoice(false)}
                  style={{ background: !roundInvoice ? C.dark : "transparent", border: `1px solid ${!roundInvoice ? C.teal : C.border}`, borderRadius: 6, padding: "6px 12px", color: !roundInvoice ? C.teal : C.textFaint, fontSize: 11, fontWeight: 700, fontFamily: F.display, cursor: "pointer" }}
                >
                  Exact
                </button>
              </div>
            </div>

            {selProposal.is_archive_proposal && (() => {
              const total = parseFloat(selProposal.total) || 0;
              const remaining = total - archiveBilled;
              const amt = parseFloat(String(archiveAmount).replace(/[^0-9.\-]/g, "")) || 0;
              return (
                <div style={{ background: C.linenDeep, borderRadius: 10, padding: 16, marginBottom: 10, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 14, color: C.textHead, fontFamily: F.display }}>Archive Job Proposal</span>
                        <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 8px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(142,68,173,0.25)" }}>ARCHIVE</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>
                        Sold: {money(total)} · Already billed: {money(archiveBilled)} · Remaining: <span style={{ color: C.green, fontWeight: 700 }}>{money(remaining)}</span>
                        {" · "}
                        <button
                          onClick={() => { onClose(); navigate(`/proposals/${selProposal.id}`); }}
                          title="Open the proposal to edit the historical billed amount"
                          style={{ background: "none", border: "none", padding: 0, color: C.tealDark, fontWeight: 700, fontFamily: F.ui, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                        >
                          Edit historical billed →
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ ...labelStyle, marginBottom: 4 }}>Invoice Amount</div>
                      <div style={{ position: "relative" }}>
                        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textFaint, fontFamily: F.ui }}>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={archiveAmount}
                          onChange={e => setArchiveAmount(e.target.value)}
                          placeholder="0"
                          style={{ ...inputStyle, paddingLeft: 24 }}
                        />
                      </div>
                    </div>
                    <button onClick={() => setArchiveAmount(String(remaining.toFixed(2)))}
                      style={{ background: C.dark, border: `1px solid ${C.darkBorder}`, borderRadius: 6, padding: "10px 14px", color: C.teal, fontSize: 11, fontWeight: 700, fontFamily: F.display, cursor: "pointer", whiteSpace: "nowrap" }}>
                      Bill Remaining
                    </button>
                  </div>
                  {amt > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>
                      This invoice: <span style={{ color: C.textHead, fontWeight: 800 }}>{money(amt)}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {!selProposal.is_archive_proposal && <div style={{ flex: 1, overflowY: "auto", maxHeight: 380 }}>
              {wtcs.map((w, i) => {
                const total = calcWtcPrice(w, undefined, usesExactPricing(selProposal));
                const billed = getBilledPct(w.id);
                const remaining = getRemainingPct(w.id);
                const pctVal = parseFloat(billingPcts[w.id]) || 0;
                const lineAmt = total * (pctVal / 100);
                const typeName = w.work_types?.name;

                return (
                  <div key={w.id} style={{ background: C.linenDeep, borderRadius: 10, padding: 16, marginBottom: 10, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>
                          {`WTC ${i + 1}`}{typeName ? ` — ${typeName}` : ""}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui, marginTop: 4 }}>{money(total)}</div>
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
                            onChange={e => { const v = Math.min(parseFloat(e.target.value) || 0, remaining); setBillingPcts(prev => ({ ...prev, [w.id]: v > 0 ? String(v) : e.target.value })); }}
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
                          <div style={{ fontSize: 14, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>= {money(lineAmt)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>}

            {/* Due date + Retention */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={labelStyle}>Due Date *</div>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} />
              </div>
              <div>
                <div style={labelStyle}>Retention (%)</div>
                <input type="number" min="0" max="100" step="0.5" value={retentionPct} onChange={e => setRetentionPct(e.target.value)} placeholder="0" style={inputStyle} />
                {parseFloat(retentionPct) > 0 && (() => {
                  const gross = selProposal.is_archive_proposal ? (parseFloat(String(archiveAmount).replace(/[^0-9.\-]/g, "")) || 0) : invoiceTotal;
                  const held = gross * (parseFloat(retentionPct) / 100);
                  return <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Held back: {fmt$c(held)} · Net due: {fmt$c(gross - held)}</div>;
                })()}
              </div>
            </div>

            {/* Email Intro (goes in the customer email body) */}
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Email Introduction</div>
              <textarea
                value={intro}
                onChange={e => setIntro(e.target.value)}
                rows={4}
                placeholder="This goes in the body of the customer email…"
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Appears in the email above the invoice card. Not printed on the invoice.</div>
            </div>

            {/* Work Description (prints on the invoice above Amount Due) */}
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Work Description</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe the work being billed…"
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              />
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Prints on the invoice above the Amount Due.</div>
            </div>
            </div>

            {/* Total + Create */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoice Total</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>{money(selProposal.is_archive_proposal ? (parseFloat(String(archiveAmount).replace(/[^0-9.\-]/g, "")) || 0) : invoiceTotal)}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {error && <div style={{ color: C.red, fontSize: 12, fontFamily: F.ui, maxWidth: 200 }}>{error}</div>}
                <Btn onClick={handleCreate} disabled={saving || (selProposal.is_archive_proposal ? !(parseFloat(String(archiveAmount).replace(/[^0-9.\-]/g, "")) > 0) : !hasAnyPct)}>
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

// ── Invoice PDF Modal ─────────────────────────────────────────────────────
// Preset label chips for invoice attachments (plan §7 #A). Freeform edit allowed.
// The common attachment is a release waiver (aka release of lien / lien release —
// same document), so the label field pre-fills this. Other attachments can be
// added with the label cleared (no title). No preset chips.
const DEFAULT_ATTACHMENT_LABEL = "Release Waiver";
const MAX_INVOICE_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file (plan §4.2)

// Only render an <a href> for a stored file_url that points at this project's
// public job-attachments storage. Blocks a javascript:/data: scheme from a
// tampered row reaching an anchor href — render plain text otherwise. (plan §4.5)
const ATTACHMENT_PUBLIC_PREFIX = `${import.meta.env.VITE_SUPABASE_URL || ""}/storage/v1/object/public/job-attachments/`;
function isSafeAttachmentHref(url) {
  return typeof url === "string" && url.startsWith(ATTACHMENT_PUBLIC_PREFIX);
}

// Single loader for an invoice's attachments — used by the modal reload, the
// InvoiceDetail reload, and the initial detail load so a future change (soft-
// delete filter, explicit columns, paging) can't diverge across three copies
// (review #7). Bounded at 3/invoice by the upload cap, so no .range() needed.
async function loadInvoiceAttachments(invoiceId) {
  const { data } = await supabase
    .from("invoice_attachments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at");
  return data || [];
}

function InvoicePDFModal({ invoice, lines, wtcIndex = {}, onClose, onSent, onQbSynced, hideSend = false, teamMember, recipients: parentRecipients, attachments = [] }) {
  const money = invoice.show_cents ? fmt$c : fmt$;
  const fmtPct = (n) => {
    const v = parseFloat(n) || 0;
    return invoice.show_cents ? `${v.toFixed(2)}%` : `${Math.round(v)}%`;
  };
  const [view, setView] = useState("preview");
  const [archiveCtx, setArchiveCtx] = useState({ isArchive: false, sold: 0, workTypes: "" });
  const [sending, setSending] = useState(false);
  const [sendDone, setSendDone] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sendWarnings, setSendWarnings] = useState([]);
  const [approving, setApproving] = useState(false);
  const [billingEmail, setBillingEmail] = useState("");
  const [billingName, setBillingName] = useState("");
  const [jobsiteAddress, setJobsiteAddress] = useState("");
  const [loadingContact, setLoadingContact] = useState(true);
  const [recips, setRecips] = useState([]);
  // Attachments are managed on the InvoiceDetail page (next to Recipients) and
  // passed in read-only here — the send view only REVIEWS what will go out; it
  // never creates/edits. Mirrors how recipients are managed on the detail page
  // and shown read-only in the send flow.
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });
  const [repContact, setRepContact] = useState({ phone: "", email: "" });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
    if (teamMember) {
      setRepContact({ phone: teamMember.phone || "", email: teamMember.email || "" });
    }
  }, []);

  const retentionAmt = parseFloat(invoice.retention_amount) || 0;
  const retentionPct = parseFloat(invoice.retention_pct) || 0;
  const netTotal = (invoice.amount || 0) - (invoice.discount || 0) - retentionAmt;
  const isDepositInvoice = (invoice.proposals?.call_log?.deposit_invoice_id || null) === invoice.id;

  // Load billing contact from customer_contacts (Billing Contact role) → fall back to customers table
  useEffect(() => {
    async function loadContact() {
      if (!invoice.proposal_id) { setLoadingContact(false); return; }
      const { data: prop } = await supabase
        .from("proposals")
        .select(`call_log_id, total, is_archive_proposal, ${PROPOSAL_ERA}, call_log(customer_id, customer_name, jobsite_address, jobsite_city, jobsite_state, jobsite_zip, customers(billing_email, billing_name, contact_email, email, first_name, last_name, name), job_work_types(work_types(name)))`)
        .eq("id", invoice.proposal_id)
        .maybeSingle();
      const cl = prop?.call_log;
      const cust = cl?.customers;
      const customerId = cl?.customer_id;

      if (customerId) {
        const { data: contactsAll } = await supabase
          .from("customer_contacts")
          .select("name, email, phone, role, is_primary, is_billing_contact, created_at")
          .eq("customer_id", customerId)
          .or("is_billing_contact.eq.true,role.eq.Billing Contact");
        const contacts = contactsAll || [];
        const bc = contacts.length
          ? (contacts.find(c => c.is_primary) || [...contacts].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0])
          : null;
        if (bc?.email) {
          setBillingEmail(bc.email);
          setBillingName(bc.name || "");
        } else if (cust) {
          // Include customers.email so the modal agrees with the Recipients card
          // and the edge fn on what's sendable (T5 #5).
          setBillingEmail(cust.billing_email || cust.contact_email || cust.email || "");
          setBillingName(cust.billing_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || cust.name || "");
        }
      } else if (cust) {
        setBillingEmail(cust.billing_email || cust.contact_email || cust.email || "");
        setBillingName(cust.billing_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || cust.name || "");
      }

      if (cl) {
        const parts = [cl.jobsite_address, cl.jobsite_city, cl.jobsite_state, cl.jobsite_zip].filter(Boolean);
        setJobsiteAddress(parts.length > 1 ? `${cl.jobsite_address || ""}\n${[cl.jobsite_city, cl.jobsite_state].filter(Boolean).join(", ")}${cl.jobsite_zip ? " " + cl.jobsite_zip : ""}` : parts.join(""));
      }
      if (prop?.is_archive_proposal) {
        const wtNames = (cl?.job_work_types || []).map(j => j.work_types?.name).filter(Boolean).join(", ");
        setArchiveCtx({ isArchive: true, sold: parseFloat(prop.total) || 0, workTypes: wtNames });
      }

      // Recipients (main + viewers). The Recipients section in InvoiceDetail
      // manages these; here we only read them to show the send summary and gate
      // the Send button. 0 rows → legacy single-recipient send (edge fn falls
      // back to the billing contact as main). (plan §4.3) When the parent
      // (InvoiceDetail) already holds the recipient list, it's passed in as a
      // prop and this fetch is skipped (T5 #10). The embed pulls the linked
      // contact's live email so the summary matches the send (T5 #1).
      if (!parentRecipients) {
        const { data: recipRows } = await supabase
          .from("invoice_recipients")
          .select("contact_name, contact_email, role, customer_contact_id, customer_contacts(email)")
          .eq("invoice_id", invoice.id)
          .order("created_at");
        setRecips(recipRows || []);
      }

      setLoadingContact(false);
    }
    loadContact();
  }, [invoice.proposal_id]);

  // Prefer the live linked-contact email over the stored snapshot (T5 #1).
  const liveRecipEmail = (r) => (r?.customer_contact_id && r?.customer_contacts?.email) || r?.contact_email || "";
  const sourceRecips = parentRecipients ?? recips;
  const mainRecip = sourceRecips.find(r => r.role === "main") || null;
  const viewerRecips = sourceRecips.filter(r => r.role === "viewer");
  const hasRecipRows = sourceRecips.length > 0;
  const noMainBlock = hasRecipRows && !mainRecip; // rows exist but none is main → blocked
  const mainEmail = liveRecipEmail(mainRecip);
  // Main exists but has no deliverable email — surface in the UI rather than
  // letting it reach the edge-fn 400 (T5 #2).
  const mainMissingEmail = hasRecipRows && !!mainRecip && !mainEmail.trim();

  async function handleSend() {
    // Block when recipient rows exist but none is main (mirrors the edge-fn 400
    // guard). UI gate; the edge fn is the authoritative gate. (plan §4.3)
    if (noMainBlock) { setSendError("No main recipient — pick who gets the pay link in the Recipients section."); return; }
    // Main is set but has no email — block here with a clear message instead of
    // bouncing off the edge-fn 400 (T5 #2).
    if (mainMissingEmail) { setSendError("The main recipient has no email address. Add one in the Recipients section, or pick a different main recipient."); return; }
    // Legacy / not-yet-configured invoice (0 rows): edge fn falls back to the
    // billing contact, so require one to exist (matches old behavior).
    if (!hasRecipRows && !billingEmail) { setSendError("No billing email found. Add a recipient or a billing email on the customer record."); return; }
    setSending(true);
    setSendError(null);
    try {
      // Recipients are loaded server-side from the DB — body carries display
      // fields only (customerEmail/amount are no longer trusted or sent). (plan §4.3)
      const { data, error: fnError } = await supabase.functions.invoke("send-invoice", {
        body: {
          invoiceId: invoice.id,
          customerName: billingName || "Customer",
          jobName: invoice.job_name || "",
          jobId: invoice.job_id || "",
          dueDate: invoice.due_date || null,
          senderEmail: repContact.email || "noreply@salescommand.app",
          intro: invoice.intro || null,
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed.");
      if (data?.error) throw new Error(data.error);
      const warnings = Array.isArray(data?.warnings) ? [...data.warnings] : [];
      // Sync to QuickBooks (skip test jobs). The send already succeeded — a QB
      // failure here is NON-FATAL: surface it as a warning, never flip
      // sendError/sendDone. The duplicate/skip errors arrive as data.error at
      // HTTP 200, so inspect {data, error} in a separate try. (plan §3 step 2 / B1)
      if (!(invoice.job_name || "").toLowerCase().includes("test")) {
        try {
          const { data: qb, error: qbErr } = await supabase.functions.invoke("qb-sync-invoice", { body: { invoiceId: invoice.id } });
          if (qb?.qbInvoiceId && qb?.error === "qb_link_persist_failed") {
            // QB created the invoice but the server couldn't save the link —
            // persist it here so it isn't orphaned + re-duplicated. (§3 step 1+2)
            await supabase.from("invoices").update({ qb_invoice_id: qb.qbInvoiceId }).eq("id", invoice.id);
          } else if (qbErr || qb?.error || qb?.skipped) {
            let msg = qb?.message || qb?.error || qbErr?.message || "sync failed";
            if (qb?.skipped) msg = `skipped (${qb.reason})`;
            try {
              const body = await qbErr?.context?.json?.();
              if (body?.message || body?.error) msg = body.message || body.error;
            } catch { /* not JSON */ }
            warnings.push(`QuickBooks: ${msg}`);
          }
        } catch {
          warnings.push("QuickBooks sync couldn't be reached — sync it manually from the invoice.");
        }
        onQbSynced && onQbSynced();
      }
      setSendWarnings(warnings);
      setSendDone(true);
      onSent && onSent(data);
    } catch (e) {
      setSendError(e.message || "Send failed. Please try again.");
    }
    setSending(false);
  }

  async function handleApprove() {
    setApproving(true);
    setSendError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("qb-sync-invoice", { body: { invoiceId: invoice.id } });
      if (fnError) throw new Error(fnError.message || "QB sync failed.");
      if (data?.error) throw new Error(data.error);
      onSent && onSent({});
      onClose && onClose();
    } catch (e) {
      setSendError(e.message || "Approve failed. Please try again.");
      setApproving(false);
    }
  }

  return (
    <div
      data-pdf-overlay data-pdf-printable
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @media print {
          html, body, #root { height: auto !important; overflow: visible !important; margin: 0 !important; padding: 0 !important; }
          body > #root { display: contents !important; }
          [data-pdf-overlay] { position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: auto !important; background: white !important; backdrop-filter: none !important; display: block !important; overflow: visible !important; }
          [data-inv-modal-inner] { position: static !important; max-height: none !important; height: auto !important; box-shadow: none !important; border-radius: 0 !important; width: 100% !important; border: none !important; display: block !important; overflow: visible !important; }
          [data-inv-header] { display: none !important; }
          [data-regression-tracker] { display: none !important; }
          [data-inv-body] { padding: 20px !important; height: auto !important; flex: none !important; overflow: visible !important; }
          @page { margin: 0.6in; size: letter; }
        }
      `}</style>
      <div data-inv-modal-inner style={{ background: "white", borderRadius: 16, width: "min(860px,95vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Modal header */}
        <div data-inv-header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #E5E7EB", background: "#FAFAFA", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1976D2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "white", fontSize: 16 }}>$</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Invoice Preview</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>#{invoice.id} · {money(netTotal)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "preview" && !sendDone && (
              <>
                <button onClick={() => window.print()} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Print</button>
                {invoice.status === "New" && !hideSend && <button onClick={handleApprove} disabled={approving} style={{ background: "white", border: "1.5px solid #1976D2", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700, color: "#1976D2", cursor: approving ? "wait" : "pointer", fontFamily: "inherit", opacity: approving ? 0.6 : 1 }} title="Post to QuickBooks and mark as Sent (no email to customer)">{approving ? "Approving…" : "Approve → QB"}</button>}
                {invoice.status === "New" && !hideSend && <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>Send Invoice</button>}
              </>
            )}
            {view === "send" && !sendDone && !hideSend && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Back to Preview</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9CA3AF", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>x</button>
          </div>
        </div>

        {/* Modal body */}
        <div data-inv-body style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

          {view === "preview" && sendError && (
            <div style={{ fontSize: 12, color: "#e53935", marginBottom: 16, background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 8, padding: "10px 14px", fontFamily: "Arial, sans-serif" }}>{sendError}</div>
          )}

          {view === "preview" && (
            <div style={{ fontFamily: "Arial, sans-serif", color: "#1c1814", background: "white" }}>

              {/* Company header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 16, borderBottom: "4px solid #30cfac", marginBottom: 24 }}>
                <div>
                  <img src={COMPANY.logo_url || "/hdsp-logo.png"} alt={COMPANY.name} style={{ height: 60, marginBottom: 6 }} />
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>{COMPANY.name}</div>
                  <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>{COMPANY.tagline}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#4a4238", lineHeight: 1.7 }}>
                  <div>{repContact.phone || COMPANY.phone}</div>
                  <div>{repContact.email || COMPANY.email}</div>
                  <div>{COMPANY.website}</div>
                  <div style={{ color: "#887c6e" }}>{COMPANY.license}</div>
                </div>
              </div>

              {/* Invoice info row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Bill To</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{billingName || invoice.job_name || "—"}</div>
                  {billingEmail && <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", marginTop: 2 }}>{billingEmail}</div>}
                  {jobsiteAddress && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Jobsite Address</div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", lineHeight: 1.7, whiteSpace: "pre-line" }}>{jobsiteAddress}</div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "left" }}>
                  {isDepositInvoice && (
                    <div style={{ display: "inline-block", background: "#43a047", color: "white", fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, marginBottom: 10 }}>Materials Deposit Invoice</div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Invoice #</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{invoice.id}</div>
                  {invoice.job_id && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Job #</div>
                      <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{invoice.job_id}</div>
                    </>
                  )}
                  {invoice.due_date && (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Due Date</div>
                      <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{fmtD(invoice.due_date)}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Line items table */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Line Items</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #1c1814" }}>
                      {["WTC", "Description", "Amount", "Billing %", "Line Total"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: (h === "Description" || h === "WTC") ? "left" : "right", fontWeight: 700, fontSize: 10.5, color: "#887c6e", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const wtc = l.proposal_wtc;
                      const sov = l.billing_schedule_line;
                      const isSov = !wtc && sov;
                      const isArchiveLine = !wtc && !sov && archiveCtx.isArchive;
                      const lineLabel = isSov
                        ? (sov.line_code ? `${sov.line_code} — ${sov.description}` : sov.description)
                        : isArchiveLine
                          ? (archiveCtx.workTypes || "—")
                          : (wtc?.work_types?.name || l.description || "—");
                      const wtcNum = wtc ? wtcIndex[wtc.id] : null;
                      const wtcCell = wtcNum ? `WTC ${wtcNum}` : "—";
                      const rowTotal = isSov
                        ? (parseFloat(sov.scheduled_value) || 0)
                        : isArchiveLine
                          ? archiveCtx.sold
                          : (wtc ? calcWtcPrice(wtc, undefined, usesExactPricing(invoice.proposals)) : 0);
                      const billingPct = isArchiveLine
                        ? (archiveCtx.sold > 0 ? ((parseFloat(l.amount) || 0) / archiveCtx.sold) * 100 : 0)
                        : (parseFloat(l.billing_pct) || 0);
                      return (
                        <tr key={l.id} style={{ borderBottom: "1px solid rgba(28,24,20,0.1)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{wtcCell}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{lineLabel}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(rowTotal)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmtPct(billingPct)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              {(invoice.discount > 0 || retentionAmt > 0) && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                    <span style={{ color: "#887c6e", fontWeight: 600 }}>Subtotal</span>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(invoice.amount)}</span>
                  </div>
                </div>
              )}
              {invoice.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                    <span style={{ color: "#e53935", fontWeight: 600 }}>Discount</span>
                    <span style={{ fontWeight: 700, color: "#e53935", fontVariantNumeric: "tabular-nums" }}>-{money(invoice.discount)}</span>
                  </div>
                </div>
              )}
              {retentionAmt > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                    <span style={{ color: "#887c6e", fontWeight: 600 }}>Less Retention{retentionPct > 0 ? ` (${retentionPct}%)` : ""}</span>
                    <span style={{ fontWeight: 700, color: "#887c6e", fontVariantNumeric: "tabular-nums" }}>-{money(retentionAmt)}</span>
                  </div>
                </div>
              )}
              {/* Work Description (above Amount Due) */}
              {invoice.description && (
                <div style={{ fontSize: 13, color: "#4a4238", lineHeight: 1.6, marginBottom: 12, padding: "12px 16px", background: "#f8f6f3", border: "1px solid rgba(28,24,20,0.08)", borderRadius: 8, whiteSpace: "pre-wrap" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Work Description</div>
                  {invoice.description}
                </div>
              )}

              <div style={{ border: "2px solid #30cfac", borderRadius: 8, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Amount Due</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" }}>{money(netTotal)}</div>
              </div>

              {/* Payment status */}
              {invoice.status === "Paid" && invoice.paid_at ? (
                <div style={{ borderTop: "1.5px solid rgba(48,207,172,0.4)", paddingTop: 20, textAlign: "center" }}>
                  <div style={{ display: "inline-block", border: "3px solid #30cfac", borderRadius: 10, padding: "12px 32px", transform: "rotate(-3deg)" }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: "#30cfac", letterSpacing: "0.1em", textTransform: "uppercase" }}>PAID</div>
                    <div style={{ fontSize: 12, color: "#4a4238", fontWeight: 600, marginTop: 4 }}>{fmtD(invoice.paid_at)}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#887c6e", marginTop: 16 }}>
                    Questions? Contact {repContact.email || COMPANY.email} or call {repContact.phone || COMPANY.phone}
                  </div>
                </div>
              ) : (
                <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#887c6e", fontStyle: "italic" }}>
                    Payment due upon receipt{invoice.due_date ? ` · Due by ${fmtD(invoice.due_date)}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "#887c6e", marginTop: 4 }}>
                    Questions? Contact {repContact.email || COMPANY.email} or call {repContact.phone || COMPANY.phone}
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "send" && !sendDone && !hideSend && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Invoice</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>The main recipient gets a secure payment link. Viewers get a view-only copy.</div>
              {loadingContact ? (
                <div style={{ color: "#6B7280", fontSize: 13 }}>Loading recipients...</div>
              ) : (
                <>
                  {noMainBlock ? (
                    <div style={{ background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 13, color: "#e53935", fontWeight: 600 }}>
                      No main recipient — pick who gets the pay link in the Recipients section, then come back to send.
                    </div>
                  ) : (
                    <>
                      <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Main — gets pay link</div>
                        {hasRecipRows ? (
                          <>
                            <div style={{ fontWeight: 600, color: mainMissingEmail ? "#e53935" : "#111827" }}>{mainEmail || <span style={{ color: "#e53935" }}>No email — add one in Recipients</span>}</div>
                            {mainRecip.contact_name && <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{mainRecip.contact_name}</div>}
                          </>
                        ) : (
                          <>
                            <div style={{ fontWeight: 600, color: "#111827" }}>{billingEmail || <span style={{ color: "#e53935" }}>No billing email on file</span>}</div>
                            {billingName && <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{billingName}</div>}
                          </>
                        )}
                      </div>
                      {viewerRecips.length > 0 && (
                        <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Viewers — view-only copy ({viewerRecips.length})</div>
                          {viewerRecips.map((v, i) => {
                            const vEmail = liveRecipEmail(v);
                            return (
                              <div key={i} style={{ fontWeight: 600, color: "#111827", marginTop: i === 0 ? 0 : 4 }}>
                                {vEmail || <span style={{ color: "#e53935" }}>No email</span>}
                                {v.contact_name && <span style={{ fontSize: 11, fontWeight: 400, color: "#6B7280" }}> · {v.contact_name}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Amount</div>
                        <div style={{ fontWeight: 700, color: "#111827", fontSize: 18 }}>{money(netTotal)}</div>
                      </div>
                    </>
                  )}
                  {/* Attachments — READ-ONLY review of what will be emailed. Managed on
                      the InvoiceDetail page (next to Recipients); the send flow only reviews. */}
                  {attachments.length > 0 && (
                    <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Attachments ({attachments.length})</div>
                      {attachments.map(att => (
                        <div key={att.id} style={{ fontWeight: 600, color: "#111827", marginTop: 2 }}>
                          {att.label || att.file_name}
                          {att.label && att.file_name && att.label !== att.file_name && <span style={{ fontSize: 11, fontWeight: 400, color: "#6B7280" }}> · {att.file_name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12, background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 8, padding: "10px 14px" }}>{sendError}</div>}
                  <button onClick={handleSend} disabled={sending || noMainBlock || mainMissingEmail} style={{ width: "100%", background: (sending || noMainBlock || mainMissingEmail) ? "#ccc" : "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: (sending || noMainBlock || mainMissingEmail) ? "default" : "pointer", fontFamily: "inherit" }}>
                    {sending ? "Sending..." : "Send Invoice with Pay Link"}
                  </button>
                </>
              )}
            </div>
          )}

          {sendDone && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Invoice Sent</div>
              <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>The main recipient will receive an email with a secure payment link; any viewers get a view-only copy.</div>
              {sendWarnings.length > 0 && (
                <div style={{ textAlign: "left", maxWidth: 420, margin: "0 auto 24px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "12px 16px", fontSize: 12.5, color: "#92400e" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Sent — but some items had issues:</div>
                  {sendWarnings.map((w, i) => <div key={i} style={{ marginTop: i === 0 ? 0 : 3 }}>· {String(w)}</div>)}
                </div>
              )}
              <button onClick={onClose} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Close</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// Mint the next invoice id off the main sequence. Mirrors the logic used by
// NewInvoiceModal (:240) and the void-replacement insert (:1337): take the
// recent ids, find the main cluster via the median (ignoring manually-
// renumbered outliers like a customer PO), and increment the max within it.
// Shared here so the retention-release path reuses one scheme, not a second.
async function mintNextInvoiceId() {
  const { data: recent } = await supabase
    .from("invoices")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(50);
  const nums = (recent || []).map(r => parseInt(r.id, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const median = nums.length ? nums[Math.floor(nums.length / 2)] : 10000;
  const seqNums = nums.filter(n => n <= median * 2);
  const lastNum = Math.max(seqNums.length ? seqNums[seqNums.length - 1] : 0, 9999);
  return String(lastNum + 1).padStart(5, "0");
}

// ── Invoice Detail ────────────────────────────────────────────────────────
function InvoiceDetail({ invoice, onBack, onUpdated, onDeleted, onNavigateJob, onNavigateProposal, onNavigateInvoice, teamMember }) {
  const money = fmt$c;
  const [inv, setInv] = useState(invoice);
  const [lines, setLines] = useState([]);
  const [wtcMap, setWtcMap] = useState({});
  const [wtcIndex, setWtcIndex] = useState({});
  const [linkedPayApp, setLinkedPayApp] = useState(null);
  const [billingProposal, setBillingProposal] = useState(null);
  const [billingSummary, setBillingSummary] = useState(null);
  const [showPayAppReview, setShowPayAppReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPDF, setShowPDF] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState(invoice.id);
  const [editDueDate, setEditDueDate] = useState(invoice.due_date || "");
  const [editDiscount, setEditDiscount] = useState(String(invoice.discount || 0));
  const [editRetentionPct, setEditRetentionPct] = useState(String(invoice.retention_pct || 0));
  const [editArchiveAmount, setEditArchiveAmount] = useState(String(invoice.amount || 0));
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
  }, []);
  const [editDesc, setEditDesc] = useState(invoice.description || "");
  const [editIntro, setEditIntro] = useState(invoice.intro || "");
  const [editPcts, setEditPcts] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPaidPDF, setShowPaidPDF] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(null); // "delete" | "pullback" | null
  const [voidReason, setVoidReason] = useState("");
  const [editReason, setEditReason] = useState("");
  const reasonRef = useRef(null);
  const [showQBLinkModal, setShowQBLinkModal] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [markingDeposit, setMarkingDeposit] = useState(false);
  const [syncReLink, setSyncReLink] = useState(false);
  const [syncToast, setSyncToast] = useState(null);
  const [billing, setBilling] = useState(false);           // Bill Retention in-flight guard
  const [releaseInvoiceId, setReleaseInvoiceId] = useState(null); // id of the release invoice spawned off this source

  // Recipients (main + viewers) — ported from the proposal Recipients card.
  const [recipients, setRecipients] = useState([]);
  // Attachments — managed HERE (add/label/remove) in a section next to Recipients,
  // loaded keyed on inv.id, and passed read-only to InvoicePDFModal for send-time
  // review. This is where documents are built onto the invoice; the send flow only
  // reviews. (mirrors how Recipients are managed here, shown read-only in send.)
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachError, setAttachError] = useState(null);
  const [attachLabel, setAttachLabel] = useState(DEFAULT_ATTACHMENT_LABEL); // pre-fills "Release Waiver"; cleared after each add so extra files can be untitled
  const [editingAttachId, setEditingAttachId] = useState(null); // row being re-labeled
  const [attachLabelDraft, setAttachLabelDraft] = useState("");
  const [customerContacts, setCustomerContacts] = useState([]);
  const [custInfo, setCustInfo] = useState({ id: null, name: "", billingEmail: "", billingName: "", billingContactId: null });
  const [editingRecipient, setEditingRecipient] = useState(null);
  const [recipDraft, setRecipDraft] = useState({});
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [newContactOpen, setNewContactOpen] = useState(false);
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  async function reloadRecipients() {
    const { data } = await supabase
      .from("invoice_recipients")
      .select("*, customer_contacts(id, role, is_primary, email)")
      .eq("invoice_id", inv.id)
      .order("created_at");
    setRecipients(data || []);
  }
  async function reloadAttachments() {
    setAttachments(await loadInvoiceAttachments(inv.id));
  }

  // Returns true only on a successful upload+insert, so the caller clears the
  // typed label only when the file was actually accepted.
  async function handleUploadAttachment(file, label) {
    if (!file) return false;
    setAttachError(null);
    // Client-side bounds BEFORE upload (plan §4.2): max 3 files, ≤10MB each.
    // These are authoritative; the edge fn's byte cap is a secondary guard.
    if (attachments.length >= MAX_INVOICE_ATTACHMENTS) {
      setAttachError(`Up to ${MAX_INVOICE_ATTACHMENTS} files per invoice.`);
      return false;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError("Each file must be 10 MB or smaller.");
      return false;
    }
    setUploadingAttachment(true);
    try {
      // Sanitize filename (CLAUDE.md storage rule) + random-entropy path so the
      // public URL isn't enumerable (plan §4.1). The {invoiceId}/ segment is
      // required — the edge-fn allowlist pins to it.
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `invoice-attachments/${inv.id}/${crypto.randomUUID()}-${cleanName}`;
      const contentType = file.type || "application/octet-stream";
      const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file, { contentType });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("job-attachments").getPublicUrl(path);
      // created_by is forced by a BEFORE INSERT trigger; tenant_id/created_at default.
      const { error: insErr } = await supabase.from("invoice_attachments").insert({
        invoice_id: inv.id,
        file_url: pub?.publicUrl,
        storage_path: path,
        file_name: cleanName,
        label: (label && label.trim()) || null, // blank = untitled attachment
        content_type: contentType,
        size_bytes: file.size,
      });
      if (insErr) throw new Error(insErr.message);
      await reloadAttachments();
      return true;
    } catch (e) {
      setAttachError(e.message);
      return false;
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleRemoveAttachment(att) {
    setAttachError(null);
    // Row-first, then storage (plan §4.2 Finding F). A dangling row (a broken
    // link the user sees) is worse than an orphaned file (invisible, bounded by
    // the 3-file cap + random path). VERIFY the row actually deleted before
    // touching storage — a delete that silently matches zero rows (already gone,
    // or RLS) returns no error, and removing the file then would destroy it while
    // a live row/link survives (CLAUDE.md verify-after-delete).
    const { data: deleted, error: delErr } = await supabase
      .from("invoice_attachments").delete().eq("id", att.id).select("id");
    if (delErr) { setAttachError(`Couldn't remove attachment: ${delErr.message}`); return; }
    if (!deleted || deleted.length === 0) {
      setAttachError("Couldn't remove that attachment — it may already be gone. Refreshed the list.");
      await reloadAttachments();
      return;
    }
    // Best-effort storage cleanup. job-attachments HAS a DELETE policy, but
    // storage.remove can still return [] silently (memory: storage-remove-silent-
    // noop) — don't trust its result. The row was the source of truth and is gone.
    if (att.storage_path) {
      try { await supabase.storage.from("job-attachments").remove([att.storage_path]); }
      catch (e) { console.warn("Attachment file cleanup failed (non-fatal):", e.message); }
    }
    await reloadAttachments();
  }

  async function saveAttachmentLabel(att, label) {
    setAttachError(null);
    const { error } = await supabase
      .from("invoice_attachments")
      .update({ label: (label && label.trim()) || null })
      .eq("id", att.id);
    if (error) { setAttachError(`Couldn't update label: ${error.message}`); return; }
    setEditingAttachId(null);
    setAttachLabelDraft("");
    await reloadAttachments();
  }

  async function reloadCustomerContacts() {
    if (!custInfo.id) return;
    const { data } = await supabase
      .from("customer_contacts")
      .select("id, name, email, phone, role, is_primary, is_billing_contact, created_at")
      .eq("customer_id", custInfo.id)
      .order("created_at");
    setCustomerContacts(data || []);
  }
  // Re-read this invoice row and merge into local state. Used after send and
  // after the (async, fire-and-forget) QB sync resolves, so action buttons
  // reconcile with server-written fields (status, qb_invoice_id) in place —
  // without needing a navigate-away/return to remount. Mirrors the inline
  // refetch in handleQBSync / QBLink onLinked.
  async function reloadInv() {
    const { data: refreshed } = await supabase
      .from("invoices")
      .select(`*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id))`)
      .eq("id", inv.id)
      .maybeSingle();
    if (refreshed) setInv(prev => ({ ...prev, ...refreshed }));
  }

  // Add a recipient with the right role, seeding the billing main when needed.
  // One FRESH DB read drives every decision (no stale React state — fixes the
  // T5 #3 double-add and the T5 #4 stranded-first-viewer races):
  //   - Dedup: if this contact (by id, or by email for orphans) is already a
  //     recipient — including the just-seeded billing main — do nothing (#3).
  //   - Seed the billing contact as `main` first ONLY when there's no main yet,
  //     a billing email exists, and the contact being added isn't itself the
  //     billing contact (so the billing contact is never listed twice — #3).
  //   - Role: the new row is `main` only when there's still no main after
  //     seeding (email-less customer with nothing to seed — #4); else `viewer`.
  // Fires on a user add action, never on load (plan §4.2 / A2).
  async function addRecipient(row) {
    const { data: existing } = await supabase
      .from("invoice_recipients")
      .select("id, role, customer_contact_id, contact_email")
      .eq("invoice_id", inv.id);
    const rows = existing || [];
    const emailLc = (row.contact_email || "").trim().toLowerCase();

    const isDup = rows.some(r =>
      (row.customer_contact_id && r.customer_contact_id === row.customer_contact_id) ||
      (emailLc && (r.contact_email || "").trim().toLowerCase() === emailLc)
    );
    if (isDup) { await reloadRecipients(); return; }

    const hasMain = rows.some(r => r.role === "main");
    const billingLc = (custInfo.billingEmail || "").trim().toLowerCase();
    const addingIsBilling =
      (!!row.customer_contact_id && !!custInfo.billingContactId && row.customer_contact_id === custInfo.billingContactId) ||
      (!!emailLc && !!billingLc && emailLc === billingLc);

    let seededMain = false;
    if (!hasMain && custInfo.billingEmail && !addingIsBilling) {
      await supabase.from("invoice_recipients").insert({
        invoice_id: inv.id,
        contact_name: custInfo.billingName || "",
        contact_email: custInfo.billingEmail,
        role: "main",
        customer_contact_id: custInfo.billingContactId || null,
      });
      seededMain = true;
    }

    const role = (hasMain || seededMain) ? "viewer" : "main";
    await supabase.from("invoice_recipients").insert({
      invoice_id: inv.id,
      contact_name: row.contact_name || "",
      contact_email: row.contact_email || "",
      phone: row.phone || "",
      role,
      customer_contact_id: row.customer_contact_id || null,
    });
    await reloadRecipients();
  }

  async function toggleMain(id) {
    const r = recipients.find(x => x.id === id);
    if (!r) return;
    if (r.role === "main") {
      await supabase.from("invoice_recipients").update({ role: "viewer" }).eq("id", id);
    } else {
      // Promote the new main FIRST, then demote the others. A failure between
      // the two leaves a transient TWO-main state (the edge fn demotes the
      // extra to viewer → single pay link preserved) rather than a ZERO-main
      // state that would block the send (T5 #7).
      await supabase.from("invoice_recipients").update({ role: "main" }).eq("id", id);
      await supabase.from("invoice_recipients").update({ role: "viewer" }).eq("invoice_id", inv.id).eq("role", "main").neq("id", id);
    }
    await reloadRecipients();
  }

  async function pickExistingContact(c) {
    await addRecipient({ contact_name: c.name || "", contact_email: c.email || "", phone: c.phone || "", customer_contact_id: c.id });
  }

  async function createNewRecipient() {
    if (!custInfo.id) return;
    const draft = recipDraft;
    // Require a valid email — a blank-email contact pollutes the customer file
    // and the matching viewer is silently dropped at send (T5 #6).
    if (!draft.email || !isValidEmail(draft.email)) { alert("Enter a valid email address for this recipient."); return; }
    const emailLc = draft.email.trim().toLowerCase();
    let contactId = null;
    const existing = customerContacts.find(c => (c.email || "").trim().toLowerCase() === emailLc);
    if (existing) contactId = existing.id;
    if (!contactId) {
      const { data: newC } = await supabase.from("customer_contacts").insert({
        customer_id: custInfo.id,
        name: draft.name || "",
        email: draft.email,
        phone: draft.phone || "",
        role: draft.role || "Project Manager",
      }).select().single();
      if (newC) contactId = newC.id;
    }
    await addRecipient({ contact_name: draft.name || "", contact_email: draft.email, phone: draft.phone || "", customer_contact_id: contactId });
    setNewContactOpen(false);
    setRecipDraft({});
    await reloadCustomerContacts();
  }

  async function saveRecipient(id) {
    const draft = recipDraft;
    if (draft.email && !isValidEmail(draft.email)) { alert("Invalid email address"); return; }
    const r = recipients.find(x => x.id === id);
    await supabase.from("invoice_recipients").update({ contact_name: draft.name, contact_email: draft.email, phone: draft.phone }).eq("id", id);
    if (r?.customer_contact_id) {
      await supabase.from("customer_contacts").update({ name: draft.name, email: draft.email, phone: draft.phone, role: draft.role }).eq("id", r.customer_contact_id);
    }
    setEditingRecipient(null);
    setRecipDraft({});
    await Promise.all([reloadRecipients(), reloadCustomerContacts()]);
  }

  async function deleteRecipient(id) {
    if (!window.confirm("Remove this recipient from the invoice? (The contact stays on the customer file.)")) return;
    await supabase.from("invoice_recipients").delete().eq("id", id);
    await reloadRecipients();
  }

  async function saveToCustomerFile(id) {
    if (!custInfo.id) return;
    const r = recipients.find(x => x.id === id);
    if (!r) return;
    const emailLc = (r.contact_email || "").trim().toLowerCase();
    let contactId = null;
    if (emailLc) {
      const existing = customerContacts.find(c => (c.email || "").trim().toLowerCase() === emailLc);
      if (existing) contactId = existing.id;
    }
    if (!contactId) {
      const { data: newC } = await supabase.from("customer_contacts").insert({
        customer_id: custInfo.id,
        name: r.contact_name || "",
        email: r.contact_email || "",
        phone: r.phone || "",
        role: "Project Manager",
      }).select().single();
      if (newC) contactId = newC.id;
    }
    if (contactId) {
      await supabase.from("invoice_recipients").update({ customer_contact_id: contactId }).eq("id", id);
    }
    await Promise.all([reloadRecipients(), reloadCustomerContacts()]);
  }

  // Auto-refresh: poll for payment status updates when invoice is Sent/Waiting
  useEffect(() => {
    if (inv.status === "Paid" || inv.status === "New") return;
    const interval = setInterval(async () => {
      const { data } = await supabase.from("invoices").select("status, paid_at, stripe_payment_id, stripe_checkout_id").eq("id", inv.id).maybeSingle();
      if (data && data.status === "Paid" && inv.status !== "Paid") {
        setInv(prev => ({ ...prev, ...data }));
        onUpdated && onUpdated();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [inv.id, inv.status]);

  useEffect(() => {
    async function loadDetail() {
      // Refetch the invoice so call_log.qb_customer_id / qb_skip_sync reflect any
      // recent QB link/unlink action — list-cached props can be stale.
      const { data: freshInv } = await supabase
        .from("invoices")
        .select(`*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id, customer_id, customers(billing_email, billing_name, contact_email, email, first_name, last_name, name)))`)
        .eq("id", inv.id)
        .maybeSingle();
      if (freshInv) setInv(prev => ({ ...prev, ...freshInv }));

      // Recipients (main + viewers) for the send flow. Resolve the billing
      // contact (same order as the edge fn / send modal) so the Recipients card
      // can show it as the default main and seed it on first add. (plan §4.2)
      {
        const cl = freshInv?.proposals?.call_log;
        const cust = cl?.customers;
        const customerId = cl?.customer_id || null;
        let bEmail = "", bName = "", bContactId = null;
        if (customerId) {
          const { data: contactsAll } = await supabase
            .from("customer_contacts")
            .select("id, name, email, phone, role, is_primary, is_billing_contact, created_at")
            .eq("customer_id", customerId)
            .order("created_at");
          setCustomerContacts(contactsAll || []);
          const billingMatches = (contactsAll || []).filter(c => c.is_billing_contact || c.role === "Billing Contact");
          const bc = billingMatches.length
            ? (billingMatches.find(c => c.is_primary) || [...billingMatches].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0])
            : null;
          if (bc?.email) { bEmail = bc.email; bName = bc.name || ""; bContactId = bc.id; }
        }
        if (!bEmail && cust) {
          bEmail = cust.billing_email || cust.contact_email || cust.email || "";
          bName = cust.billing_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || cust.name || "";
        }
        setCustInfo({ id: customerId, name: cl?.customer_name || "", billingEmail: bEmail, billingName: bName, billingContactId: bContactId });

        const { data: recs } = await supabase
          .from("invoice_recipients")
          .select("*, customer_contacts(id, role, is_primary, email)")
          .eq("invoice_id", inv.id)
          .order("created_at");
        setRecipients(recs || []);

        // Attachments — persisted docs that went out with this invoice (plan §4.5).
        setAttachments(await loadInvoiceAttachments(inv.id));
      }

      // If this invoice's retention has been billed, find the release invoice
      // it spawned so the detail can link to it ("Retention billed → #X").
      if (freshInv?.retention_released) {
        const { data: rel } = await supabase
          .from("invoices")
          .select("id")
          .eq("retention_release_of", inv.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setReleaseInvoiceId(rel?.id || null);
      }

      // Fetch invoice lines with WTC info
      const { data: lineData } = await supabase
        .from("invoice_lines")
        .select("*, proposal_wtc:proposal_wtc_id(*, work_types(name)), billing_schedule_line:billing_schedule_line_id(line_code, description, scheduled_value)")
        .eq("invoice_id", inv.id);
      setLines(lineData || []);

      // Build WTC map for totals
      const map = {};
      (lineData || []).forEach(l => {
        if (l.proposal_wtc) map[l.proposal_wtc_id] = l.proposal_wtc;
      });
      setWtcMap(map);

      // Build WTC index map (proposal_wtc_id -> WTC #) for line item labeling
      if (inv.proposal_id) {
        const { data: wtcRows } = await supabase
          .from("proposal_wtc")
          .select("id")
          .eq("proposal_id", inv.proposal_id)
          .order("created_at", { ascending: true });
        const idxMap = {};
        (wtcRows || []).forEach((w, i) => { idxMap[w.id] = i + 1; });
        setWtcIndex(idxMap);
      }

      // Check if this invoice is linked from a Pay App (canonical send path lives there)
      const { data: payApp } = await supabase
        .from("billing_schedule_pay_apps")
        .select("id, app_number, billing_schedule_id, billing_schedule:billing_schedule_id(proposal_id)")
        .eq("invoice_id", inv.id)
        .maybeSingle();
      setLinkedPayApp(payApp || null);

      // Load proposal + billing summary for billing schedule section
      const proposalId = payApp?.billing_schedule?.proposal_id || inv.proposal_id;
      if (proposalId) {
        const { data: sch } = await supabase
          .from("billing_schedule")
          .select("id, contract_sum, retainage_pct, status")
          .eq("proposal_id", proposalId)
          .maybeSingle();
        if (sch) {
          const { data: prop } = await supabase
            .from("proposals")
            .select(`id, customer, call_log_id, ${PROPOSAL_ERA}, call_log(customer_name, job_name, display_job_number)`)
            .eq("id", proposalId)
            .maybeSingle();
          setBillingProposal(prop || null);

          const { data: apps } = await supabase
            .from("billing_schedule_pay_apps")
            .select("id, this_app_amount, retainage_withheld, status")
            .eq("billing_schedule_id", sch.id)
            .order("app_number", { ascending: true });
          const totalBilled = (apps || []).reduce((s, a) => s + (parseFloat(a.this_app_amount) || 0), 0);
          const totalRetainage = (apps || []).reduce((s, a) => s + (parseFloat(a.retainage_withheld) || 0), 0);
          const contractSum = parseFloat(sch.contract_sum) || 0;
          setBillingSummary({
            contractSum,
            retainagePct: parseFloat(sch.retainage_pct) || 0,
            totalBilled,
            totalRetainage,
            balance: contractSum - totalBilled,
            payAppCount: (apps || []).length,
          });
        }
      }

      setLoading(false);
    }
    loadDetail();
  }, [inv.id]);

  async function updateStatus(newStatus) {
    if (inv.voided_at) { alert("This invoice is voided and cannot change status."); return; }
    const updates = { status: newStatus };
    if (newStatus === "Sent" && !inv.sent_at) {
      updates.sent_at = new Date().toISOString();
      updates.viewing_token_expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
    }
    if (newStatus === "Paid" && !inv.paid_at) updates.paid_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    // Sync payment to QuickBooks when marked as Paid (skip test jobs)
    if (newStatus === "Paid" && inv.qb_invoice_id && !(inv.job_name || "").toLowerCase().includes("test")) {
      supabase.functions.invoke("qb-record-payment", { body: { invoiceId: inv.id } })
        .catch(() => {});
    }
    setInv(prev => ({ ...prev, ...updates }));
    onUpdated && onUpdated();
  }

  async function handleQBSync() {
    if (syncing) return;
    if (inv.voided_at) { setSyncError("This invoice is voided — re-sync is not allowed."); return; }
    setSyncing(true);
    setSyncError(null);
    setSyncReLink(false);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("qb-sync-invoice", { body: { invoiceId: inv.id } });
      if (fnErr) {
        // FunctionsHttpError carries the Response on .context; fnErr.message alone is
        // generic ("non-2xx status code") and hides the real QB fault. Read the body
        // so the manual "Sync to QuickBooks" re-sync is trustworthy. (plan §5 / finding A)
        let detail = fnErr.message || "QB sync failed.";
        try {
          const body = await fnErr.context?.json?.();
          if (body?.error || body?.message) detail = body.error || body.message;
        } catch { /* body wasn't JSON — fall back to the generic message */ }
        throw new Error(detail);
      }
      // Link-persist recovery: QB created the invoice but the server failed to save
      // the link. It returns the QB id — persist it here instead of orphaning +
      // re-duplicating, then fall through to the success refresh. (plan §3 step 1+2)
      if (data?.qbInvoiceId && data?.error === "qb_link_persist_failed") {
        const { error: linkErr } = await supabase.from("invoices").update({ qb_invoice_id: data.qbInvoiceId }).eq("id", inv.id);
        if (linkErr) throw new Error("Invoice was created in QuickBooks but linking it here failed again — retry.");
      } else {
        if (data?.error === "qb_customer_invalid") {
          setSyncError(data.message || "Linked QuickBooks customer no longer exists or is inactive.");
          setSyncReLink(true);
          setSyncing(false);
          return;
        }
        if (data?.error) throw new Error(data.message || data.error);
        if (data?.skipped) throw new Error(`QB sync skipped: ${data.reason}`);
      }

      if (inv.status === "Paid") {
        const { data: pData, error: pErr } = await supabase.functions.invoke("qb-record-payment", { body: { invoiceId: inv.id } });
        if (pErr) throw new Error(pErr.message || "QB payment sync failed.");
        if (pData?.error === "qb_customer_invalid") {
          setSyncError(pData.message || "Linked QuickBooks customer no longer exists or is inactive.");
          setSyncReLink(true);
          setSyncing(false);
          return;
        }
        if (pData?.error) throw new Error(pData.error);
      }

      const { data: refreshed } = await supabase
        .from("invoices")
        .select(`*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id))`)
        .eq("id", inv.id)
        .maybeSingle();
      if (refreshed) setInv(prev => ({ ...prev, ...refreshed }));
      onUpdated && onUpdated();
      const paidNote = inv.status === "Paid" ? " Payment also recorded." : "";
      setSyncToast(`Invoice synced to QuickBooks (QB ID ${refreshed?.qb_invoice_id || "—"}).${paidNote}`);
      setTimeout(() => setSyncToast(null), 5000);
    } catch (e) {
      setSyncError(e.message || "QB sync failed.");
    }
    setSyncing(false);
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
  const canPullBack = inv.status !== "New" && inv.status !== "Paid";
  const isNew = inv.status === "New";
  // In-place edit is exposed for New AND for the unpaid Sent-family so an operator can
  // add a late PO (into description/intro) to an already-sent, QB-synced invoice WITHOUT
  // a pull-back that would mint a new number. Paid / voided / QB-payment-linked are blocked:
  // a full-replace QB resync under a recorded payment can shift the amount owed (plan §5.2).
  // NOTE (buildvsplan T2-2): in current live data qb_payment_id is only populated once an
  // invoice is Paid, so !inv.qb_payment_id is presently redundant with !== "Paid" — it is
  // defense-in-depth for a future partial-payment case, NOT a proven partial-payment block.
  // If partial QB payments ever get recorded on a still-Sent invoice, add a balance check.
  const isSentFamily = ["Sent", "Waiting for Payment", "Past Due"].includes(inv.status);
  const canEditInPlace = !inv.voided_at && inv.status !== "Paid" && !inv.qb_payment_id && (isNew || isSentFamily);
  // For a QB-synced edit, lock the number + every dollar field so an in-place edit can
  // only touch description / intro / due date — keeps the invoice number stable (the whole
  // point) and prevents amount drift under the live QB record + Stripe pay link (plan §2.3).
  const syncedLock = !!inv.qb_invoice_id;

  async function handleDelete() {
    if (inv.voided_at) {
      // Already voided — hide from lists. QB record stays as audit trail.
      if (!confirm(`Hide voided Invoice #${inv.id} from lists? (record stays in DB for audit.)`)) return;
      const { error } = await supabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
      if (error) { alert(error.message); return; }
      onDeleted && onDeleted();
      return;
    }
    if (inv.qb_invoice_id) {
      // Has QB record — show void modal for required reason
      setShowVoidModal("delete");
      return;
    }
    if (!confirm(`Delete Invoice #${inv.id}? This cannot be undone.`)) return;
    const { error } = await supabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    onDeleted && onDeleted();
  }

  const isArchiveInvoice = lines.length > 0 && lines.every(l => !l.proposal_wtc_id && !l.billing_schedule_line_id);
  // One-field model: the job points at its deposit invoice via call_log.deposit_invoice_id.
  // THIS invoice is the deposit iff the job's pointer references it. Drives the badge,
  // the Mark-as-deposit toggle, and the (non-pay-app) retention suppression.
  const depositInvoiceId = inv.proposals?.call_log?.deposit_invoice_id || null;
  const isDepositInvoice = depositInvoiceId != null && depositInvoiceId === inv.id;

  function startEditing() {
    setEditId(inv.id);
    setEditDueDate(inv.due_date || "");
    setEditDiscount(String(inv.discount || 0));
    setEditRetentionPct(String(inv.retention_pct || 0));
    setEditDesc(inv.description || "");
    setEditIntro(inv.intro || "");
    setEditArchiveAmount(String(inv.amount || 0));
    const pcts = {};
    lines.forEach(l => { pcts[l.id] = String(l.billing_pct || 0); });
    setEditPcts(pcts);
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (inv.voided_at) { alert("This invoice is voided and cannot be edited."); return; }
    // Load-bearing guard (plan §5.2): a full-replace QB resync on an invoice with a linked
    // payment can shift line items under recorded money. Refuse Paid + any QB-payment link.
    // The button gate already hides these, but guard the write too (CLAUDE.md #7).
    if (inv.status === "Paid" || inv.qb_payment_id) {
      alert("This invoice has a recorded payment and can't be edited in place — editing line items under a linked QuickBooks payment can shift the amount owed. Pull it back if you need to change it.");
      return;
    }
    // Require reason if invoice is synced to QB. Focus + scroll the field so the
    // requirement is impossible to miss (it was easy to overlook when dim).
    if (inv.qb_invoice_id && !editReason.trim()) {
      reasonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reasonRef.current?.focus();
      alert("A reason for this edit is required for QuickBooks audit compliance.");
      return;
    }
    setSaving(true);
    // Recalculate line amounts based on new billing pcts.
    // Archive invoices have no proposal_wtc; preserve the directly-entered amount on the single line.
    const newLines = lines.map(l => {
      // QB-synced invoice: every dollar field is locked in the UI (syncedLock) — GUARD THE
      // WRITE too (CLAUDE.md #6/#7). Preserve the stored line amount + %; never recompute.
      // A recompute (calcWtcPrice × pct) would silently drift the amount if the underlying
      // proposal_wtc was edited after the invoice was sent, then full-replace that new
      // number into QB (sparse:false). Preserving is the only thing that makes §2.3's
      // "amounts are locked" actually true. Covers WTC, archive, and SOV lines uniformly.
      if (syncedLock) {
        return { id: l.id, billing_pct: l.billing_pct, amount: parseFloat(l.amount) || 0 };
      }
      if (isArchiveInvoice) {
        const amt = parseFloat(String(editArchiveAmount).replace(/[^0-9.\-]/g, "")) || 0;
        return { id: l.id, billing_pct: null, amount: Math.round(amt * 100) / 100 };
      }
      // Pay-app / SOV lines: dollars are owned by the billing-schedule + pay-app flow
      // (PayAppDetailModal.handleSaveLines), not this generic editor. They have no
      // proposal_wtc, so recomputing wtcTotal × pct would zero them. Preserve the
      // stored amount + % instead — mirrors the isArchiveInvoice preserve branch. (plan §3)
      if (l.billing_schedule_line_id) {
        return { id: l.id, billing_pct: l.billing_pct, amount: parseFloat(l.amount) || 0 };
      }
      const wtc = l.proposal_wtc;
      const wtcTotal = wtc ? calcWtcPrice(wtc, undefined, usesExactPricing(inv.proposals)) : 0;
      const pct = parseFloat(editPcts[l.id]) || 0;
      return { id: l.id, billing_pct: pct, amount: Math.round(wtcTotal * (pct / 100) * 100) / 100 };
    });
    const newAmount = newLines.reduce((sum, l) => sum + l.amount, 0);
    // Retention + discount are owned by the pay-app flow for a pay-app invoice —
    // preserve the stored values there (a GC/pay-app deposit's retention lives in
    // that flow; don't double-zero it). For a NON-pay-app invoice, recompute from the
    // edit inputs — EXCEPT a direct (non-pay-app) deposit, which carries no retention,
    // so force it to 0 (guard the write, not just the hidden UI — CLAUDE.md #6/#7).
    // syncedLock takes precedence: preserve stored retention + discount (locked inputs) so
    // a QB-synced edit can't drift the money via these either (mirrors the newLines branch).
    const retPct   = syncedLock ? (parseFloat(inv.retention_pct) || 0)    : (linkedPayApp ? (parseFloat(inv.retention_pct) || 0)    : (isDepositInvoice ? 0 : (parseFloat(editRetentionPct) || 0)));
    const retAmt   = syncedLock ? (parseFloat(inv.retention_amount) || 0) : (linkedPayApp ? (parseFloat(inv.retention_amount) || 0) : (isDepositInvoice ? 0 : Math.round(newAmount * (retPct / 100) * 100) / 100));
    const discount = syncedLock ? (parseFloat(inv.discount) || 0)         : (linkedPayApp ? (parseFloat(inv.discount) || 0)         : (parseFloat(editDiscount) || 0));

    // Update invoice
    const { error: invErr } = await supabase.from("invoices").update({
      id: editId,
      due_date: editDueDate || null,
      discount,
      retention_pct: retPct,
      retention_amount: retAmt,
      description: editDesc || null,
      intro: editIntro || null,
      amount: Math.round(newAmount * 100) / 100,
    }).eq("id", inv.id);
    if (invErr) { alert(invErr.message); setSaving(false); return; }

    // Update each line
    for (const nl of newLines) {
      await supabase.from("invoice_lines").update({ billing_pct: nl.billing_pct, amount: nl.amount }).eq("id", nl.id);
    }

    // If invoice ID changed, we need to update invoice_lines FK too
    if (editId !== inv.id) {
      for (const nl of newLines) {
        await supabase.from("invoice_lines").update({ invoice_id: editId }).eq("id", nl.id);
      }
    }

    // Re-sync to QuickBooks with the edit reason, AWAITING it and SURFACING failures.
    // For the add-a-late-PO flow the whole point is the description reaching the QB memo,
    // so the old fire-and-forget `.catch(()=>{})` would show success in SC while QB never
    // updated (was B44). Skip test-named jobs — their sync is suppressed server-side.
    let qbError = null;
    if (inv.qb_invoice_id && !(inv.job_name || "").toLowerCase().includes("test")) {
      const { data: qb, error: fnErr } = await supabase.functions.invoke(
        "qb-sync-invoice",
        { body: { invoiceId: editId, editReason: editReason.trim() } }
      );
      if (fnErr) {
        // FunctionsHttpError.message is generic ("non-2xx status code"); the real QB
        // fault is in the Response body on .context. Read it so the message is useful.
        qbError = fnErr.message || "QuickBooks sync failed.";
        try {
          const body = await fnErr.context?.json?.();
          if (body?.error || body?.message) qbError = body.message || body.error;
        } catch { /* body wasn't JSON — keep the generic message */ }
      } else if (qb?.error) {
        qbError = qb.message || qb.error;
      } else if (qb?.skipped) {
        qbError = `QuickBooks sync skipped: ${qb.reason}`;
      }
    }

    // SC writes already committed above, so reflect them locally regardless of QB.
    setInv(prev => ({ ...prev, id: editId, due_date: editDueDate || null, discount, retention_pct: retPct, retention_amount: retAmt, description: editDesc || null, intro: editIntro || null, amount: Math.round(newAmount * 100) / 100 }));
    setLines(prev => prev.map(l => {
      const nl = newLines.find(n => n.id === l.id);
      return nl ? { ...l, billing_pct: nl.billing_pct, amount: nl.amount } : l;
    }));

    if (qbError) {
      // Saved in Sales Command, but QuickBooks did NOT update. Keep the edit form open
      // so a retry (Save again) re-pushes to QB — number + amounts are locked, so the
      // re-save is idempotent and safe.
      setSaving(false);
      onUpdated && onUpdated();
      alert(`Your changes were saved in Sales Command, but the QuickBooks re-sync failed:\n\n${qbError}\n\nThe invoice is correct here — click Save again to retry the QuickBooks sync, or use "Sync to QuickBooks".`);
      return;
    }

    setEditing(false);
    setEditReason("");
    setSaving(false);
    onUpdated && onUpdated();
  }

  // Bill the retention held on `source`: flip the source's released flag, then
  // spawn a release invoice for the held amount. Order matters — the source
  // UPDATE is the idempotency stop; the INSERT follows only once it's confirmed.
  async function handleBillRetention(source) {
    if (billing) return;
    setBilling(true);
    try {
      const nextId = await mintNextInvoiceId();

      // 1) UPDATE source FIRST, conditionally, and verify rows-affected. RLS can
      //    silently no-op an UPDATE (no error, 0 rows) — so check the returned
      //    array length, not just .error. The .eq("retention_released", false)
      //    predicate is the DB-level idempotency stop against a double-click.
      const { data: flipped, error: flipErr } = await supabase
        .from("invoices")
        .update({ retention_released: true })
        .eq("id", source.id)
        .eq("retention_released", false)
        .select();
      if (flipErr) { alert(`Could not mark retention as billed: ${flipErr.message}`); return; }
      if (!flipped || flipped.length < 1) {
        alert(`Retention on invoice #${source.id} was already billed (or the update was blocked). Refresh and check before retrying.`);
        return;
      }

      // 2) INSERT the release invoice, only after the source flip is confirmed.
      const { error: insErr } = await supabase.from("invoices").insert([{
        id: nextId,
        tenant_id: source.tenant_id,
        job_id: source.job_id,
        job_name: source.job_name,
        call_log_id: source.call_log_id,
        proposal_id: source.proposal_id,
        amount: source.retention_amount,
        retention_pct: 0,
        retention_amount: 0,
        discount: 0,
        status: "New",
        type: "regular", // a retention release is a normal A/R invoice
        show_cents: source.show_cents,
        description: `Retention release for invoice #${source.id}`,
        retention_release_of: source.id,
      }]);

      if (insErr) {
        // INSERT failed — compensate by reverting the source flip, and verify
        // the revert itself landed. If the revert fails or affects 0 rows the
        // source is stranded (released=true with no release invoice) — raise a
        // loud, persistent error naming the id + manual-recovery text.
        const { data: reverted, error: revertErr } = await supabase
          .from("invoices")
          .update({ retention_released: false })
          .eq("id", source.id)
          .select();
        if (revertErr || !reverted || reverted.length < 1) {
          alert(
            `Release invoice failed AND could not un-mark source #${source.id} — ` +
            `set retention_released=false on invoice #${source.id} manually before retrying.\n\n` +
            `Insert error: ${insErr.message}\n` +
            `Revert error: ${revertErr ? revertErr.message : "affected 0 rows"}`
          );
        } else {
          alert(`Could not create the retention release invoice: ${insErr.message}\n\nThe source invoice was left unchanged — you can retry.`);
        }
        return;
      }

      // 3) Success — navigate to the new release invoice. The list-level
      //    onNavigateInvoice also calls load(), so the source's flipped
      //    retention_released is reflected on return. No optimistic setInv —
      //    the key-based remount on navigation refetches.
      if (onNavigateInvoice) onNavigateInvoice(nextId);
    } finally {
      setBilling(false);
    }
  }

  async function handlePullBack() {
    if (inv.qb_invoice_id) {
      setShowVoidModal("pullback");
      return;
    }
    if (!confirm("Pull back this invoice? It will reset to New and invalidate any payment link.")) return;
    try {
      await supabase.functions.invoke("deactivate-payment-link", { body: { invoiceId: inv.id } });
    } catch (e) {
      console.warn("Payment link deactivation failed on pullback (non-blocking):", e);
    }
    const updates = { status: "New", sent_at: null, stripe_checkout_id: null, stripe_checkout_url: null, stripe_payment_link_id: null, stripe_payment_id: null, paid_at: null };
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    if (linkedPayApp) {
      await supabase.from("billing_schedule_pay_apps").update({ status: "draft", submitted_at: null }).eq("id", linkedPayApp.id);
      setLinkedPayApp(prev => prev ? { ...prev, status: "draft", submitted_at: null } : prev);
    }
    setInv(prev => ({ ...prev, ...updates }));
    onUpdated && onUpdated();
  }

  // Mark / unmark THIS invoice as the job's deposit. ONE atomic write on the single
  // pointer call_log.deposit_invoice_id — set to this invoice's id, or null to un-mark.
  // No clear-before-set, no compensation: a single field can't reach a half-state, and
  // stealing the pointer from another invoice is the same one write. Confirm only when
  // the CURRENT deposit link points at a sent/paid invoice (don't silently un-record a
  // collected deposit). (plan v2 #1)
  async function handleToggleDeposit() {
    if (inv.voided_at || inv.deleted_at || markingDeposit || !inv.call_log_id) return;
    const currentId = inv.proposals?.call_log?.deposit_invoice_id || null;
    const turningOn = currentId !== inv.id;        // not currently this invoice → make it the deposit
    const nextValue = turningOn ? inv.id : null;

    if (currentId) {
      // Status of whatever the pointer currently references (this invoice on un-mark, or
      // another invoice we're about to steal it from).
      let cur;
      if (currentId === inv.id) cur = { sent_at: inv.sent_at, paid_at: inv.paid_at, voided_at: inv.voided_at, deleted_at: inv.deleted_at };
      else {
        const { data } = await supabase.from("invoices").select("sent_at, paid_at, voided_at, deleted_at").eq("id", currentId).maybeSingle();
        cur = data;
      }
      // Only confirm for a LIVE collected deposit — a voided/deleted pointer invoice is
      // inactive (state already reads "required"), so moving/clearing it is free. This
      // mirrors the reader active-filter; no clear-on-void handler is needed.
      const active = cur && !cur.voided_at && !cur.deleted_at;
      if (active && (cur.sent_at || cur.paid_at)) {
        const what = cur.paid_at ? "paid" : "sent";
        const msg = turningOn
          ? `This job's deposit is invoice #${currentId} (${what}). Move the deposit to invoice #${inv.id}?`
          : `Invoice #${inv.id} is the job's recorded deposit (${what}). Remove it as the deposit? The job will show a deposit as still required.`;
        if (!confirm(msg)) return;
      }
    }

    setMarkingDeposit(true);
    const { data: updated, error } = await supabase.from("call_log")
      .update({ deposit_invoice_id: nextValue })
      .eq("id", inv.call_log_id)
      .select();
    setMarkingDeposit(false);
    if (error || !updated || updated.length < 1) {
      alert(error?.message || "Couldn't update the deposit — refresh and try again.");
      return;
    }
    // Reflect the pointer (lives on the job's call_log, embedded under proposals).
    setInv(prev => prev.proposals?.call_log
      ? { ...prev, proposals: { ...prev.proposals, call_log: { ...prev.proposals.call_log, deposit_invoice_id: nextValue } } }
      : prev);
    onUpdated && onUpdated();
  }

  async function handleVoidConfirm() {
    if (!voidReason.trim()) { alert("A reason is required for audit compliance."); return; }
    setSaving(true);
    // Void in QuickBooks with reason (skip test jobs)
    const isTest = (inv.job_name || "").toLowerCase().includes("test");
    if (!isTest) {
      const { data: qbResult } = await supabase.functions.invoke("qb-void-invoice", {
        body: { invoiceId: inv.id, reason: voidReason.trim(), action: showVoidModal },
      });
      if (qbResult?.error) { alert(`QuickBooks error: ${qbResult.error}`); setSaving(false); return; }
    }

    try {
      await supabase.functions.invoke("deactivate-payment-link", { body: { invoiceId: inv.id } });
    } catch (e) {
      console.warn("Payment link deactivation failed on void/delete (non-blocking):", e);
    }

    if (showVoidModal === "delete") {
      const { error: delErr } = await supabase.from("invoices").update({ deleted_at: new Date().toISOString(), stripe_payment_link_id: null }).eq("id", inv.id);
      if (delErr) { alert(delErr.message); setSaving(false); return; }
      setSaving(false);
      setShowVoidModal(null);
      setVoidReason("");
      onDeleted && onDeleted();
    } else {
      // Two-row design: mark original voided (preserve qb_invoice_id for QB audit
      // linkage), then either branch on pay-app linkage or insert a replacement.
      const nowIso = new Date().toISOString();
      const reason = voidReason.trim();
      const { error: voidErr } = await supabase.from("invoices").update({
        voided_at: nowIso,
        void_reason: reason,
        stripe_payment_link_id: null,
        stripe_checkout_id: null,
        stripe_checkout_url: null,
        stripe_payment_id: null,
      }).eq("id", inv.id);
      if (voidErr) { alert(voidErr.message); setSaving(false); return; }

      if (linkedPayApp) {
        // Pay-app path: pay app to draft + clear FK. New invoice born on re-lock.
        await supabase.from("billing_schedule_pay_apps")
          .update({ status: "draft", submitted_at: null, invoice_id: null })
          .eq("id", linkedPayApp.id);
        setLinkedPayApp(prev => prev ? { ...prev, status: "draft", submitted_at: null, invoice_id: null } : prev);
        setInv(prev => ({ ...prev, voided_at: nowIso, void_reason: reason }));
        setSaving(false);
        setShowVoidModal(null);
        setVoidReason("");
        onUpdated && onUpdated();
      } else {
        // Non-pay-app: insert replacement at next-free-ID with copied fields.
        const { data: recent } = await supabase
          .from("invoices")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(50);
        const nums = (recent || []).map(r => parseInt(r.id, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
        const median = nums.length ? nums[Math.floor(nums.length / 2)] : 10000;
        const seqNums = nums.filter(n => n <= median * 2);
        const lastNum = Math.max(seqNums.length ? seqNums[seqNums.length - 1] : 0, 9999);
        const nextId = String(lastNum + 1).padStart(5, "0");

        const { data: newInv, error: newErr } = await supabase.from("invoices").insert([{
          id: nextId,
          tenant_id: inv.tenant_id,
          job_id: inv.job_id,
          job_name: inv.job_name,
          call_log_id: inv.call_log_id,
          proposal_id: inv.proposal_id,
          amount: inv.amount,
          discount: inv.discount,
          retention_pct: inv.retention_pct,
          retention_amount: inv.retention_amount,
          retention_released: inv.retention_released, // carry release flag so the Bill Retention button can't reappear → double-bill
          due_date: inv.due_date,
          description: inv.description,
          intro: inv.intro,
          show_cents: inv.show_cents,
          status: "New",
          type: inv.type || "regular", // replacement inherits the voided invoice's kind
        }]).select().single();
        if (newErr) { alert(`Replacement invoice insert failed: ${newErr.message}`); setSaving(false); return; }

        if (lines && lines.length > 0) {
          const newLines = lines.map(l => ({
            invoice_id: nextId,
            proposal_wtc_id: l.proposal_wtc_id || null,
            billing_schedule_line_id: l.billing_schedule_line_id || null,
            billing_pct: l.billing_pct,
            amount: l.amount,
          }));
          const { error: linesErr } = await supabase.from("invoice_lines").insert(newLines);
          if (linesErr) { alert(`Replacement invoice lines failed: ${linesErr.message}`); setSaving(false); return; }
        }

        setSaving(false);
        setShowVoidModal(null);
        setVoidReason("");
        onUpdated && onUpdated();
        if (onNavigateInvoice) onNavigateInvoice(nextId);
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: C.dark, border: "none", cursor: "pointer", color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 14px", borderRadius: 6 }}>
          ← Invoices
        </button>
        {inv.proposals?.call_log_id && onNavigateJob && (
          <button onClick={() => onNavigateJob(inv.proposals.call_log_id)} title="Open Call Log entry" style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 6 }}>
            Job →
          </button>
        )}
        {inv.proposal_id && onNavigateProposal && (
          <button onClick={() => onNavigateProposal(inv.proposal_id)} title="Open Proposal" style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 12px", borderRadius: 6 }}>
            Proposal →
          </button>
        )}
      </div>

      {/* Job Billing Progress Scoreboard */}
      {billingSummary && (
        <div style={{ background: C.dark, borderRadius: 10, padding: "14px 20px", marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 16, alignItems: "center" }}>
          {[
            { label: "Contract Sum", value: fmt$(billingSummary.contractSum) },
            { label: "Billed to Date", value: fmt$(billingSummary.totalBilled) },
            { label: "Balance", value: fmt$(billingSummary.balance) },
            { label: "Retainage Held", value: fmt$(billingSummary.totalRetainage) },
            { label: "Pay Apps", value: `${billingSummary.payAppCount}` },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{s.value}</div>
            </div>
          ))}
          {billingSummary.contractSum > 0 && (
            <div style={{ gridColumn: "1 / -1", height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (billingSummary.totalBilled / billingSummary.contractSum) * 100)}%`, background: C.teal, borderRadius: 3, transition: "width 0.3s ease" }} />
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>Invoice #</span>
            <input value={editId} onChange={e => setEditId(e.target.value)} disabled={syncedLock} title={syncedLock ? "Locked — keeps the QuickBooks invoice number stable" : undefined} style={{ ...inputStyle, width: 120, fontSize: 20, fontWeight: 800, fontFamily: F.display, padding: "6px 10px", ...(syncedLock ? { opacity: 0.55, cursor: "not-allowed" } : {}) }} />
            {syncedLock && <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Locked — synced to QuickBooks</span>}
          </div>
        ) : (
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>
            Invoice #{inv.id}
          </h2>
        )}
        <Pill label={inv.status} cm={INV_C} />
        {inv.voided_at && <Pill label="VOIDED" cm={INV_C} />}
        {!editing && !inv.voided_at && ageDays !== null && (
          <span style={{ fontSize: 12, fontWeight: 800, fontFamily: F.display, color: ageDays > 0 ? C.red : ageDays === 0 ? C.amber : C.green }}>
            {ageDays > 0 ? `${ageDays}d overdue` : ageDays === 0 ? "Due today" : `${Math.abs(ageDays)}d until due`}
          </span>
        )}
      </div>
      <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui, marginBottom: editing ? 16 : 28 }}>
        {inv.job_id && `Job: ${inv.job_id}`}{inv.job_name ? ` · ${inv.job_name}` : ""}
        {inv.sent_at ? ` · Sent ${fmtD(inv.sent_at)}` : ""}
        {!editing && inv.due_date ? ` · Due ${fmtD(inv.due_date)}` : ""}
      </div>
      {inv.voided_at && (
        <div style={{ background: "rgba(229,57,53,0.08)", border: `1px solid ${C.red}`, borderRadius: 8, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: C.textBody, fontFamily: F.ui }}>
          <strong style={{ color: C.red }}>Voided {fmtD(inv.voided_at)}</strong>
          {inv.void_reason ? ` — ${inv.void_reason}` : ""}
          {inv.qb_invoice_id ? ` · QB invoice ${inv.qb_invoice_id} retained as audit record.` : ""}
        </div>
      )}

      {/* Edit fields (only in edit mode) */}
      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          {syncedLock && (
            <div style={{ gridColumn: "1 / -1", background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 12.5, lineHeight: 1.5, color: C.textBody, fontFamily: F.ui }}>
              This invoice is already sent and synced to QuickBooks. You can edit the <strong>work description</strong> (e.g. add a PO number — prints on the invoice and updates the QuickBooks memo), the <strong>email introduction</strong>, and the <strong>due date</strong>. The invoice number and dollar amounts are locked so the QuickBooks record stays stable. Saving re-syncs to QuickBooks with your reason as an audit note.
            </div>
          )}
          <div>
            <div style={labelStyle}>Due Date</div>
            <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} />
          </div>
          {/* Discount + Retention are owned by the pay-app flow for pay-app invoices —
              hide them here so the UI can't expose fields the save path must ignore
              (mirrors the already-hidden line-items table below). (plan §3) */}
          {!linkedPayApp && (
            <>
              <div>
                <div style={labelStyle}>Discount ($)</div>
                <input type="number" min="0" step="1" value={editDiscount} onChange={e => setEditDiscount(e.target.value)} disabled={syncedLock} title={syncedLock ? "Locked on a QuickBooks-synced invoice" : undefined} style={{ ...inputStyle, ...(syncedLock ? { opacity: 0.55, cursor: "not-allowed" } : {}) }} />
              </div>
              {/* Deposits carry no retention — hide the input AND force 0 in the save. */}
              {!isDepositInvoice && (
              <div>
                <div style={labelStyle}>Retention (%)</div>
                <input type="number" min="0" max="100" step="0.5" value={editRetentionPct} onChange={e => setEditRetentionPct(e.target.value)} disabled={syncedLock} title={syncedLock ? "Locked on a QuickBooks-synced invoice" : undefined} style={{ ...inputStyle, ...(syncedLock ? { opacity: 0.55, cursor: "not-allowed" } : {}) }} />
                {parseFloat(editRetentionPct) > 0 && (() => {
                  const gross = isArchiveInvoice ? (parseFloat(String(editArchiveAmount).replace(/[^0-9.\-]/g, "")) || 0) : (parseFloat(inv.amount) || 0);
                  return (
                    <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>
                      Held back: {fmt$c(gross * (parseFloat(editRetentionPct) / 100))}
                    </div>
                  );
                })()}
              </div>
              )}
            </>
          )}
          {isArchiveInvoice && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Invoice Amount ($)</div>
              <input type="text" inputMode="decimal" value={editArchiveAmount} onChange={e => setEditArchiveAmount(e.target.value)} disabled={syncedLock} title={syncedLock ? "Locked on a QuickBooks-synced invoice" : undefined} style={{ ...inputStyle, ...(syncedLock ? { opacity: 0.55, cursor: "not-allowed" } : {}) }} />
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>{syncedLock ? "Locked — synced to QuickBooks. Edit the description/intro only." : "Archive proposal — edit the invoice amount directly."}</div>
            </div>
          )}
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Email Introduction</div>
            <textarea value={editIntro} onChange={e => setEditIntro(e.target.value)} rows={4} placeholder="This goes in the body of the customer email…" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Appears in the email above the invoice card. Not printed on the invoice.</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Work Description</div>
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} placeholder="Describe the work being billed…" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Prints on the invoice above the Amount Due.</div>
          </div>
          {inv.qb_invoice_id && (
            <div style={{ gridColumn: "1 / -1", background: C.dark, border: `1.5px solid ${C.amber}`, borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ ...labelStyle, color: C.amber, fontWeight: 800, marginBottom: 6 }}>Reason for Edit — required for QuickBooks</div>
              <input
                ref={reasonRef}
                value={editReason}
                onChange={e => setEditReason(e.target.value)}
                placeholder="e.g. Added PO #12345 per GC"
                className={editReason.trim() ? undefined : "reason-pulse"}
                style={{ ...inputStyle, border: `1.5px solid ${C.amber}` }}
              />
              <div style={{ fontSize: 11, color: C.linenLight, fontFamily: F.ui, marginTop: 6 }}>This note is written to the QuickBooks invoice for audit compliance. Saving is blocked until it's filled in.</div>
            </div>
          )}
        </div>
      )}

      {/* Summary cards (read-only view) */}
      {!editing && (
        <>
          {inv.description && (
            <div style={{ background: C.linenDeep, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: C.textBody, fontFamily: F.ui, border: `1px solid ${C.border}` }}>
              {inv.description}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: inv.retention_amount > 0 ? "repeat(4,1fr)" : "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            <StatCard label={inv.retention_amount > 0 ? "Gross Billed" : "Invoice Amount"} value={money(inv.amount)} accent={C.teal} />
            <StatCard label="Discount" value={inv.discount > 0 ? money(inv.discount) : "—"} accent={C.amber} />
            {inv.retention_amount > 0 && (
              <StatCard label={`Retainage Held${inv.retention_pct > 0 ? ` (${inv.retention_pct}%)` : ""}`} value={money(inv.retention_amount)} accent={C.amber} />
            )}
            <StatCard label={inv.retention_amount > 0 ? "Payment Due" : "Net Total"} value={money((inv.amount || 0) - (inv.discount || 0) - (inv.retention_amount || 0))} accent={C.green} />
          </div>

          {/* Mark-as-deposit (internal). The deposit only "records" once the invoice is
              sent — an unsent deposit shows a 'not sent' indicator so a checked-but-still-
              required state doesn't read as contradictory. (plan v2 #1/#3) */}
          {!inv.voided_at && !inv.deleted_at && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 24, padding: "12px 16px", background: C.linenDeep, border: `1px solid ${isDepositInvoice ? C.green : C.border}`, borderLeft: `4px solid ${isDepositInvoice ? C.green : C.border}`, borderRadius: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: markingDeposit ? "wait" : "pointer" }}>
                <input type="checkbox" checked={isDepositInvoice} disabled={markingDeposit} onChange={handleToggleDeposit} style={{ width: 18, height: 18, accentColor: C.green, cursor: markingDeposit ? "wait" : "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>Mark as the job's deposit invoice</span>
              </label>
              {isDepositInvoice && (inv.sent_at
                ? <span style={{ fontSize: 11, fontWeight: 700, color: C.green, fontFamily: F.ui, background: "rgba(67,160,71,0.14)", padding: "3px 10px", borderRadius: 6 }}>Recorded{inv.paid_at ? " · paid" : ""}</span>
                : <span style={{ fontSize: 11, fontWeight: 700, color: C.amber, fontFamily: F.ui, background: "rgba(249,168,37,0.14)", padding: "3px 10px", borderRadius: 6 }}>Not sent — deposit not recorded yet</span>
              )}
            </div>
          )}
        </>
      )}

      {/* Line items — hidden for pay app invoices (managed via billing schedule) */}
      {!linkedPayApp && <div style={{ marginBottom: 24 }}>
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
                  {["WTC", "Line Item", "Line Value", "Billing %", "Line Amount"].map(h => (
                    <th key={h} style={{ padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `1px solid ${C.darkBorder}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const wtc = l.proposal_wtc;
                  const sov = l.billing_schedule_line;
                  const isSov = !wtc && sov;
                  const isArchiveLine = !wtc && !sov;
                  const lineLabel = isSov
                    ? (sov.line_code ? `${sov.line_code} — ${sov.description}` : sov.description)
                    : (wtc?.work_types?.name || l.description || (isArchiveLine ? "Archive Invoice" : "—"));
                  const wtcNum = wtc ? wtcIndex[wtc.id] : null;
                  const wtcCell = wtcNum ? `WTC ${wtcNum}` : "—";
                  const storedAmt = parseFloat(l.amount) || 0;
                  const rowTotal = isSov ? (parseFloat(sov.scheduled_value) || 0) : (wtc ? calcWtcPrice(wtc, undefined, usesExactPricing(inv.proposals)) : (isArchiveLine ? (editing ? (parseFloat(String(editArchiveAmount).replace(/[^0-9.\-]/g, "")) || 0) : storedAmt) : 0));
                  const editPct = parseFloat(editPcts[l.id]) || 0;
                  const editAmt = isArchiveLine ? rowTotal : rowTotal * (editPct / 100);
                  return (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      <td style={{ padding: "12px 15px", fontWeight: 700, color: C.textHead, whiteSpace: "nowrap" }}>{wtcCell}</td>
                      <td style={{ padding: "12px 15px", fontWeight: 700, color: C.textHead }}>{lineLabel}</td>
                      <td style={{ padding: "12px 15px", fontVariantNumeric: "tabular-nums" }}>{money(rowTotal)}</td>
                      <td style={{ padding: "12px 15px" }}>
                        {isArchiveLine ? (
                          <span style={{ color: C.textFaint, fontSize: 12, fontFamily: F.ui }}>—</span>
                        ) : editing ? (
                          <input type="number" min="0" max="100" step="1" value={editPcts[l.id] || ""} onChange={e => setEditPcts(prev => ({ ...prev, [l.id]: e.target.value }))} disabled={syncedLock} title={syncedLock ? "Locked on a QuickBooks-synced invoice" : undefined} style={{ ...inputStyle, width: 70, padding: "4px 8px", fontSize: 12, textAlign: "right", ...(syncedLock ? { opacity: 0.55, cursor: "not-allowed" } : {}) }} />
                        ) : (
                          <span style={{ background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 6, fontWeight: 800, fontSize: 12 }}>{l.billing_pct}%</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 15px", fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{editing ? money(editAmt) : money(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>}


      {/* Recipients (main gets the pay link, viewers get a view-only copy) */}
      {!inv.voided_at && !linkedPayApp && (
        <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Recipients</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui, marginBottom: 12 }}>The <strong>main</strong> recipient gets the secure pay link. Viewers get a view-only copy.</div>

          {recipients.length === 0 ? (
            /* No explicit rows yet — show the resolved billing contact as the default main (no write). */
            <div style={{ padding: "10px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{custInfo.billingName || custInfo.name || <span style={{ color: C.textFaint, fontStyle: "italic" }}>Billing contact</span>}</div>
                <div style={{ fontSize: 12, color: custInfo.billingEmail ? C.textMuted : C.textFaint, fontFamily: F.ui, marginTop: 1 }}>
                  {custInfo.billingEmail || <span style={{ fontStyle: "italic" }}>No billing email on file — add one on the customer record</span>}
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Main · pay link</div>
            </div>
          ) : (
            <>
              {!recipients.some(r => r.role === "main") && (
                <div style={{ padding: "8px 12px", background: "rgba(229,57,53,0.08)", border: `1px solid ${C.red}`, borderRadius: 8, marginBottom: 6, fontSize: 12, color: C.red, fontFamily: F.ui, fontWeight: 600 }}>
                  No main recipient — pick who gets the pay link. Sending is blocked until one is set.
                </div>
              )}
              {recipients.map(r => {
                const isEditing = editingRecipient === r.id;
                const isMain = r.role === "main";
                const custRole = r.customer_contacts?.role || "Contact";
                const name = r.contact_name || "";
                // Prefer the linked contact's LIVE email over the stored snapshot
                // so the card stays accurate after a Customers-page edit (T5 #1).
                // Orphan rows (no customer_contact_id) fall back to the snapshot.
                const email = (r.customer_contact_id && r.customer_contacts?.email) || r.contact_email || "";
                const phone = r.phone || "";
                return (
                  <div key={r.id} style={{ padding: "10px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
                    {isEditing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input value={recipDraft.name || ""} onChange={e => setRecipDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                          <select value={recipDraft.role || "Project Manager"} onChange={e => setRecipDraft(d => ({ ...d, role: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }}>
                            <option>Project Manager</option>
                            <option>Office Manager</option>
                            <option>Billing Contact</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <input value={recipDraft.email || ""} onChange={e => setRecipDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                          <input value={recipDraft.phone || ""} onChange={e => setRecipDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" style={{ flex: 0.7, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                        </div>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <Btn sz="sm" v="ghost" onClick={() => { setEditingRecipient(null); setRecipDraft({}); }}>Cancel</Btn>
                          <Btn sz="sm" onClick={() => saveRecipient(r.id)}>Save</Btn>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{name || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No name</span>}</div>
                          <div style={{ fontSize: 12, color: email && !isValidEmail(email) ? (C.red || "#e53935") : C.textMuted, fontFamily: F.ui, marginTop: 1 }}>
                            {email || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No email</span>}
                            {email && !isValidEmail(email) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>Invalid</span>}
                          </div>
                          {phone && <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 1 }}>{phone}</div>}
                        </div>
                        <button onClick={() => toggleMain(r.id)} title={isMain ? "Main recipient (gets pay link). Click to make a viewer." : "Make this the main recipient (gets pay link)"} style={{ fontSize: 10, fontWeight: 700, color: isMain ? C.teal : C.textMuted, background: isMain ? C.dark : "none", border: isMain ? `1px solid ${C.dark}` : `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>{isMain ? "Main" : "Viewer"}</button>
                        {!r.customer_contact_id && (
                          <button onClick={() => saveToCustomerFile(r.id)} title="Add this recipient to the parent customer's contact list" style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: "none", border: `1px dashed ${C.tealBorder || C.teal}`, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer", whiteSpace: "nowrap" }}>Save to Customer</button>
                        )}
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{custRole}</div>
                        <button onClick={() => { setEditingRecipient(r.id); setRecipDraft({ name, email, phone, role: custRole !== "Contact" ? custRole : "Project Manager" }); }} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Edit</button>
                        <button onClick={() => deleteRecipient(r.id)} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }} title="Remove from this invoice (customer contact stays)">Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {showAddPicker ? (
            <div style={{ padding: "10px 12px", background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8, marginTop: 4, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Add from customer contacts</div>
              {(() => {
                const available = customerContacts.filter(c => !recipients.some(r => r.customer_contact_id === c.id));
                if (available.length === 0) return <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No other contacts on file for this customer.</div>;
                return available.map(c => (
                  <button key={c.id} onClick={() => pickExistingContact(c)} style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 6, cursor: "pointer", fontFamily: F.ui }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textHead }}>{c.name || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No name</span>}</div>
                      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>{c.email || <span style={{ color: C.textFaint, fontStyle: "italic" }}>No email</span>}</div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{c.role || "Contact"}</div>
                  </button>
                ));
              })()}
              {newContactOpen ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: C.linen, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={recipDraft.name || ""} onChange={e => setRecipDraft(d => ({ ...d, name: e.target.value }))} placeholder="Name" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                    <select value={recipDraft.role || "Project Manager"} onChange={e => setRecipDraft(d => ({ ...d, role: e.target.value }))} style={{ padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }}>
                      <option>Project Manager</option>
                      <option>Office Manager</option>
                      <option>Billing Contact</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={recipDraft.email || ""} onChange={e => setRecipDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" style={{ flex: 1, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                    <input value={recipDraft.phone || ""} onChange={e => setRecipDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" style={{ flex: 0.7, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                  </div>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Btn sz="sm" v="ghost" onClick={() => { setNewContactOpen(false); setRecipDraft({}); }}>Cancel</Btn>
                    <Btn sz="sm" onClick={createNewRecipient}>Save</Btn>
                  </div>
                </div>
              ) : (
                <Btn sz="sm" v="ghost" onClick={() => { setNewContactOpen(true); setRecipDraft({ name: "", email: "", phone: "", role: "Project Manager" }); }}>+ New Contact</Btn>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Btn sz="sm" v="ghost" onClick={() => { setShowAddPicker(false); setNewContactOpen(false); setRecipDraft({}); }}>Done</Btn>
              </div>
            </div>
          ) : (
            <Btn sz="sm" v="ghost" onClick={() => setShowAddPicker(true)} style={{ marginTop: 4 }} disabled={!custInfo.id}>+ Add Contact</Btn>
          )}
        </div>
      )}

      {/* Attachments — manage documents emailed with this invoice (add/label/remove).
          Same surface class as Recipients; the send flow only reviews these. (plan §4.2/§4.5) */}
      {!inv.voided_at && !linkedPayApp && (
        <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Attachments</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui, marginBottom: 12 }}>Documents emailed with this invoice — up to {MAX_INVOICE_ATTACHMENTS} files, 10 MB each.</div>

          {attachments.map(att => {
            const safeHref = isSafeAttachmentHref(att.file_url);
            const isEditing = editingAttachId === att.id;
            return (
              <div key={att.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
                {isEditing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                    <input value={attachLabelDraft} onChange={e => setAttachLabelDraft(e.target.value)} placeholder="Label (optional)" style={{ padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none" }} />
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <Btn sz="sm" v="ghost" onClick={() => { setEditingAttachId(null); setAttachLabelDraft(""); }}>Cancel</Btn>
                      <Btn sz="sm" onClick={() => saveAttachmentLabel(att, attachLabelDraft)}>Save</Btn>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{att.label || att.file_name}</div>
                      {att.label && att.label !== att.file_name && <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.file_name}</div>}
                    </div>
                    {safeHref
                      ? <a href={att.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 10px", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>View</a>
                      : <span style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>Unavailable</span>}
                    <button onClick={() => { setEditingAttachId(att.id); setAttachLabelDraft(att.label || ""); }} title="Rename label" style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Label</button>
                    <button onClick={() => handleRemoveAttachment(att)} title="Remove from this invoice" style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 5, padding: "3px 8px", fontSize: 10, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Remove</button>
                  </>
                )}
              </div>
            );
          })}

          {attachments.length < MAX_INVOICE_ATTACHMENTS && (
            <div style={{ marginTop: attachments.length ? 8 : 0, padding: "10px 12px", background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input value={attachLabel} onChange={e => setAttachLabel(e.target.value)} placeholder="Label (optional)" style={{ flex: 1, minWidth: 140, padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linen, color: C.textBody, WebkitAppearance: "none" }} />
              </div>
              <label style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: C.dark, background: C.teal, borderRadius: 6, padding: "6px 14px", cursor: uploadingAttachment ? "wait" : "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                {uploadingAttachment ? "Uploading…" : "+ Add Attachment"}
                <input type="file" accept="application/pdf,.docx,.xlsx,.xls,image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleUploadAttachment(f, attachLabel).then(ok => { if (ok) setAttachLabel(""); }); }} style={{ display: "none" }} disabled={uploadingAttachment} />
              </label>
            </div>
          )}
          {attachError && <div style={{ fontSize: 11.5, color: C.red || "#e53935", fontFamily: F.ui, marginTop: 8 }}>{attachError}</div>}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {editing ? (
          <>
            <Btn sz="sm" onClick={handleSaveEdit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Btn>
            <Btn sz="sm" v="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
          </>
        ) : inv.voided_at ? (
          <>
            <Btn sz="sm" v="ghost" onClick={handleDelete}>Hide from Lists</Btn>
          </>
        ) : (
          <>
            <Btn sz="sm" onClick={() => setShowPDF(true)}>{linkedPayApp ? "Preview" : "Send / Resend"}</Btn>
            {linkedPayApp && <Btn sz="sm" v="secondary" onClick={() => setShowPayAppReview(true)}>Review Package</Btn>}
            {canEditInPlace && <Btn sz="sm" v="secondary" onClick={startEditing}>{isNew ? "Edit Invoice" : "Edit Sent Invoice"}</Btn>}
            {inv.retention_amount > 0 && !inv.retention_released && !inv.retention_release_of && (
              <Btn sz="sm" onClick={() => handleBillRetention(inv)} disabled={billing}>
                {billing ? "Billing…" : `Bill Retention ${money(inv.retention_amount)}`}
              </Btn>
            )}
            {inv.retention_released && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.dark, color: C.teal, padding: "6px 12px", borderRadius: 6, fontWeight: 800, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Retention billed
                {releaseInvoiceId && (
                  <button onClick={() => onNavigateInvoice && onNavigateInvoice(releaseInvoiceId)} style={{ background: "none", border: "none", cursor: "pointer", color: C.teal, fontWeight: 800, fontSize: 11, fontFamily: F.display, textDecoration: "underline", padding: 0 }}>
                    → #{releaseInvoiceId}
                  </button>
                )}
              </span>
            )}
            {actions.map(a => (
              <Btn key={a.status} sz="sm" v="ghost" onClick={() => updateStatus(a.status)}>{a.label}</Btn>
            ))}
            {!inv.qb_invoice_id
              && !inv.proposals?.call_log?.qb_skip_sync
              && inv.proposals?.call_log?.qb_customer_id
              && (inv.status !== "New" || linkedPayApp) && (
              <Btn sz="sm" v="secondary" onClick={handleQBSync} disabled={syncing}>
                {syncing ? "Syncing…" : linkedPayApp ? "Sync to QB" : "Sync to QuickBooks"}
              </Btn>
            )}
            {canPullBack && (
              <Btn sz="sm" v="ghost" onClick={handlePullBack}>Pull Back</Btn>
            )}
            <Btn sz="sm" v="ghost" onClick={handleDelete}>Delete</Btn>
          </>
        )}
      </div>

      {syncError && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(229,57,53,0.12)", border: `1px solid ${C.red}`, borderRadius: 8, fontSize: 13, color: C.red, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{syncError}</span>
          {syncReLink && inv.proposals?.call_log_id && (
            <Btn sz="sm" v="ghost" onClick={() => setShowQBLinkModal(true)}>Re-link Job</Btn>
          )}
          <button onClick={() => { setSyncError(null); setSyncReLink(false); }} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {syncToast && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(67,160,71,0.14)", border: `1px solid ${C.green}`, borderRadius: 8, fontSize: 13, color: C.green, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>{syncToast}</span>
          <button onClick={() => setSyncToast(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14, fontWeight: 700, opacity: 0.6 }}>✕</button>
        </div>
      )}

      {/* Customer Billing Schedule (SOV / G702-G703) */}
      {billingProposal && inv.proposal_id && (
        <div style={{ marginTop: 18 }}>
          <BillingScheduleSection proposal={billingProposal} teamMember={teamMember} />
        </div>
      )}

      {showQBLinkModal && inv.proposals?.call_log_id && (
        <QBLinkModal
          callLogId={inv.proposals.call_log_id}
          currentQbCustomerId={inv.proposals?.call_log?.qb_customer_id}
          onClose={() => setShowQBLinkModal(false)}
          onLinked={async () => {
            setShowQBLinkModal(false);
            setSyncError(null);
            setSyncReLink(false);
            const { data: refreshed } = await supabase
              .from("invoices")
              .select(`*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id))`)
              .eq("id", inv.id)
              .maybeSingle();
            if (refreshed) setInv(prev => ({ ...prev, ...refreshed }));
            onUpdated && onUpdated();
          }}
        />
      )}
      {inv.status === "Paid" && inv.paid_at && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 12, color: C.green, fontWeight: 700, fontFamily: F.display }}>
            Paid {fmtD(inv.paid_at)}{inv.stripe_payment_id ? ` · Stripe ${inv.stripe_payment_id}` : ""}
          </div>
          <Btn sz="sm" v="secondary" onClick={() => setShowPaidPDF(true)}>View Paid Invoice</Btn>
        </div>
      )}
      {showPaidPDF && (
        <InvoicePDFModal
          invoice={inv}
          lines={lines}
          wtcIndex={wtcIndex}
          teamMember={teamMember}
          onClose={() => setShowPaidPDF(false)}
        />
      )}

      {showPDF && (
        <InvoicePDFModal
          invoice={inv}
          lines={lines}
          wtcIndex={wtcIndex}
          teamMember={teamMember}
          recipients={recipients}
          attachments={attachments}
          hideSend={!!linkedPayApp}
          onClose={() => setShowPDF(false)}
          onSent={async (responseData) => {
            const updates = { status: "Sent", sent_at: new Date().toISOString(), viewing_token_expires_at: new Date(Date.now() + 90 * 86400000).toISOString(), stripe_checkout_id: null, stripe_checkout_url: responseData?.checkoutUrl || null, stripe_payment_link_id: responseData?.paymentLinkId || null };
            await supabase.from("invoices").update(updates).eq("id", inv.id);
            setInv(prev => ({ ...prev, ...updates }));   // instant feedback
            await reloadInv();                            // reconcile server-written fields (e.g. qb_invoice_id from the pay-app approve path, which syncs before onSent)
            onUpdated && onUpdated();
          }}
          onQbSynced={async () => { await reloadInv(); onUpdated && onUpdated(); }}
        />
      )}

      {showPayAppReview && linkedPayApp && (
        <PayAppDetailModal
          payAppId={linkedPayApp.id}
          schedule={{ id: linkedPayApp.billing_schedule_id }}
          proposal={inv.proposals || {}}
          onClose={() => setShowPayAppReview(false)}
          onChanged={() => onUpdated?.()}
        />
      )}

      {/* Void / Delete Confirmation Modal */}
      {showVoidModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget && !saving) { setShowVoidModal(null); setVoidReason(""); } }}>
          <div style={{ background: C.linenCard, borderRadius: 16, width: "min(480px,90vw)", padding: "28px 32px", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.red, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>
              {showVoidModal === "delete" ? "Delete Invoice" : "Pull Back Invoice"}
            </div>

            <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui, marginBottom: 16, lineHeight: 1.6 }}>
              Invoice <strong>#{inv.id}</strong> has been synced to QuickBooks.
              {showVoidModal === "delete"
                ? " Deleting this invoice will void it in QuickBooks to preserve the audit trail. The invoice will remain in QB as a $0.00 voided record."
                : " Pulling back this invoice will void it in QuickBooks and reset it to draft in Sales Command. The QB record will remain as a $0.00 voided entry for compliance."}
            </div>

            <div style={{ background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: C.textFaint, fontFamily: F.ui, lineHeight: 1.5 }}>
              A timestamped note with your reason will be recorded on the QuickBooks invoice before it is voided. This is required for accounting compliance.
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.display }}>Reason for {showVoidModal === "delete" ? "Deletion" : "Pull Back"} *</div>
              <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)}
                placeholder="e.g. Duplicate invoice, billing error, customer requested cancellation..."
                rows={3}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn sz="sm" v="ghost" onClick={() => { setShowVoidModal(null); setVoidReason(""); }} disabled={saving}>Cancel</Btn>
              <Btn sz="sm" onClick={handleVoidConfirm} disabled={saving || !voidReason.trim()} style={{ background: C.red, borderColor: C.red }}>
                {saving ? "Processing..." : showVoidModal === "delete" ? "Void in QB & Delete" : "Void in QB & Pull Back"}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Invoices Page ────────────────────────────────────────────────────
const QB_CLIENT_ID = "ABg3H5TIV6XdDtSWlJXDC3rM7u8zKI3k5yHlbUaIrIiYNiUmc7";
const QB_REDIRECT_URI = "https://www.scmybiz.com/qb/callback";
const QB_AUTH_URL = `https://appcenter.intuit.com/connect/oauth2?client_id=${QB_CLIENT_ID}&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}&response_type=code&scope=com.intuit.quickbooks.accounting&state=salescommand`;

export default function Invoices({ setSubPage, teamMember }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeInvoiceId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const isRetentionView = searchParams.get("view") === "retention";
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [preselectedProposal, setPreselectedProposal] = useState(null);
  const [payAppContext, setPayAppContext] = useState(null); // { schedule, lines, proposal }
  const [sel, setSel] = useState(null);
  const [qbConnected, setQbConnected] = useState(null);
  const [filters, setFilters] = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "", invoiceNumber: "" });

  const load = async () => {
    const data = await fetchAll(
      "invoices",
      `*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id))`,
      { filters: [["is", "deleted_at", null]], order: { column: "sent_at", ascending: false } }
    );
    setInvoices(data);
    setLoading(false);
    return data;
  };

  const checkQb = async () => {
    const { data } = await supabase.functions.invoke("qb-auth", { body: { action: "status" } });
    setQbConnected(data?.connected || false);
  };

  useEffect(() => {
    (async () => {
      await load();
      checkQb();
    })();
  }, []);

  // Sync selected invoice with URL :id param
  useEffect(() => {
    if (!routeInvoiceId) { setSel(null); return; }
    if (invoices.length === 0) return;
    const inv = invoices.find(i => i.id === routeInvoiceId);
    if (inv) { setSel(inv); return; }
    // Not in active list — could be voided. Fetch directly so audit-trail
    // direct URLs (e.g. /invoices/<voided-id>) still resolve.
    (async () => {
      const { data } = await supabase
        .from("invoices")
        .select(`*, proposals(call_log_id, ${PROPOSAL_ERA}, call_log(sales_name, customer_name, display_job_number, show_cents, qb_customer_id, qb_skip_sync, deposit_invoice_id))`)
        .eq("id", routeInvoiceId)
        .is("deleted_at", null)
        .maybeSingle();
      if (data) setSel(data);
    })();
  }, [routeInvoiceId, invoices]);

  // Auto-open New Invoice modal when ProposalDetail navigates here with a preselected proposal.
  // Pay-app routing stays owned by NewInvoiceModal.selectProposal — see Invoices.jsx:91.
  useEffect(() => {
    const proposalId = location.state?.newInvoiceProposalId;
    if (!proposalId) return;
    (async () => {
      const { data } = await supabase
        .from("proposals")
        .select(`id, customer, total, proposal_number, call_log_id, is_archive_proposal, historical_billed_amount, ${PROPOSAL_ERA}, call_log(display_job_number, customer_name, job_name, show_cents)`)
        .eq("id", proposalId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!data) return;
      setPreselectedProposal(data);
      setShowModal(true);
      // Consume the state so back-nav / refresh doesn't re-trigger.
      navigate(location.pathname + location.search, { replace: true, state: null });
    })();
  }, [location.state?.newInvoiceProposalId]);

  // Voided rows still render in the list (audit trail) but are excluded from totals.
  const activeInvoices = invoices.filter(i => !i.voided_at);
  const drafted = activeInvoices.filter(i => i.status === "New").reduce((a, i) => a + (i.amount || 0), 0);
  const pending = activeInvoices.filter(i => ["Sent","Waiting for Payment","Past Due"].includes(i.status)).reduce((a, i) => a + (i.amount || 0), 0);
  const paid    = activeInvoices.filter(i => i.status === "Paid").reduce((a, i) => a + (i.amount || 0), 0);

  const retentionInvoices = activeInvoices.filter(i => parseFloat(i.retention_amount) > 0 && i.status !== "Paid");
  const totalRetentionHeld = retentionInvoices.reduce((a, i) => a + (parseFloat(i.retention_amount) || 0), 0);

  const aging = (inv) => {
    if (!inv.due_date || inv.status === "Paid") return null;
    return Math.round((new Date() - new Date(inv.due_date)) / 86400000);
  };

  const baseList = isRetentionView ? retentionInvoices : invoices;
  const filteredInvoices = baseList.filter(inv => {
    const sales = inv.proposals?.call_log?.sales_name || "";
    const cust = inv.proposals?.call_log?.customer_name || inv.job_name || "";
    const jobNum = inv.proposals?.call_log?.display_job_number || inv.job_id || "";
    if (filters.sales && sales !== filters.sales) return false;
    if (filters.dateFrom && (inv.sent_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (inv.sent_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.customer && !cust.toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !jobNum.toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    if (filters.invoiceNumber && !String(inv.id).toLowerCase().includes(filters.invoiceNumber.toLowerCase())) return false;
    return true;
  });

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(sel ? "detail" : showModal ? "new" : null);
  }, [sel, showModal]);

  if (sel) return <InvoiceDetail
    key={sel.id}
    invoice={sel}
    teamMember={teamMember}
    onBack={() => { navigate("/invoices"); load(); }}
    onUpdated={async () => { const data = await load(); const fresh = (data || []).find(i => i.id === sel.id); if (fresh) setSel(fresh); }}
    onDeleted={() => { navigate("/invoices"); load(); }}
    onNavigateJob={id => navigate(`/calllog/${id}`)}
    onNavigateProposal={id => navigate(`/proposals/${id}`)}
    onNavigateInvoice={id => { navigate(`/invoices/${id}`); load(); }}
  />;

  return (
    <>
      {showModal && (
        <NewInvoiceModal
          preselectedProposal={preselectedProposal}
          onClose={() => { setShowModal(false); setPreselectedProposal(null); }}
          onCreated={(inv) => { setShowModal(false); setPreselectedProposal(null); navigate(`/invoices/${inv.id}`); load(); }}
          onOpenPayApp={async (p) => {
            setShowModal(false);
            setPreselectedProposal(null);
            const { data: sch } = await supabase
              .from("billing_schedule")
              .select("*")
              .eq("proposal_id", p.id)
              .maybeSingle();
            if (!sch) return;
            const { data: lns } = await supabase
              .from("billing_schedule_lines")
              .select("*")
              .eq("billing_schedule_id", sch.id)
              .order("ordinal", { ascending: true });
            setPayAppContext({ schedule: sch, lines: lns || [], proposal: p });
          }}
        />
      )}
      {payAppContext && (
        <NewPayAppModal
          schedule={payAppContext.schedule}
          lines={payAppContext.lines}
          proposal={payAppContext.proposal}
          onClose={() => setPayAppContext(null)}
          onCreated={() => { setPayAppContext(null); load(); }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title={isRetentionView ? "Retention" : "Invoices"} action={
          <div style={{ display: "flex", gap: 8 }}>
            {isRetentionView ? (
              <Btn sz="sm" v="ghost" onClick={() => setSearchParams({})}>← All Invoices</Btn>
            ) : (
              <Btn sz="sm" v="secondary" onClick={() => setSearchParams({ view: "retention" })}>Retention</Btn>
            )}
            {!isRetentionView && <Btn sz="sm" onClick={() => setShowModal(true)}>+ New Invoice</Btn>}
          </div>
        } />
        {qbConnected === false && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "rgba(249,168,37,0.12)", border: "1px solid rgba(249,168,37,0.3)", borderRadius: 8 }}>
            <span style={{ fontSize: 13 }}>⚠</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.textBody, fontFamily: F.ui, flex: 1 }}>QuickBooks is disconnected. Invoices won't sync until reconnected.</span>
            <a href={QB_AUTH_URL} style={{ fontSize: 11, fontWeight: 700, color: C.tealDark, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap" }}>
              Reconnect
            </a>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {isRetentionView ? (
            <>
              <StatCard label="Total Retention Held" value={fmt$c(totalRetentionHeld)} accent={C.teal} />
              <StatCard label="Open Pay Apps with Retention" value={String(retentionInvoices.length)} accent={C.amber} />
              <StatCard label="Avg per Invoice" value={fmt$c(retentionInvoices.length ? totalRetentionHeld / retentionInvoices.length : 0)} accent={C.green} />
            </>
          ) : (
            <>
              <StatCard label="Total Drafted" value={fmt$c(drafted)} accent={C.teal} />
              <StatCard label="Total Pending" value={fmt$c(pending)} accent={C.amber} />
              <StatCard label="Total Paid"    value={fmt$c(paid)}    accent={C.green} />
            </>
          )}
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          salesOptions={[...new Set(invoices.map(i => i.proposals?.call_log?.sales_name).filter(Boolean))].sort()}
          showInvoiceNumber
        />

        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",       l: "Invoice #", r: v => <span style={{ fontWeight: 600, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{v}</span> },
              { k: "job_id",   l: "Job #",     r: v => <span style={{ fontWeight: 600, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{v}</span> },
              { k: "job_name", l: "Job Name",  r: v => <span style={{ fontWeight: 500, color: C.textMuted, fontFamily: F.display, maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span> },
              { k: "status",   l: "Status",    r: (v, row) => row.voided_at ? <Pill label="VOIDED" cm={INV_C} /> : <Pill label={v} cm={{ ...PROP_C, ...INV_C }} /> },
              { k: "amount",   l: isRetentionView ? "Gross Billed" : "Amount", r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$c(v)}</span> },
              isRetentionView
                ? { k: "retention_amount", l: "Retention Held",
                    sortVal: row => parseFloat(row.retention_amount) || 0,
                    r: v => {
                      const n = parseFloat(v) || 0;
                      if (!n) return <span style={{ color: C.textFaint }}>—</span>;
                      return <span style={{ fontWeight: 900, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontFamily: F.display, fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}>{fmt$c(n)}</span>;
                    }}
                : { k: "discount", l: "Discount",  r: v => v > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$c(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
              { k: "sent_at",  l: "Sent",      r: v => fmtD(v) },
              { k: "due_date", l: "Due",       r: v => fmtD(v) },
              { k: "_aging",   l: "Aging",
                sortVal: row => {
                  const d = aging(row);
                  return d === null ? null : d;
                },
                r: (_, row) => {
                  const d = aging(row);
                  if (d === null) return <span style={{ color: C.textFaint }}>—</span>;
                  return <span style={{ fontWeight: 800, fontFamily: F.display, color: d > 0 ? C.red : d === 0 ? C.amber : C.green }}>
                    {d > 0 ? `${d}d overdue` : d === 0 ? "Due today" : `${Math.abs(d)}d`}
                  </span>;
                }},
            ]}
            rows={filteredInvoices}
            onRow={row => navigate(`/invoices/${row.id}`)}
            defaultSort={isRetentionView ? { key: "retention_amount", dir: "desc" } : { key: "sent_at", dir: "desc" }}
          />
        )}
      </div>
    </>
  );
}
