import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmtD } from "../lib/utils";
import { calcLabor, calcMaterialRow, calcTravel, calcWtcPrice, calcWtcBreakdown } from "../lib/calc";
import { PROP_C } from "../lib/mockData";
import { getTenantConfig, DEFAULTS } from "../lib/config";
import WTCCalculator from "./WTCCalculator";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import FilterBar from "../components/FilterBar";

function NewProposalModal({ onClose, onCreated, preselectedJob }) {
  const [jobs, setJobs]       = useState([]);
  const [search, setSearch]   = useState("");
  const [selJob, setSelJob]   = useState(preselectedJob || null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("call_log")
        .select("id, display_job_number, job_name, customer_name, jobsite_address")
        .order("id", { ascending: false });
      setJobs(data || []);
    }
    load();
  }, []);

  const filtered = jobs.filter(j => {
    const name = (j.display_job_number || j.job_name || "").toLowerCase();
    const cust = (j.customer_name || "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || cust.includes(q);
  });

  async function handleCreate() {
    if (!selJob) { setError("Select a job first"); return; }
    setSaving(true);
    setError(null);
    const { data: existing } = await supabase
      .from("proposals")
      .select("id")
      .eq("call_log_id", selJob.id);
    const proposalNumber = (existing?.length || 0) + 1;

    const { data, error: err } = await supabase
      .from("proposals")
      .insert([{
        call_log_id: selJob.id,
        customer: selJob.customer_name || selJob.job_name,
        status: "Draft",
        total: 0,
        proposal_number: proposalNumber,
        signing_token: crypto.randomUUID(),
      }])
      .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))")
      .single();
    setSaving(false);
    if (err) { setError(err.message); return; }
    onCreated(data);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 540, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>New Proposal</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.display, marginBottom: 8 }}>Select a Job</div>

        <input
          placeholder="Search job # or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", marginBottom: 12 }}
        />

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map(j => {
            const sel = selJob?.id === j.id;
            return (
              <button key={j.id} onClick={() => setSelJob(j)} style={{ textAlign: "left", padding: "12px 14px", borderRadius: 9, border: `2px solid ${sel ? C.teal : C.borderStrong}`, background: sel ? C.dark : C.linen, cursor: "pointer", transition: "all 0.1s" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: sel ? C.teal : C.textHead, fontFamily: F.display }}>{j.display_job_number || j.job_name}</div>
                <div style={{ fontSize: 12, color: sel ? "rgba(255,255,255,0.4)" : C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
                  {j.customer_name || "—"}
                  {!j.jobsite_address && <span style={{ marginLeft: 8, color: "#a07800", fontWeight: 700 }}>⚠ No Site Addr</span>}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13, padding: "12px 0" }}>No jobs found</div>
          )}
        </div>

        {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginTop: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: 0 }}>Cancel</button>
          <Btn onClick={handleCreate} disabled={saving || !selJob}>{saving ? "Creating…" : "Create Proposal →"}</Btn>
        </div>

      </div>
    </div>
  );
}





// COMPANY is loaded from tenant_config in components that need it

function ProposalPDFModal({ proposal, onClose, mode = "send" }) {
  const [wtcs, setWtcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("preview");
  const [sendDone, setSendDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [COMPANY, setCOMPANY] = useState({ name: DEFAULTS.company_name, tagline: DEFAULTS.tagline, phone: DEFAULTS.phone, email: DEFAULTS.email, website: DEFAULTS.website, license: DEFAULTS.license_number, logo_url: DEFAULTS.logo_url });
  const [repContact, setRepContact] = useState({ phone: "", email: "" });

  useEffect(() => {
    getTenantConfig().then(cfg => setCOMPANY({ name: cfg.company_name, tagline: cfg.tagline, phone: cfg.phone, email: cfg.email, website: cfg.website, license: cfg.license_number, logo_url: cfg.logo_url }));
    const salesName = proposal.call_log?.sales_name;
    if (salesName) {
      supabase.from("team_members").select("phone, email").eq("name", salesName).maybeSingle().then(({ data }) => {
        if (data) setRepContact({ phone: data.phone || "", email: data.email || "" });
      });
    }
  }, []);
  const signingUrl = `https://www.scmybiz.com/sign/${proposal.signing_token}`;

  async function handleSend() {
    const customerEmail = proposal.call_log?.customers?.contact_email || "";
    if (!customerEmail) {
      setSendError("No customer email on file. Add a contact email to the customer record first.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      // Look up rep email from team_members by sales_name
      const salesName = proposal.call_log?.sales_name || "";
      let repEmail = "";
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("email").eq("name", salesName).maybeSingle();
        repEmail = rep?.email || "";
      }
      const { data: fnData, error: fnError } = await supabase.functions.invoke("send-proposal", {
        body: {
          customerEmail,
          customerName:  proposal.call_log?.customer_name  || "Customer",
          repEmail,
          repName:       salesName,
          proposalNumber: proposal.proposal_number || proposal.id,
          jobName:       proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
          signingUrl,
        },
      });
      if (fnError) throw new Error(fnError.message || "Send failed.");
      if (fnData?.error) throw new Error(fnData.error);
      setSendDone(true);
      if (proposal.call_log_id) {
        await supabase.from("call_log").update({ stage: "Has Bid" }).eq("id", proposal.call_log_id);
      }
      await supabase.from("proposals").update({ status: "Sent", sent_at: new Date().toISOString(), sent_to_email: customerEmail }).eq("id", proposal.id);
    } catch (e) {
      setSendError(e.message || "Send failed. Please try again.");
    }
    setSending(false);
  }

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", proposal.id)
        .order("created_at", { ascending: true });
      setWtcs(data || []);
      setLoading(false);
    }
    load();
  }, [proposal.id]);

  // Aggregate totals across all WTCs
  const totals = wtcs.reduce((acc, wtc) => {
    const labor = calcLabor({
      regular_hours:  wtc.regular_hours  || 0,
      ot_hours:       wtc.ot_hours       || 0,
      markup_pct:     wtc.markup_pct     || 0,
      burden_rate:    wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
    });
    const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
    const trav = calcTravel(wtc.travel);
    const disc = wtc.discount || 0;
    return {
      labor:     acc.labor    + labor.total,
      materials: acc.materials + mats,
      travel:    acc.travel   + trav,
      discount:  acc.discount + disc,
    };
  }, { labor: 0, materials: 0, travel: 0, discount: 0 });

  const proposalPrice = totals.labor + totals.materials + totals.travel - totals.discount;

  // Combine all Sales SOWs
  const combinedSOW = wtcs
    .map((wtc, i) => {
      const header = wtcs.length > 1 ? `── Work Type ${i + 1} ──\n` : "";
      return header + (wtc.sales_sow || "").trim();
    })
    .filter(s => s.replace(/── Work Type \d+ ──\n/, "").trim())
    .join("\n\n");

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,20,35,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.linenCard, borderRadius: 16, padding: 40, fontSize: 14, color: C.textFaint }}>Loading WTC data…</div>
      </div>
    );
  }

  return (
    <div
      data-pdf-overlay data-pdf-printable
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @media print {
          html, body, #root {
            height: auto !important;
            overflow: visible !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body > #root { display: contents !important; }
          [data-pdf-overlay] {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            background: white !important;
            backdrop-filter: none !important;
            display: block !important;
            overflow: visible !important;
          }
          [data-pdf-modal-inner] {
            position: static !important;
            max-height: none !important;
            height: auto !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            width: 100% !important;
            border: none !important;
            display: block !important;
            overflow: visible !important;
          }
          [data-pdf-header] { display: none !important; }
          [data-regression-tracker] { display: none !important; }
          [data-pdf-body] {
            padding: 20px !important;
            height: auto !important;
            flex: none !important;
            overflow: visible !important;
          }
          @page { margin: 0.6in; size: letter; }
        }
      `}</style>
      <div data-pdf-modal-inner data-pdf-printable style={{ background: "white", borderRadius: 16, width: "min(860px,95vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Modal header */}
        <div data-pdf-header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #E5E7EB", background: "#FAFAFA", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1976D2", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "white", fontSize: 16 }}>📄</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>Proposal Preview</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{wtcs.length} Work Type{wtcs.length !== 1 ? "s" : ""} · {fmt$(proposalPrice)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "preview" && !sendDone && (
              <>
                <button onClick={() => window.print()} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>🖨 Print</button>
                {mode === "send" && proposal.status !== "Sold" && wtcs.length > 0 && wtcs.every(w => w.locked) && <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>📨 Send to Customer →</button>}
                {mode === "send" && proposal.status !== "Sold" && (wtcs.length === 0 || !wtcs.every(w => w.locked)) && <span style={{ fontSize: 11, fontWeight: 700, color: "#e53935", fontFamily: "inherit", padding: "7px 12px" }}>Lock all WTCs to send</span>}
              </>
            )}
            {view === "send" && !sendDone && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>← Back to Preview</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9CA3AF", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Modal body */}
        <div data-pdf-body style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

          {view === "preview" && (
            <div style={{ fontFamily: "Arial, sans-serif", color: "#1c1814", background: "white" }}>

              {/* Header */}
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

              {/* Prepared For + Proposal # */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Prepared For</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{proposal.customer || "—"}</div>
                  {proposal.call_log?.customers?.business_address && (
                    <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", marginTop: 2, lineHeight: 1.7 }}>
                      {proposal.call_log.customers.business_address}
                      {proposal.call_log.customers.business_city ? ", " + proposal.call_log.customers.business_city : ""}
                      {proposal.call_log.customers.business_state ? ", " + proposal.call_log.customers.business_state : ""}
                      {proposal.call_log.customers.business_zip ? " " + proposal.call_log.customers.business_zip : ""}
                    </div>
                  )}
                  {proposal.call_log?.jobsite_address && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Jobsite Address</div>
                      <div style={{ fontSize: 11, fontWeight: 400, color: "#887c6e", lineHeight: 1.7 }}>
                        {proposal.call_log.jobsite_address}
                        {proposal.call_log.jobsite_city ? ", " + proposal.call_log.jobsite_city : ""}
                        {proposal.call_log.jobsite_state ? ", " + proposal.call_log.jobsite_state : ""}
                        {proposal.call_log.jobsite_zip ? " " + proposal.call_log.jobsite_zip : ""}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Proposal #</div>
                  <div style={{ fontSize: 12, color: "#887c6e" }}><span style={{ fontWeight: 800, color: "#1c1814" }}>{(proposal.call_log?.display_job_number || "—").split(" - ")[0]}</span>{(() => { const djn = proposal.call_log?.display_job_number || ""; const idx = djn.indexOf(" - "); return idx > -1 ? " - " + djn.slice(idx + 3) : ""; })()}-P{proposal.proposal_number || 1}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#1c1814", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Date</div>
                  <div style={{ fontSize: 12, fontWeight: 400, color: "#887c6e" }}>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
                </div>
              </div>

              {/* Scope of Work */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Scope of Work</div>
                {wtcs.filter(w => (w.sales_sow || "").trim()).length === 0 ? (
                  <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                    <div style={{ fontSize: 13, color: "#887c6e", fontStyle: "italic" }}>No scope of work written yet. Add it in the WTC tab.</div>
                  </div>
                ) : (
                  wtcs.filter(w => (w.sales_sow || "").trim()).map((wtc, i, arr) => {
                    const wtcLabor = calcLabor({
                      regular_hours: wtc.regular_hours || 0, ot_hours: wtc.ot_hours || 0,
                      markup_pct: wtc.markup_pct || 0,
                      burden_rate: wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
                      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
                    });
                    const wtcMats = (wtc.materials || []).reduce((s, item) => s + calcMaterialRow(item), 0);
                    const wtcTrav = calcTravel(wtc.travel);
                    const wtcTotal = wtcLabor.total + wtcMats + wtcTrav - (wtc.discount || 0);
                    return (
                      <div key={wtc.id} style={{ marginBottom: i < arr.length - 1 ? 24 : 0 }}>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, marginTop: i > 0 ? 8 : 0 }}>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#1c1814", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Work Type {i + 1}{wtc.work_types?.name ? ` — ${wtc.work_types.name}` : ""}</div>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                          </div>
                        )}
                        <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                          <pre style={{ margin: 0, fontSize: 13, color: "#2d2720", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "Arial, sans-serif" }}>{(wtc.sales_sow || "").trim()}</pre>
                        </div>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, padding: "8px 18px", background: "rgba(48,207,172,0.08)", borderRadius: 6, border: "1px solid rgba(48,207,172,0.25)" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#4a4238", letterSpacing: "0.06em", textTransform: "uppercase" }}>Work Type {i + 1}{wtc.work_types?.name ? ` — ${wtc.work_types.name}` : ""} Total</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: "#1c1814" }}>{fmt$(wtcTotal)}</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Proposal Total */}
              <div style={{ border: "2px solid #30cfac", borderRadius: 8, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#4a4238", letterSpacing: "0.08em", textTransform: "uppercase" }}>Proposal Total</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#1c1814", letterSpacing: "-0.01em" }}>{fmt$(proposalPrice)}</div>
              </div>

              {/* Signature / Approval block */}
              {proposal.internal_approval ? (
                <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Internal Approval</div>
                  <div style={{ border: "1.5px solid rgba(48,207,172,0.3)", borderRadius: 8, padding: "16px 20px", background: "rgba(48,207,172,0.04)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Approved By</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_by || "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Date</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_at ? new Date(proposal.approved_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—"}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Time</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1814" }}>{proposal.approved_at ? new Date(proposal.approved_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}</div>
                      </div>
                    </div>
                    {proposal.approval_reason && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Reason</div>
                        <div style={{ fontSize: 13, color: "#2d2720" }}>{proposal.approval_reason}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ borderTop: "1.5px solid rgba(28,24,20,0.15)", paddingTop: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>Customer Acceptance</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 32, marginBottom: 16 }}>
                    <div>
                      <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32 }} />
                      <div style={{ fontSize: 11, color: "#887c6e" }}>Authorized Signature</div>
                    </div>
                    <div>
                      <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32 }} />
                      <div style={{ fontSize: 11, color: "#887c6e" }}>Date</div>
                    </div>
                  </div>
                  <div style={{ borderBottom: "1.5px solid #2d2720", marginBottom: 6, height: 32, width: "60%" }} />
                  <div style={{ fontSize: 11, color: "#887c6e", marginBottom: 20 }}>Printed Name</div>
                  <div style={{ fontSize: 11, color: "#887c6e", fontStyle: "italic", textAlign: "center" }}>
                    *This proposal is valid for 90 days from the date above.*
                  </div>
                </div>
              )}

            </div>
          )}

          {view === "send" && !sendDone && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>This will email the customer a link to review and sign electronically.</div>
              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12, color: "#6B7280" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Sending to</div>
                <div style={{ fontWeight: 600, color: "#111827" }}>{proposal.call_log?.customers?.contact_email || <span style={{ color: "#e53935" }}>No customer email on file</span>}</div>
              </div>
              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#6B7280", wordBreak: "break-all" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Signing Link</div>
                {signingUrl}
              </div>
              {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12, background: "rgba(229,57,53,0.06)", border: "1px solid rgba(229,57,53,0.2)", borderRadius: 8, padding: "10px 14px" }}>{sendError}</div>}
              <button onClick={handleSend} disabled={sending} style={{ width: "100%", background: sending ? "#ccc" : "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: sending ? "default" : "pointer", fontFamily: "inherit" }}>
                {sending ? "Sending…" : "Send to Customer"}
              </button>
            </div>
          )}

          {sendDone && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 8 }}>Proposal Sent</div>
              <div style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>The customer will receive an email with a link to review and sign.</div>
              <button onClick={onClose} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>Close</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}





function ProposalDetail({ p: pInit, onBack, onDeleted, teamMember }) {
  const [p, setP] = useState(pInit);
  const [showWTC, setShowWTC] = useState(false);
const [activeWtcId, setActiveWtcId] = useState(null);
const [showPDF, setShowPDF] = useState(false);
const [pdfMode, setPdfMode] = useState("preview");
const [signatureInfo, setSignatureInfo] = useState(null);
const [wtcInitialTab, setWtcInitialTab] = useState(null);
const missingJobsite = !p.call_log?.jobsite_address;

const [wtcs, setWtcs] = useState([]);
const [signedPdfUrl, setSignedPdfUrl] = useState(null);
const [attachments, setAttachments] = useState([]);
const [proposalAttachments, setProposalAttachments] = useState([]);
const [uploadingPropAttach, setUploadingPropAttach] = useState(false);
const [expandedWtc, setExpandedWtc] = useState("auto");
const [showApproveModal, setShowApproveModal] = useState(false);
const [approveBy, setApproveBy] = useState(teamMember?.name || "");
const [approveReason, setApproveReason] = useState("");
const [allTeamMembers, setAllTeamMembers] = useState([]);

useEffect(() => {
  supabase.from("team_members").select("id, name").eq("active", true).order("name").then(({ data }) => setAllTeamMembers(data || []));
}, []);

// Auto-refresh when proposal is Sent (waiting for customer signature)
useEffect(() => {
  if (p.status !== "Sent") return;
  const interval = setInterval(async () => {
    const { data } = await supabase
      .from("proposals")
      .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))")
      .eq("id", p.id)
      .single();
    if (data && data.status !== p.status) setP(data);
  }, 10000);
  return () => clearInterval(interval);
}, [p.status, p.id]);

useEffect(() => {
  async function loadWtcs() {
    const { data } = await supabase
      .from("proposal_wtc")
      .select("*, work_types(name)")
      .eq("proposal_id", p.id)
      .order("created_at", { ascending: true });
    setWtcs(data || []);
  }
  loadWtcs();
}, [p.id]);


useEffect(() => {
  async function loadSignatureData() {
    const { data } = await supabase
      .from("proposal_signatures")
      .select("signer_name, signer_email, signed_at, pdf_url")
      .eq("proposal_id", p.id)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.pdf_url) setSignedPdfUrl(data.pdf_url);
    if (data) setSignatureInfo(data);
  }
  loadSignatureData();
}, [p.id, p.status]);

useEffect(() => {
  if (!p.call_log_id) return;
  async function loadAttachments() {
    const { data, error } = await supabase.storage
      .from("job-attachments")
      .list(String(p.call_log_id));
    if (error || !data) return;
    setAttachments(
      data.map(file => {
        const { data: urlData } = supabase.storage
          .from("job-attachments")
          .getPublicUrl(`${p.call_log_id}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, url: urlData.publicUrl };
      })
    );
  }
  loadAttachments();
}, [p.call_log_id]);

// Proposal attachments (files sent with the proposal to the customer)
useEffect(() => {
  async function loadPropAttachments() {
    const prefix = `proposal-${p.id}`;
    const { data, error } = await supabase.storage.from("job-attachments").list(prefix);
    if (error || !data) return;
    setProposalAttachments(
      data.filter(f => f.name !== ".emptyFolderPlaceholder").map(file => {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(`${prefix}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, fullName: file.name, url: urlData.publicUrl };
      })
    );
  }
  loadPropAttachments();
}, [p.id]);

async function handlePropAttachUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  setUploadingPropAttach(true);
  const prefix = `proposal-${p.id}`;
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageName = `${Date.now()}-${safeName}`;
    await supabase.storage.from("job-attachments").upload(`${prefix}/${storageName}`, file, { upsert: false });
  }
  // Reload
  const { data } = await supabase.storage.from("job-attachments").list(prefix);
  if (data) {
    setProposalAttachments(
      data.filter(f => f.name !== ".emptyFolderPlaceholder").map(file => {
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(`${prefix}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, fullName: file.name, url: urlData.publicUrl };
      })
    );
  }
  setUploadingPropAttach(false);
  e.target.value = "";
}

async function deletePropAttachment(fullName) {
  if (!window.confirm("Remove this attachment from the proposal?")) return;
  const prefix = `proposal-${p.id}`;
  await supabase.storage.from("job-attachments").remove([`${prefix}/${fullName}`]);
  setProposalAttachments(prev => prev.filter(a => a.fullName !== fullName));
}

  async function setJobWalkType(wtcId, currentVal, type) {
    const newVal = currentVal === type ? null : type;
    await supabase.from("proposal_wtc").update({ job_walk_type: newVal }).eq("id", wtcId);
    setWtcs(prev => prev.map(w => w.id === wtcId ? { ...w, job_walk_type: newVal } : w));
  }

  async function deleteWtc(wtcId) {
    if (!window.confirm("Delete this WTC? This cannot be undone.")) return;
    await supabase.from("proposal_wtc").delete().eq("id", wtcId);
    const { data: still } = await supabase.from("proposal_wtc").select("id").eq("id", wtcId).maybeSingle();
    if (still) { alert("Delete failed — you may not have permission."); return; }
    setWtcs(prev => prev.filter(w => w.id !== wtcId));
  }

  async function toggleWtcLock(wtcId) {
    const wtc = wtcs.find(w => w.id === wtcId);
    if (!wtc) return;
    const newLocked = !wtc.locked;
    // If locking, confirm the WTC checklist is complete enough
    if (newLocked) {
      const checks = getWtcChecks(wtc);
      const preChecks = checks.slice(0, 5); // work type, rates, labor, materials, size
      const incomplete = preChecks.filter(c => !c.done);
      if (incomplete.length > 0) {
        alert(`Cannot lock — incomplete: ${incomplete.map(c => c.l).join(", ")}`);
        return;
      }
    }
    await supabase.from("proposal_wtc").update({ locked: newLocked }).eq("id", wtcId);
    setWtcs(prev => prev.map(w => w.id === wtcId ? { ...w, locked: newLocked } : w));
    // Sync proposals.total
    const { data: allWtcs } = await supabase.from("proposal_wtc").select("*").eq("proposal_id", p.id);
    const proposalTotal = (allWtcs || []).reduce((sum, w) => sum + calcWtcPrice(w), 0);
    await supabase.from("proposals").update({ total: proposalTotal }).eq("id", p.id);
  }

  function openWtcTab(wtcId, tab) {
    setActiveWtcId(wtcId);
    setWtcInitialTab(tab);
    setShowWTC(true);
  }

  function getWtcChecks(wtc) {
    const travelData = wtc.travel || {};
    const hasTravelEntries = Object.values(travelData).some(v => typeof v === "number" && v > 0);
    const allWtcsLocked = wtcs.length > 0 && wtcs.every(w => w.locked);
    return [
      { l: "Work type selected",       done: !!wtc.work_type_id,                                    tab: "bidding" },
      { l: "Rates & dates set",        done: !!(wtc.start_date && wtc.end_date),                    tab: "bidding" },
      { l: "Labor entered",            done: (wtc.regular_hours || 0) > 0,                          tab: "labor" },
      { l: "Materials or SOW",         done: (Array.isArray(wtc.materials) && wtc.materials.length > 0) || !!(wtc.sales_sow), tab: "materials" },
      { l: "Size / unit filled in",    done: !!(wtc.size && wtc.unit),                              tab: "sow" },
      { l: "Locked",                   done: !!wtc.locked,                                           tab: "summary" },
      { l: "Proposal built",           done: allWtcsLocked },
      { l: "Proposal sent",            done: ["Sent", "Sold"].includes(p.status) },
      { l: "Proposal approved",        done: p.status === "Sold" },
    ];
  }

  const canDelete = teamMember && (["Admin","Manager"].includes(teamMember.role) || teamMember.name === p.call_log?.sales_name);
  async function handleDelete() {
    // Check for linked invoices first
    const { data: invoices } = await supabase.from("invoices").select("id").eq("proposal_id", p.id);
    if (invoices && invoices.length > 0) {
      alert(`This proposal has ${invoices.length} invoice${invoices.length > 1 ? "s" : ""} linked to it. Please delete the invoice${invoices.length > 1 ? "s" : ""} first.`);
      return;
    }
    if (!window.confirm("Delete this proposal? This cannot be undone.")) return;
    await supabase.from("proposal_signatures").delete().eq("proposal_id", p.id);
    await supabase.from("proposal_wtc").delete().eq("proposal_id", p.id);
    await supabase.from("proposals").delete().eq("id", p.id);
    // Verify it was actually deleted (RLS may silently block)
    const { data: still } = await supabase.from("proposals").select("id").eq("id", p.id).maybeSingle();
    if (still) { alert("Delete failed — you may not have permission to delete this proposal."); return; }
    onDeleted && onDeleted();
  }

  async function handlePullBack() {
    const { data: invoices } = await supabase.from("invoices").select("id").eq("proposal_id", p.id);
    if (invoices && invoices.length > 0) {
      alert(`This proposal has ${invoices.length} invoice${invoices.length > 1 ? "s" : ""} linked to it. Delete the invoice${invoices.length > 1 ? "s" : ""} before pulling back.`);
      return;
    }
    if (!window.confirm("Pull back this proposal? It will return to Draft status and WTCs will be unlocked for editing.")) return;
    // Clear old signatures
    await supabase.from("proposal_signatures").delete().eq("proposal_id", p.id);
    // Unlock all WTCs
    await supabase.from("proposal_wtc").update({ locked: false }).eq("proposal_id", p.id);
    // Reset proposal
    await supabase.from("proposals").update({
      status: "Draft", approved_at: null, sent_at: null, sent_to_email: null,
      internal_approval: false, approved_by: null, approval_reason: null,
    }).eq("id", p.id);
    // Reset call log stage
    if (p.call_log_id) {
      await supabase.from("call_log").update({ stage: "Wants Bid" }).eq("id", p.call_log_id);
    }
    // Refresh
    const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single();
    if (data) setP(data);
    const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id).order("created_at", { ascending: true });
    setWtcs(wtcData || []);
    setSignedPdfUrl(null);
  }

  async function handleInternalApprove() {
    if (!approveBy.trim()) { alert("Approved By is required."); return; }
    if (!approveReason.trim()) { alert("Reason is required."); return; }
    await supabase.from("proposals").update({
      status: "Sold",
      approved_at: new Date().toISOString(),
      internal_approval: true,
      approved_by: approveBy.trim(),
      approval_reason: approveReason.trim(),
    }).eq("id", p.id);
    if (p.call_log_id) {
      await supabase.from("call_log").update({ stage: "Sold" }).eq("id", p.call_log_id);
      // Sync job to QuickBooks
      supabase.functions.invoke("qb-create-job", { body: { callLogId: p.call_log_id } })
        .then(r => { if (r.data?.error) console.warn("QB sync:", r.data.error); else console.log("QB job created:", r.data); })
        .catch(e => console.warn("QB sync failed:", e.message));
    }
    // Refresh
    const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single();
    if (data) setP(data);
    setShowApproveModal(false);
    setApproveReason("");
  }

if (showWTC) return <WTCCalculator proposalId={p.id} wtcId={activeWtcId} initialTab={wtcInitialTab} onBackToList={onBack} onClose={async (openPDF = false) => { const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single(); if (data) setP(data); setShowWTC(false); setActiveWtcId(null); setWtcInitialTab(null); const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id).order("created_at", { ascending: true }); setWtcs(wtcData || []); if (openPDF) { setPdfMode("send"); setShowPDF(true); } }} />;  if (showPDF) return <ProposalPDFModal key={p.id + '-pdf'} proposal={p} mode={pdfMode} onClose={async () => { setShowPDF(false); const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))").eq("id", p.id).single(); if (data) setP(data); }} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {missingJobsite && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "rgba(230,168,0,0.1)", border: "1.5px solid rgba(230,168,0,0.35)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7a5800", fontFamily: F.ui }}>Job site address required before this proposal can be built</div>
              <div style={{ fontSize: 12, color: "#a07800", fontFamily: F.ui, marginTop: 2 }}>Add the job site address to the linked call log record to continue.</div>
            </div>
          </div>
          <Btn sz="sm" v="secondary" onClick={onBack}>← Edit Job</Btn>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12.5, padding: 0, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ← Back
        </button>
        <div style={{ width: 1, height: 18, background: C.border }} />
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Proposal {p.call_log?.display_job_number || p.id} P{p.proposal_number || 1}

        </h2>
        <Pill label={p.status} cm={PROP_C} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canDelete && (
            <Btn sz="sm" v="ghost" onClick={handleDelete} style={{ color: C.red, borderColor: C.red }}>🗑 Delete</Btn>
          )}
          {(p.status === "Sent" || p.status === "Sold") && (
            <Btn sz="sm" v="ghost" onClick={handlePullBack} style={{ color: C.amber, borderColor: C.amber }}>↩ Pull Back</Btn>
          )}
          {p.status !== "Sold" && p.status !== "Sent" && (
            <Btn sz="sm" v="ghost" onClick={() => setShowApproveModal(true)} style={{ color: C.green, borderColor: C.green }}>✓ Internal Approve</Btn>
          )}
          <Btn sz="sm" v="ghost" onClick={() => { setPdfMode("preview"); setShowPDF(true); }}>Generate PDF</Btn>
          {p.status !== "Sold" && p.status !== "Sent" && wtcs.length > 0 && wtcs.every(w => w.locked) && <Btn sz="sm" onClick={() => { setPdfMode("send"); setShowPDF(true); }}>Send Proposal</Btn>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Work Type Calculators</div>
            {wtcs.length === 0 && (
              <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "10px 0" }}>No work types yet.</div>
            )}
            {wtcs.map((wtc, wtcIdx) => {
              const checks = getWtcChecks(wtc);
              const pct = Math.round((checks.filter(c => c.done).length / checks.length) * 100);
              const price = calcWtcPrice(wtc);
              const wtcLabel = `WTC ${wtcIdx + 1}`;
              const typeName = wtc.work_types?.name;
              const isExpanded = expandedWtc === wtc.id || (expandedWtc === "auto" && wtcs.length === 1);
              return (
                <div key={wtc.id} style={{ background: C.linen, border: `1px solid ${wtc.locked ? C.border : (C.amber || "#e6a800")}`, borderLeft: wtc.locked ? `1px solid ${C.border}` : `4px solid ${C.amber || "#e6a800"}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>
                        {wtcLabel}{typeName ? ` — ${typeName}` : ""}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui, marginTop: 4 }}>{fmt$(price)}</div>
                      {wtc.start_date && wtc.end_date && (
                        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: F.ui }}>
                          <span style={{ color: C.textFaint }}>Start</span> {fmtD(wtc.start_date)} — <span style={{ color: C.textFaint }}>End</span> {fmtD(wtc.end_date)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, fontFamily: F.ui }}>Created {fmtD(wtc.created_at?.slice(0,10))}</div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, position: "relative" }}>
                      <div style={{ fontSize: 11, color: wtc.locked ? C.green : C.amber, fontWeight: 700, fontFamily: F.ui }}>{wtc.locked ? "🔒 Locked" : "⏳ In Progress"}</div>
                      <button onClick={() => setExpandedWtc(expandedWtc === `progress-${wtc.id}` ? null : `progress-${wtc.id}`)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: pct === 100 ? C.green : C.teal, fontFamily: "Barlow Condensed, sans-serif", background: C.dark, borderRadius: 6, padding: "3px 10px", letterSpacing: "0.08em" }}>{pct}%</span>
                      </button>
                      {expandedWtc === `progress-${wtc.id}` && (
                        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: C.dark, borderRadius: 10, padding: "14px 18px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 100, width: 220, textAlign: "left" }}>
                          <div style={{ fontSize: 11, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>WTC Progress</div>
                          {checks.map((c, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, fontFamily: F.ui, color: c.done ? C.teal : "rgba(255,255,255,0.4)" }}>
                              <span style={{ fontSize: 13 }}>{c.done ? "✓" : "○"}</span>
                              <span style={{ fontWeight: c.done ? 600 : 400 }}>{c.l}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <Btn sz="sm" v="secondary" onClick={() => { setActiveWtcId(wtc.id); setShowWTC(true); }}>Edit WTC</Btn>
                    <button onClick={() => setExpandedWtc(isExpanded ? null : wtc.id)} style={{
                      background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 12px",
                      fontSize: 11, fontWeight: 700, color: C.textFaint, cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{isExpanded ? "Hide Checklist" : "Checklist"}</button>
                    <button onClick={() => toggleWtcLock(wtc.id)} style={{
                      background: wtc.locked ? C.green : "none", border: `1px solid ${wtc.locked ? C.green : (C.amber || "#e6a800")}`, borderRadius: 6, padding: "4px 12px",
                      fontSize: 11, fontWeight: 700, color: wtc.locked ? C.dark : (C.amber || "#e6a800"), cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{wtc.locked ? "Locked" : "Lock"}</button>
                    <button onClick={() => deleteWtc(wtc.id)} style={{
                      background: "none", border: `1px solid ${C.red || "#e53935"}`, borderRadius: 6, padding: "4px 10px",
                      fontSize: 11, fontWeight: 700, color: C.red || "#e53935", cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase", marginLeft: "auto",
                    }}>Delete</button>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                      <div style={{ height: 4, background: C.border, borderRadius: 4, marginBottom: 12 }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.teal, borderRadius: 4, transition: "width 0.3s" }} />
                      </div>
                      {checks.map((c, i) => (
                        <div key={i} style={{ padding: "6px 0", borderBottom: i < checks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                          <div
                            onClick={() => c.tab && openWtcTab(wtc.id, c.tab)}
                            style={{ display: "flex", alignItems: "center", gap: 10, cursor: c.tab ? "pointer" : "default" }}
                          >
                            <div
                              onClick={c.custom && c.done ? (e) => { e.stopPropagation(); setJobWalkType(wtc.id, wtc.job_walk_type, wtc.job_walk_type); } : undefined}
                              style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: c.done ? C.teal : C.linen, border: `1.5px solid ${c.done ? C.teal : C.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: c.custom && c.done ? "pointer" : undefined }}
                            >
                              {c.done && <span style={{ fontSize: 10, color: C.dark, fontWeight: 900 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 12.5, color: c.done ? C.textBody : C.textFaint, fontWeight: c.done ? 600 : 400, fontFamily: F.ui, flex: 1 }}>{c.l}</span>
                            {c.tab && <span style={{ fontSize: 11, color: C.textFaint }}>›</span>}
                          </div>
                          {c.custom && (
                            <div style={{ display: "flex", gap: 6, marginTop: 6, marginLeft: 28 }}>
                              {[["job_walk", "Job Walk"], ["bid_off_plans", "Bid Off Plans"]].map(([val, label]) => {
                                const on = wtc.job_walk_type === val;
                                return (
                                  <button key={val} onClick={() => setJobWalkType(wtc.id, wtc.job_walk_type, val)} style={{
                                    padding: "4px 12px", borderRadius: 20, fontSize: 10.5, fontWeight: 700,
                                    fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
                                    cursor: "pointer", border: `1.5px solid ${on ? C.teal : C.borderStrong}`,
                                    background: on ? C.dark : "transparent", color: on ? C.teal : C.textFaint,
                                    transition: "all 0.12s",
                                  }}>{label}</button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <Btn sz="sm" v="ghost" onClick={() => { setActiveWtcId(null); setShowWTC(true); }}>+ Add Work Type</Btn>
          </div>

        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {attachments.length > 0 && (
            <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Reference Files</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {attachments.map(att => (
                  <a
                    key={att.url}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: C.dark, color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", padding: "6px 14px", borderRadius: 6, textDecoration: "none", display: "inline-block" }}
                  >
                    {att.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Proposal Attachments — files sent with the proposal to customer */}
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Proposal Attachments</div>
              <label style={{ background: C.dark, color: C.teal, fontWeight: 700, fontSize: 11, fontFamily: F.display, letterSpacing: "0.06em", padding: "5px 12px", borderRadius: 6, cursor: "pointer", textTransform: "uppercase" }}>
                {uploadingPropAttach ? "Uploading…" : "+ Add"}
                <input type="file" multiple onChange={handlePropAttachUpload} style={{ display: "none" }} disabled={uploadingPropAttach} />
              </label>
            </div>
            {proposalAttachments.length === 0 && (
              <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>No attachments yet. Add files to include with this proposal.</div>
            )}
            {proposalAttachments.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {proposalAttachments.map(att => (
                  <div key={att.fullName} style={{ display: "flex", alignItems: "center", gap: 6, background: C.dark, borderRadius: 6, padding: "4px 6px 4px 14px" }}>
                    <a href={att.url} target="_blank" rel="noopener noreferrer" style={{ color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textDecoration: "none" }}>
                      {att.name}
                    </a>
                    <button onClick={() => deletePropAttachment(att.fullName)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1 }} title="Remove">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Summary</div>
            {[["Customer", p.customer]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
            {wtcs.length > 0 && (() => {
              const breakdowns = wtcs.map(w => ({ ...calcWtcBreakdown(w), name: w.work_types?.name || "Unnamed" }));
              const totals = breakdowns.reduce((a, b) => ({ price: a.price + b.price, cost: a.cost + b.cost, profit: a.profit + b.profit }), { price: 0, cost: 0, profit: 0 });
              totals.margin = totals.price > 0 ? (totals.profit / totals.price) * 100 : 0;
              const hdr = { fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" };
              const cell = { fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui, textAlign: "center" };
              const lbl = { fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui };
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                    <span style={hdr} />
                    <span style={hdr}>Price</span>
                    <span style={hdr}>Cost</span>
                    <span style={hdr}>Margin</span>
                    <span style={hdr}>Profit</span>
                  </div>
                  {breakdowns.map((b, i) => (
                    <div key={`wtc-s-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                      <span style={lbl}>WTC {i + 1} — {b.name}</span>
                      <span style={cell}>{fmt$(b.price)}</span>
                      <span style={cell}>{fmt$(b.cost)}</span>
                      <span style={{ ...cell, color: b.margin >= 30 ? C.green : b.margin >= 15 ? C.amber : C.red }}>{b.margin.toFixed(1)}%</span>
                      <span style={{ ...cell, color: b.profit >= 0 ? C.green : C.red }}>{fmt$(b.profit)}</span>
                    </div>
                  ))}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 72px 62px 72px", gap: "0 10px", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                    <span style={{ ...lbl, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Total</span>
                    <span style={{ ...cell, fontWeight: 800 }}>{fmt$(totals.price)}</span>
                    <span style={{ ...cell, fontWeight: 800 }}>{fmt$(totals.cost)}</span>
                    <span style={{ ...cell, fontWeight: 800, color: totals.margin >= 30 ? C.green : totals.margin >= 15 ? C.amber : C.red }}>{totals.margin.toFixed(1)}%</span>
                    <span style={{ ...cell, fontWeight: 800, color: totals.profit >= 0 ? C.green : C.red }}>{fmt$(totals.profit)}</span>
                  </div>
                </>
              );
            })()}
            {[["Created", fmtD(p.created_at?.slice(0,10))], ["Status", p.status]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
            {/* Activity Timeline */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${C.darkBorder}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: F.display, marginBottom: 10 }}>Activity</div>
              {[
                { label: "Created", date: p.created_at ? fmtD(p.created_at.slice(0, 10)) : null, done: true },
                p.sent_at
                  ? { label: "Sent", date: fmtD(p.sent_at.slice(0, 10)), detail: p.call_log?.customer_name || p.customer, done: true }
                  : p.approved_at
                    ? { label: "Internally Approved", date: fmtD(p.approved_at.slice(0, 10)), detail: p.approved_by, done: true }
                    : { label: "Sent / Approved", done: false },
                signatureInfo?.signed_at
                  ? { label: "Signed", date: fmtD(signatureInfo.signed_at.slice(0, 10)), detail: signatureInfo.signer_name || p.customer, done: true }
                  : p.sent_at
                    ? { label: "Awaiting Signature", detail: `${Math.max(0, Math.round((new Date() - new Date(p.sent_at)) / 86400000))}d`, done: false, warn: true }
                    : { label: "Signed", done: false },
              ].map((item, i, arr) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.done ? C.teal : item.warn ? C.amber : "rgba(255,255,255,0.2)", flexShrink: 0, marginTop: 2 }} />
                    {i < arr.length - 1 && <div style={{ width: 1.5, flex: 1, background: "rgba(255,255,255,0.1)", minHeight: 16 }} />}
                  </div>
                  <div style={{ paddingBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: item.done ? "#fff" : item.warn ? C.amber : "rgba(255,255,255,0.35)", fontFamily: F.ui }}>{item.label}</div>
                    {item.date && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{item.date}</div>}
                    {item.detail && <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.3)", fontFamily: F.ui }}>{item.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
            {p.status === "Sold" && (
              <div style={{ marginTop: 14 }}>
                {signedPdfUrl && !p.internal_approval ? (
                  <a href={signedPdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", background: C.teal, color: C.dark, borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
                    ⬇ Download Signed PDF
                  </a>
                ) : p.internal_approval ? (
                  <button onClick={() => setShowPDF(true)} style={{ display: "block", width: "100%", textAlign: "center", background: C.teal, color: C.dark, borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", border: "none", cursor: "pointer" }}>
                    ⬇ Download Approved PDF
                  </button>
                ) : null}
              </div>
            )}
            {p.internal_approval && (
              <div style={{ marginTop: 14, background: "rgba(48,207,172,0.08)", border: `1px solid ${C.tealBorder}`, borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.teal, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Internally Approved</div>
                <div style={{ fontSize: 12, color: "#fff", fontFamily: F.ui }}>{p.approved_by}</div>
                {p.approval_reason && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: F.ui, marginTop: 2 }}>{p.approval_reason}</div>}
                {p.approved_at && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: F.ui, marginTop: 4 }}>{new Date(p.approved_at).toLocaleString()}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Internal Approve Modal */}
      {showApproveModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget) setShowApproveModal(false); }}>
          <div style={{ background: C.linenCard, borderRadius: 16, width: "min(440px,90vw)", padding: "28px 32px", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 4 }}>Internal Approval</div>
            <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginBottom: 20 }}>Mark this proposal as Sold without customer signature.</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.display }}>Approved By</div>
              <select value={approveBy} onChange={e => setApproveBy(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", WebkitAppearance: "none" }}>
                <option value="">— Select —</option>
                {allTeamMembers.map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6, fontFamily: F.display }}>Reason</div>
              <textarea value={approveReason} onChange={e => setApproveReason(e.target.value)}
                placeholder="e.g. GC doesn't sign sub proposals, verbal approval from PM..."
                rows={3}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, fontSize: 14, color: C.textBody, fontFamily: F.ui, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Btn sz="sm" v="ghost" onClick={() => setShowApproveModal(false)}>Cancel</Btn>
              <Btn sz="sm" onClick={handleInternalApprove}>Approve as Sold</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Proposals({ teamMember, initialProposal, onClearInitial, setSubPage, onNavigateInvoice }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sel, setSel]             = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [preselectedJob, setPreselectedJob] = useState(null);
  const [statusFilter, setStatusFilter]     = useState("All");
  const [workTypes, setWorkTypes]           = useState([]);
  const [filters, setFilters]               = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });

  useEffect(() => {
    if (initialProposal?.job) {
      setPreselectedJob(initialProposal.job);
      setShowModal(true);
      onClearInitial && onClearInitial();
    } else if (initialProposal?.openId) {
      (async () => {
        const { data } = await supabase
          .from("proposals")
          .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip))")
          .eq("id", initialProposal.openId)
          .maybeSingle();
        if (data) setSel(data);
      })();
      onClearInitial && onClearInitial();
    }
  }, [initialProposal]);

  const load = async () => {
    const [{ data }, { data: invData }, { data: wtData }] = await Promise.all([
      supabase
        .from("proposals")
        .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email, business_address, business_city, business_state, business_zip)), proposal_wtc(start_date, end_date, work_type_id)")
        .order("created_at", { ascending: false }),
      supabase.from("invoices").select("id, status, proposal_id"),
      supabase.from("work_types").select("*").order("name"),
    ]);
    setWorkTypes(wtData || []);
    const invByProposal = {};
    (invData || []).forEach(inv => {
      if (inv.proposal_id) {
        if (!invByProposal[inv.proposal_id]) invByProposal[inv.proposal_id] = [];
        invByProposal[inv.proposal_id].push(inv);
      }
    });
    setProposals((data || []).map(p => ({ ...p, invoices: invByProposal[p.id] || [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const STATUS_TABS = ["All", "Draft", "Sent", "Sold", "Lost"];
  const filteredProposals = proposals.filter(p => {
    if (statusFilter !== "All" && p.status !== statusFilter) return false;
    if (filters.sales && p.call_log?.sales_name !== filters.sales) return false;
    if (filters.dateFrom && (p.created_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (p.created_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.workType && !(p.proposal_wtc || []).some(w => String(w.work_type_id) === filters.workType)) return false;
    if (filters.customer && !(p.customer || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !(p.call_log?.display_job_number || "").toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(sel ? "detail" : null);
  }, [sel]);

  if (sel) return <ProposalDetail p={sel} onBack={() => setSel(null)} onDeleted={() => { setSel(null); load(); }} teamMember={teamMember} />;

  return (
    <>
      {showModal && (
        <NewProposalModal
          onClose={() => { setShowModal(false); setPreselectedJob(null); }}
          onCreated={(newProposal) => { setShowModal(false); setPreselectedJob(null); setSel(newProposal); load(); }}
          preselectedJob={preselectedJob}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Proposals" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Proposal</Btn>} />
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_TABS.map(tab => {
            const active = statusFilter === tab;
            const count = tab === "All" ? proposals.length : proposals.filter(p => p.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: `1.5px solid ${active ? C.teal : C.borderStrong}`,
                  background: active ? C.dark : "transparent",
                  color: active ? C.teal : C.textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: F.display,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          salesOptions={[...new Set(proposals.map(p => p.call_log?.sales_name).filter(Boolean))].sort()}
          workTypeOptions={workTypes}
        />
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",         l: "Proposal #", r: (v, row) => { const djn = row.call_log?.display_job_number || String(v); const idx = djn.indexOf(" - "); const num = idx > -1 ? djn.slice(0, idx) : djn; const name = idx > -1 ? djn.slice(idx + 3) : ""; return <span style={{ fontFamily: F.display, display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{num} P{row.proposal_number || 1}</span>{name && <span style={{ fontWeight: 500, color: C.textMuted }}>{name}</span>}</span>; } },
              { k: "customer",   l: "Customer" },
              { k: "status",     l: "Status",     r: v => <Pill label={v} cm={PROP_C} /> },
              { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
              { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
              { k: "proposal_wtc", l: "WTCs", r: v => {
                const count = (v || []).length;
                return <span style={{ fontWeight: 700, fontFamily: F.display }}>{count || "—"}</span>;
              }},
              { k: "proposal_wtc", l: "Job Start", r: v => {
                const dates = (v || []).map(w => w.start_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "proposal_wtc", l: "Job End", r: v => {
                const dates = (v || []).map(w => w.end_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "invoices", l: "Invoice", r: (v, row) => {
                const invs = v || [];
                if (invs.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                return (
                  <span onClick={e => { e.stopPropagation(); if (onNavigateInvoice) onNavigateInvoice(invs[0].id); }}
                    style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, fontFamily: F.ui, cursor: "pointer" }}>
                    {invs[0].status || "View"}
                  </span>
                );
              }},
              { k: "_a", l: "", r: (_, row) => (
                <div style={{ display: "flex", gap: 5 }}>
                  <Btn sz="sm" v="secondary" onClick={() => setSel(row)}>Open</Btn>
                  <Btn sz="sm" v="ghost">PDF</Btn>
                </div>
              )},
            ]}
            rows={filteredProposals}
            onRow={setSel}
          />
        )}
      </div>
    </>
  );
}




