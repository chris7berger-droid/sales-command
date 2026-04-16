import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmt$, fmt$c, fmtD } from "../lib/utils";
import { calcWtcPrice } from "../lib/calc";
import { INV_C, PROP_C } from "../lib/mockData";
import { getTenantConfig, DEFAULTS } from "../lib/config";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import FilterBar from "../components/FilterBar";

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
  const [description, setDescription] = useState("");
  const money = selProposal?.call_log?.show_cents ? fmt$c : fmt$;

  // Load default invoice description
  useEffect(() => {
    getTenantConfig().then(cfg => {
      if (cfg.default_invoice_description && !description) {
        setDescription(cfg.default_invoice_description);
      }
    });
  }, []);

  // Step 1: load Sold proposals
  useEffect(() => {
    async function loadProposals() {
      const { data } = await supabase
        .from("proposals")
        .select("id, customer, total, proposal_number, call_log_id, call_log(display_job_number, customer_name, job_name, show_cents)")
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
    if (!dueDate) { setError("Due date is required."); return; }
    const valErr = validatePcts();
    if (valErr) { setError(valErr); return; }
    setSaving(true);
    setError(null);

    // Generate next invoice ID (zero-padded 5-digit)
    const { data: latest } = await supabase
      .from("invoices")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    const lastNum = Math.max(latest?.length ? parseInt(latest[0].id, 10) : 0, 9999);
    const nextId = String(lastNum + 1).padStart(5, "0");

    const jobNum = selProposal.call_log?.display_job_number || selProposal.call_log?.job_name || "";
    const jobName = selProposal.call_log?.job_name || selProposal.customer || "";

    // Create invoice
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .insert([{
        id: nextId,
        job_id: jobNum,
        job_name: jobName,
        status: "New",
        amount: Math.round(invoiceTotal * 100) / 100,
        discount: 0,
        proposal_id: selProposal.id,
        due_date: dueDate || null,
        description: description.trim() || null,
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
                  <span style={{ fontWeight: 800, fontFamily: F.display, color: C.textHead }}>{(p.call_log?.show_cents ? fmt$c : fmt$)(p.total)}</span>
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
                        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>Total: {money(total)}</div>
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
            </div>

            {/* Due date */}
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Due Date *</div>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, width: 200, cursor: "pointer" }} />
            </div>

            {/* Description / Introduction */}
            <div style={{ marginTop: 12 }}>
              <div style={labelStyle}>Invoice Description</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
                placeholder="Add a message to appear on the invoice..."
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
              />
            </div>

            {/* Total + Create */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              <div>
                <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.display, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Invoice Total</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>{money(invoiceTotal)}</div>
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

// ── Invoice PDF Modal ─────────────────────────────────────────────────────
function InvoicePDFModal({ invoice, lines, onClose, onSent }) {
  const money = fmt$c;
  const [view, setView] = useState("preview");
  const [sending, setSending] = useState(false);
  const [sendDone, setSendDone] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [billingName, setBillingName] = useState("");
  const [jobsiteAddress, setJobsiteAddress] = useState("");
  const [loadingContact, setLoadingContact] = useState(true);
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });
  const [repContact, setRepContact] = useState({ phone: "", email: "" });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
    // Load sales rep contact info
    const salesName = invoice.proposals?.call_log?.sales_name;
    if (salesName) {
      supabase.from("team_members").select("phone, email").eq("name", salesName).maybeSingle().then(({ data }) => {
        if (data) setRepContact({ phone: data.phone || "", email: data.email || "" });
      });
    }
  }, []);

  const netTotal = (invoice.amount || 0) - (invoice.discount || 0);

  // Load billing contact from proposal -> call_log -> customer
  useEffect(() => {
    async function loadContact() {
      if (!invoice.proposal_id) { setLoadingContact(false); return; }
      const { data: prop } = await supabase
        .from("proposals")
        .select("call_log_id, call_log(customer_id, customer_name, jobsite_address, jobsite_city, jobsite_state, jobsite_zip, customers(billing_email, billing_name, contact_email, first_name, last_name, name))")
        .eq("id", invoice.proposal_id)
        .maybeSingle();
      const cl = prop?.call_log;
      const cust = cl?.customers;
      if (cust) {
        setBillingEmail(cust.billing_email || cust.contact_email || "");
        setBillingName(cust.billing_name || [cust.first_name, cust.last_name].filter(Boolean).join(" ") || cust.name || "");
      }
      if (cl) {
        const parts = [cl.jobsite_address, cl.jobsite_city, cl.jobsite_state, cl.jobsite_zip].filter(Boolean);
        setJobsiteAddress(parts.length > 1 ? `${cl.jobsite_address || ""}\n${[cl.jobsite_city, cl.jobsite_state].filter(Boolean).join(", ")}${cl.jobsite_zip ? " " + cl.jobsite_zip : ""}` : parts.join(""));
      }
      setLoadingContact(false);
    }
    loadContact();
  }, [invoice.proposal_id]);

  async function handleSend() {
    if (!billingEmail) { setSendError("No billing email found. Add one to the customer record."); return; }
    setSending(true);
    setSendError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-invoice", {
        body: {
          invoiceId: invoice.id,
          customerEmail: billingEmail,
          customerName: billingName || "Customer",
          amount: netTotal,
          jobName: invoice.job_name || "",
          jobId: invoice.job_id || "",
          dueDate: invoice.due_date || null,
          senderEmail: repContact.email || "noreply@salescommand.app",
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed.");
      if (data?.error) throw new Error(data.error);
      // Sync to QuickBooks (non-blocking, skip test jobs)
      if (!(invoice.job_name || "").toLowerCase().includes("test")) {
        supabase.functions.invoke("qb-sync-invoice", { body: { invoiceId: invoice.id } })
          .then(r => { if (r.data?.error) console.warn("QB invoice sync:", r.data.error); else console.log("QB invoice synced:", r.data); })
          .catch(e => console.warn("QB invoice sync failed:", e.message));
      }
      setSendDone(true);
      onSent && onSent(data);
    } catch (e) {
      setSendError(e.message || "Send failed. Please try again.");
    }
    setSending(false);
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
                {invoice.status === "New" && <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>Send Invoice</button>}
              </>
            )}
            {view === "send" && !sendDone && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Back to Preview</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9CA3AF", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>x</button>
          </div>
        </div>

        {/* Modal body */}
        <div data-inv-body style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

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

              {/* Description / Introduction */}
              {invoice.description && (
                <div style={{ fontSize: 13, color: "#4a4238", lineHeight: 1.6, marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)", whiteSpace: "pre-wrap" }}>
                  {invoice.description}
                </div>
              )}

              {/* Line items table */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Line Items</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #1c1814" }}>
                      {["Description", "Amount", "Billing %", "Line Total"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: h === "Description" ? "left" : "right", fontWeight: 700, fontSize: 10.5, color: "#887c6e", textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const wtc = l.proposal_wtc;
                      const wtcTotal = wtc ? calcWtcPrice(wtc) : 0;
                      return (
                        <tr key={l.id} style={{ borderBottom: "1px solid rgba(28,24,20,0.1)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{wtc?.work_types?.name || "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(wtcTotal)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>{l.billing_pct}%</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(l.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              {invoice.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                    <span style={{ color: "#887c6e", fontWeight: 600 }}>Subtotal</span>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(invoice.amount)}</span>
                  </div>
                </div>
              )}
              {invoice.discount > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 40, fontSize: 13 }}>
                    <span style={{ color: "#e53935", fontWeight: 600 }}>Discount</span>
                    <span style={{ fontWeight: 700, color: "#e53935", fontVariantNumeric: "tabular-nums" }}>-{money(invoice.discount)}</span>
                  </div>
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

          {view === "send" && !sendDone && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Invoice</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>This will email the customer an invoice with a secure payment link.</div>
              {loadingContact ? (
                <div style={{ color: "#6B7280", fontSize: 13 }}>Loading billing contact...</div>
              ) : (
                <>
                  <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Sending to</div>
                    <div style={{ fontWeight: 600, color: "#111827" }}>{billingEmail || <span style={{ color: "#e53935" }}>No billing email on file</span>}</div>
                    {billingName && <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>{billingName}</div>}
                  </div>
                  <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Amount</div>
                    <div style={{ fontWeight: 700, color: "#111827", fontSize: 18 }}>{money(netTotal)}</div>
                  </div>
                  {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12, background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 8, padding: "10px 14px" }}>{sendError}</div>}
                  <button onClick={handleSend} disabled={sending} style={{ width: "100%", background: sending ? "#ccc" : "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: sending ? "default" : "pointer", fontFamily: "inherit" }}>
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
              <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>The customer will receive an email with a secure payment link.</div>
              <button onClick={onClose} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Close</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Invoice Detail ────────────────────────────────────────────────────────
function InvoiceDetail({ invoice, onBack, onUpdated, onDeleted }) {
  const money = fmt$c;
  const [inv, setInv] = useState(invoice);
  const [lines, setLines] = useState([]);
  const [wtcMap, setWtcMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showPDF, setShowPDF] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState(invoice.id);
  const [editDueDate, setEditDueDate] = useState(invoice.due_date || "");
  const [editDiscount, setEditDiscount] = useState(String(invoice.discount || 0));
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
  }, []);
  const [editDesc, setEditDesc] = useState(invoice.description || "");
  const [editPcts, setEditPcts] = useState({});
  const [saving, setSaving] = useState(false);
  const [showPaidPDF, setShowPaidPDF] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(null); // "delete" | "pullback" | null
  const [voidReason, setVoidReason] = useState("");
  const [editReason, setEditReason] = useState("");

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
    if (newStatus === "Paid" && !inv.paid_at) updates.paid_at = new Date().toISOString();
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    // Sync payment to QuickBooks when marked as Paid (skip test jobs)
    if (newStatus === "Paid" && inv.qb_invoice_id && !(inv.job_name || "").toLowerCase().includes("test")) {
      supabase.functions.invoke("qb-record-payment", { body: { invoiceId: inv.id } })
        .then(r => { if (r.data?.error) console.warn("QB payment sync:", r.data.error); else console.log("QB payment recorded:", r.data); })
        .catch(e => console.warn("QB payment sync failed:", e.message));
    }
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
  const canPullBack = inv.status !== "New" && inv.status !== "Paid";
  const isNew = inv.status === "New";

  async function handleDelete() {
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

  function startEditing() {
    setEditId(inv.id);
    setEditDueDate(inv.due_date || "");
    setEditDiscount(String(inv.discount || 0));
    setEditDesc(inv.description || "");
    const pcts = {};
    lines.forEach(l => { pcts[l.id] = String(l.billing_pct || 0); });
    setEditPcts(pcts);
    setEditing(true);
  }

  async function handleSaveEdit() {
    // Require reason if invoice is synced to QB
    if (inv.qb_invoice_id && !editReason.trim()) {
      alert("A reason for this edit is required for QuickBooks audit compliance.");
      return;
    }
    setSaving(true);
    // Recalculate line amounts based on new billing pcts
    const newLines = lines.map(l => {
      const wtc = l.proposal_wtc;
      const wtcTotal = wtc ? calcWtcPrice(wtc) : 0;
      const pct = parseFloat(editPcts[l.id]) || 0;
      return { id: l.id, billing_pct: pct, amount: Math.round(wtcTotal * (pct / 100) * 100) / 100 };
    });
    const newAmount = newLines.reduce((sum, l) => sum + l.amount, 0);

    // Update invoice
    const { error: invErr } = await supabase.from("invoices").update({
      id: editId,
      due_date: editDueDate || null,
      discount: parseFloat(editDiscount) || 0,
      description: editDesc || null,
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

    // Sync to QuickBooks with edit reason (non-blocking, skip test jobs)
    if (inv.qb_invoice_id && !(inv.job_name || "").toLowerCase().includes("test")) {
      supabase.functions.invoke("qb-sync-invoice", { body: { invoiceId: editId, editReason: editReason.trim() } })
        .then(r => { if (r.data?.error) console.warn("QB sync:", r.data.error); else console.log("QB invoice updated:", r.data); })
        .catch(e => console.warn("QB sync failed:", e.message));
    }

    setInv(prev => ({ ...prev, id: editId, due_date: editDueDate || null, discount: parseFloat(editDiscount) || 0, description: editDesc || null, amount: Math.round(newAmount * 100) / 100 }));
    setLines(prev => prev.map(l => {
      const nl = newLines.find(n => n.id === l.id);
      return nl ? { ...l, billing_pct: nl.billing_pct, amount: nl.amount } : l;
    }));
    setEditing(false);
    setEditReason("");
    setSaving(false);
    onUpdated && onUpdated();
  }

  async function handlePullBack() {
    if (inv.qb_invoice_id) {
      setShowVoidModal("pullback");
      return;
    }
    if (!confirm("Pull back this invoice? It will reset to New and invalidate any payment link.")) return;
    const updates = { status: "New", sent_at: null, stripe_checkout_id: null, stripe_checkout_url: null, stripe_payment_id: null, paid_at: null };
    const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
    if (error) { alert(error.message); return; }
    setInv(prev => ({ ...prev, ...updates }));
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

    if (showVoidModal === "delete") {
      const { error: delErr } = await supabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", inv.id);
      if (delErr) { alert(delErr.message); setSaving(false); return; }
      setSaving(false);
      setShowVoidModal(null);
      setVoidReason("");
      onDeleted && onDeleted();
    } else {
      const updates = { status: "New", sent_at: null, stripe_checkout_id: null, stripe_checkout_url: null, stripe_payment_id: null, paid_at: null, qb_invoice_id: null };
      const { error } = await supabase.from("invoices").update(updates).eq("id", inv.id);
      if (error) { alert(error.message); setSaving(false); return; }
      setInv(prev => ({ ...prev, ...updates }));
      setSaving(false);
      setShowVoidModal(null);
      setVoidReason("");
      onUpdated && onUpdated();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <button onClick={onBack} style={{ background: C.dark, border: "none", cursor: "pointer", color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 14px", borderRadius: 6, marginBottom: 20, alignSelf: "flex-start" }}>
        ← Invoices
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display }}>Invoice #</span>
            <input value={editId} onChange={e => setEditId(e.target.value)} style={{ ...inputStyle, width: 120, fontSize: 20, fontWeight: 800, fontFamily: F.display, padding: "6px 10px" }} />
          </div>
        ) : (
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>
            Invoice #{inv.id}
          </h2>
        )}
        <Pill label={inv.status} cm={INV_C} />
        {!editing && ageDays !== null && (
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

      {/* Edit fields (only in edit mode) */}
      {editing && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
          <div>
            <div style={labelStyle}>Due Date</div>
            <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...inputStyle, cursor: "pointer" }} />
          </div>
          <div>
            <div style={labelStyle}>Discount ($)</div>
            <input type="number" min="0" step="1" value={editDiscount} onChange={e => setEditDiscount(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={labelStyle}>Description / PO #</div>
            <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="e.g. PO #12345 — Gym Floor Polish" style={inputStyle} />
          </div>
          {inv.qb_invoice_id && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={labelStyle}>Reason for Edit *</div>
              <input value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Changed billing from 100% to 50% per PM request" style={inputStyle} />
              <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>Required — this note will be recorded on the QuickBooks invoice for audit compliance.</div>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
            <StatCard label="Invoice Amount" value={money(inv.amount)} accent={C.teal} />
            <StatCard label="Discount" value={inv.discount > 0 ? money(inv.discount) : "—"} accent={C.amber} />
            <StatCard label="Net Total" value={money((inv.amount || 0) - (inv.discount || 0))} accent={C.green} />
          </div>
        </>
      )}

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
                  const editPct = parseFloat(editPcts[l.id]) || 0;
                  const editAmt = wtcTotal * (editPct / 100);
                  return (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      <td style={{ padding: "12px 15px", fontWeight: 700, color: C.textHead }}>{wtc?.work_types?.name || "—"}</td>
                      <td style={{ padding: "12px 15px", fontVariantNumeric: "tabular-nums" }}>{money(wtcTotal)}</td>
                      <td style={{ padding: "12px 15px" }}>
                        {editing ? (
                          <input type="number" min="0" max="100" step="1" value={editPcts[l.id] || ""} onChange={e => setEditPcts(prev => ({ ...prev, [l.id]: e.target.value }))} style={{ ...inputStyle, width: 70, padding: "4px 8px", fontSize: 12, textAlign: "right" }} />
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
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10 }}>
        {editing ? (
          <>
            <Btn sz="sm" onClick={handleSaveEdit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Btn>
            <Btn sz="sm" v="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
          </>
        ) : (
          <>
            <Btn sz="sm" onClick={() => setShowPDF(true)}>Preview / Send</Btn>
            {isNew && <Btn sz="sm" v="secondary" onClick={startEditing}>Edit Invoice</Btn>}
            {actions.map(a => (
              <Btn key={a.status} sz="sm" v="ghost" onClick={() => updateStatus(a.status)}>{a.label}</Btn>
            ))}
            {canPullBack && (
              <Btn sz="sm" v="ghost" onClick={handlePullBack}>Pull Back</Btn>
            )}
            <Btn sz="sm" v="ghost" onClick={handleDelete}>Delete</Btn>
          </>
        )}
      </div>
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

          onClose={() => setShowPaidPDF(false)}
        />
      )}

      {showPDF && (
        <InvoicePDFModal
          invoice={inv}
          lines={lines}

          onClose={() => setShowPDF(false)}
          onSent={async (responseData) => {
            const updates = { status: "Sent", sent_at: new Date().toISOString(), stripe_checkout_id: responseData?.checkoutId || null, stripe_checkout_url: responseData?.checkoutUrl || null };
            await supabase.from("invoices").update(updates).eq("id", inv.id);
            setInv(prev => ({ ...prev, ...updates }));
            onUpdated && onUpdated();
          }}
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

export default function Invoices({ initialInvoiceId, onClearInitialInvoice, setSubPage, teamMember }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [sel, setSel] = useState(null);
  const [qbConnected, setQbConnected] = useState(null);
  const [filters, setFilters] = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });

  const load = async () => {
    const data = await fetchAll(
      "invoices",
      "*, proposals(call_log(sales_name, customer_name, display_job_number, show_cents))",
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
      const data = await load();
      checkQb();
      if (initialInvoiceId) {
        const inv = (data || []).find(i => i.id === initialInvoiceId);
        if (inv) setSel(inv);
        onClearInitialInvoice && onClearInitialInvoice();
      }
    })();
  }, []);

  const drafted = invoices.filter(i => i.status === "New").reduce((a, i) => a + (i.amount || 0), 0);
  const pending = invoices.filter(i => ["Sent","Waiting for Payment","Past Due"].includes(i.status)).reduce((a, i) => a + (i.amount || 0), 0);
  const paid    = invoices.filter(i => i.status === "Paid").reduce((a, i) => a + (i.amount || 0), 0);

  const aging = (inv) => {
    if (!inv.due_date || inv.status === "Paid") return null;
    return Math.round((new Date() - new Date(inv.due_date)) / 86400000);
  };

  const filteredInvoices = invoices.filter(inv => {
    const sales = inv.proposals?.call_log?.sales_name || "";
    const cust = inv.proposals?.call_log?.customer_name || inv.job_name || "";
    const jobNum = inv.proposals?.call_log?.display_job_number || inv.job_id || "";
    if (filters.sales && sales !== filters.sales) return false;
    if (filters.dateFrom && (inv.sent_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (inv.sent_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.customer && !cust.toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !jobNum.toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(sel ? "detail" : showModal ? "new" : null);
  }, [sel, showModal]);

  if (sel) return <InvoiceDetail invoice={sel} onBack={() => { setSel(null); load(); }} onUpdated={async () => { const data = await load(); const fresh = (data || []).find(i => i.id === sel.id); if (fresh) setSel(fresh); }} onDeleted={() => { setSel(null); load(); }} />;

  return (
    <>
      {showModal && (
        <NewInvoiceModal
          onClose={() => setShowModal(false)}
          onCreated={(inv) => { setShowModal(false); setSel(inv); load(); }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Invoices" action={
          <Btn sz="sm" onClick={() => setShowModal(true)}>+ New Invoice</Btn>
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
          <StatCard label="Total Drafted" value={fmt$c(drafted)} accent={C.teal} />
          <StatCard label="Total Pending" value={fmt$c(pending)} accent={C.amber} />
          <StatCard label="Total Paid"    value={fmt$c(paid)}    accent={C.green} />
        </div>

        <FilterBar
          filters={filters}
          onChange={setFilters}
          salesOptions={[...new Set(invoices.map(i => i.proposals?.call_log?.sales_name).filter(Boolean))].sort()}
        />

        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",       l: "Invoice #", r: v => <span style={{ fontWeight: 600, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{v}</span> },
              { k: "job_id",   l: "Job #",     r: v => <span style={{ fontWeight: 600, color: C.teal, fontFamily: F.display, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{v}</span> },
              { k: "job_name", l: "Job Name",  r: v => <span style={{ fontWeight: 500, color: C.textMuted, fontFamily: F.display, maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span> },
              { k: "status",   l: "Status",    r: v => <Pill label={v} cm={{ ...PROP_C, ...INV_C }} /> },
              { k: "amount",   l: "Amount",    r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$c(v)}</span> },
              { k: "discount", l: "Discount",  r: v => v > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$c(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
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
            rows={filteredInvoices}
            onRow={row => setSel(row)}
          />
        )}
      </div>
    </>
  );
}
