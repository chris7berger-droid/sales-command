import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmtD } from "../lib/utils";
import { PROP_C } from "../lib/mockData";
import WTCCalculator from "./WTCCalculator";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

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
      .select("*, call_log(jobsite_address, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email))")
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
  return { regularCost, otCost, subtotal, markupAmt, total };
}

const COMPANY = {
  name: "High Desert Surface Prep",
  tagline: "Industrial & Commercial Concrete Coatings",
  phone: "(775) 555-0192",
  email: "estimates@hdsp.com",
  website: "www.hdsp.com",
  license: "NV Lic #0087342",
};

function ProposalPDFModal({ proposal, onClose }) {
  const [wtcs, setWtcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("preview");
  const [sendDone, setSendDone] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const signingUrl = `https://www.scmybiz.com/sign/${proposal.signing_token}`;

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Look up rep email from team_members by sales_name
      const salesName = proposal.call_log?.sales_name || "";
      let repEmail = "";
      if (salesName) {
        const { data: rep } = await supabase.from("team_members").select("email").eq("name", salesName).maybeSingle();
        repEmail = rep?.email || "";
      }
      const res = await fetch(
        "https://pbgvgjjuhnpsumnowuym.supabase.co/functions/v1/send-proposal",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            customerEmail: proposal.call_log?.customers?.contact_email || "",
            customerName:  proposal.call_log?.customer_name  || "Customer",
            repEmail,
            repName:       salesName,
            proposalNumber: proposal.proposal_number || proposal.id,
            jobName:       proposal.call_log?.job_name || proposal.call_log?.display_job_number || "",
            signingUrl,
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setSendDone(true);
      if (proposal.call_log_id) {
        await supabase.from("call_log").update({ stage: "Has Bid" }).eq("id", proposal.call_log_id);
      }
      await supabase.from("proposals").update({ status: "Sent" }).eq("id", proposal.id);
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
    const labor = calcLaborLocal({
      regular_hours:  wtc.regular_hours  || 0,
      ot_hours:       wtc.ot_hours       || 0,
      markup_pct:     wtc.markup_pct     || 0,
      burden_rate:    wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
    });
    const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRowLocal(i), 0);
    const trav = calcTravelLocal(wtc.travel);
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
                {proposal.status !== "Sold" && <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>📨 Send to Customer →</button>}
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
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1c1814", letterSpacing: "0.02em", textTransform: "uppercase" }}>{COMPANY.name}</div>
                  <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>{COMPANY.tagline}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#4a4238", lineHeight: 1.7 }}>
                  <div>{COMPANY.phone}</div>
                  <div>{COMPANY.email}</div>
                  <div>{COMPANY.website}</div>
                  <div style={{ color: "#887c6e" }}>{COMPANY.license}</div>
                </div>
              </div>

              {/* Prepared For + Proposal # */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid rgba(28,24,20,0.12)" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Prepared For</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1c1814" }}>{proposal.customer || "—"}</div>
                  {proposal.call_log?.jobsite_address && (
                    <div style={{ fontSize: 12, color: "#4a4238", marginTop: 3 }}>
                      {proposal.call_log.jobsite_address}
                      {proposal.call_log.jobsite_city ? ", " + proposal.call_log.jobsite_city : ""}
                      {proposal.call_log.jobsite_state ? ", " + proposal.call_log.jobsite_state : ""}
                      {proposal.call_log.jobsite_zip ? " " + proposal.call_log.jobsite_zip : ""}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Proposal #</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1c1814" }}>{proposal.call_log?.display_job_number || "—"}-P{proposal.proposal_number || 1}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#887c6e", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 10, marginBottom: 4 }}>Date</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1c1814" }}>{new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
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
                    const wtcLabor = calcLaborLocal({
                      regular_hours: wtc.regular_hours || 0, ot_hours: wtc.ot_hours || 0,
                      markup_pct: wtc.markup_pct || 0,
                      burden_rate: wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0),
                      ot_burden_rate: wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0),
                    });
                    const wtcMats = (wtc.materials || []).reduce((s, item) => s + calcMaterialRowLocal(item), 0);
                    const wtcTrav = calcTravelLocal(wtc.travel);
                    const wtcTotal = wtcLabor.total + wtcMats + wtcTrav - (wtc.discount || 0);
                    return (
                      <div key={wtc.id} style={{ marginBottom: i < arr.length - 1 ? 24 : 0 }}>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, marginTop: i > 0 ? 8 : 0 }}>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#1c1814", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>Work Type {i + 1}</div>
                            <div style={{ height: 3, flex: 1, background: "#30cfac", borderRadius: 2 }} />
                          </div>
                        )}
                        <div style={{ border: "1.5px solid rgba(28,24,20,0.2)", borderRadius: 8, padding: "16px 18px", background: "white" }}>
                          <pre style={{ margin: 0, fontSize: 13, color: "#2d2720", lineHeight: 1.75, whiteSpace: "pre-wrap", fontFamily: "Arial, sans-serif" }}>{(wtc.sales_sow || "").trim()}</pre>
                        </div>
                        {arr.length > 1 && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, padding: "8px 18px", background: "rgba(48,207,172,0.08)", borderRadius: 6, border: "1px solid rgba(48,207,172,0.25)" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#4a4238", letterSpacing: "0.06em", textTransform: "uppercase" }}>Work Type {i + 1} Total</div>
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

              {/* Signature block — customer only */}
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

            </div>
          )}

          {view === "send" && !sendDone && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>This will email the customer a link to review and sign electronically.</div>
              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 12, color: "#6B7280", wordBreak: "break-all" }}>
                {signingUrl}
              </div>
              {sendError && <div style={{ fontSize: 12, color: "#e53935", marginBottom: 12 }}>{sendError}</div>}
              <button onClick={handleSend} disabled={sending} style={{ width: "100%", background: sending ? "#ccc" : "#30cfac", color: "#1c1814", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: sending ? "default" : "pointer", fontFamily: "inherit" }}>
                {sending ? "Sending…" : "📨 Send to Customer"}
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




function RecipientsPlaceholder({ proposal, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 420, gap: 16 }}>
      <div style={{ fontSize: 44 }}>👥</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recipients</div>
      <div style={{ fontSize: 13, color: '#888', fontFamily: 'inherit' }}>Proposal {proposal.id} · SC-30 — Coming in Tier 2</div>
      <button onClick={onBack} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#00b4a0', fontWeight: 800, fontSize: 12, fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        ← Back to Proposal
      </button>
    </div>
  );
}

function ProposalDetail({ p: pInit, onBack, onDeleted, teamMember }) {
  const [p, setP] = useState(pInit);
  const [showWTC, setShowWTC] = useState(false);
const [activeWtcId, setActiveWtcId] = useState(null);
const [showPDF, setShowPDF] = useState(false);
const [showRecipients, setShowRecipients] = useState(false);
const [wtcInitialTab, setWtcInitialTab] = useState(null);
const missingJobsite = !p.call_log?.jobsite_address;

const [wtcs, setWtcs] = useState([]);
const [signedPdfUrl, setSignedPdfUrl] = useState(null);
const [attachments, setAttachments] = useState([]);
const [expandedWtc, setExpandedWtc] = useState("auto");

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
  async function loadSignedPdf() {
    const { data } = await supabase
      .from("proposal_signatures")
      .select("pdf_url")
      .eq("proposal_id", p.id)
      .not("pdf_url", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .single();
    if (data?.pdf_url) setSignedPdfUrl(data.pdf_url);
  }
  loadSignedPdf();
}, [p.id]);

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

  function openWtcTab(wtcId, tab) {
    setActiveWtcId(wtcId);
    setWtcInitialTab(tab);
    setShowWTC(true);
  }

  function getWtcChecks(wtc) {
    const travelData = wtc.travel || {};
    const hasTravelEntries = Object.values(travelData).some(v => typeof v === "number" && v > 0);
    return [
      { l: "Job Walk / Bid Off Plans", done: !!wtc.job_walk_type, custom: true },
      { l: "Labor",                    done: (wtc.regular_hours || 0) > 0,                        tab: "labor" },
      { l: "Materials",                done: Array.isArray(wtc.materials) && wtc.materials.length > 0, tab: "materials" },
      { l: "Travel",                   done: hasTravelEntries,                                     tab: "travel" },
      { l: "Field SOW",               done: Array.isArray(wtc.field_sow) && wtc.field_sow.length > 0, tab: "sow" },
      { l: "Sales SOW",               done: !!(wtc.sales_sow),                                    tab: "sow" },
      { l: "Review & Lock",           done: !!wtc.locked,                                          tab: "summary" },
    ];
  }

  function calcWtcPrice(wtc) {
    const rate = wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0);
    const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
    const labor = calcLaborLocal({ regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours, markup_pct: wtc.markup_pct, burden_rate: rate, ot_burden_rate: otRate });
    const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRowLocal(i), 0);
    const trav = calcTravelLocal(wtc.travel);
    const disc = wtc.discount || 0;
    return labor.total + mats + trav - disc;
  }
  const canDelete = teamMember && (teamMember.role === "Admin" || teamMember.name === p.call_log?.sales_name);
  async function handleDelete() {
    if (!window.confirm("Delete this proposal? This cannot be undone.")) return;
    await supabase.from("proposal_signatures").delete().eq("proposal_id", p.id);
    await supabase.from("proposal_wtc").delete().eq("proposal_id", p.id);
    await supabase.from("proposals").delete().eq("id", p.id);
    // Verify it was actually deleted (RLS may silently block)
    const { data: still } = await supabase.from("proposals").select("id").eq("id", p.id).maybeSingle();
    if (still) { alert("Delete failed — you may not have permission to delete this proposal."); return; }
    onDeleted && onDeleted();
  }

if (showWTC) return <WTCCalculator proposalId={p.id} wtcId={activeWtcId} initialTab={wtcInitialTab} onBackToList={onBack} onClose={async (openPDF = false) => { const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email))").eq("id", p.id).single(); if (data) setP(data); setShowWTC(false); setActiveWtcId(null); setWtcInitialTab(null); const { data: wtcData } = await supabase.from("proposal_wtc").select("*, work_types(name)").eq("proposal_id", p.id).order("created_at", { ascending: true }); setWtcs(wtcData || []); if (openPDF) setShowPDF(true); }} />;  if (showPDF) return <ProposalPDFModal key={p.id + '-' + Date.now()} proposal={p} onClose={async () => { const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email))").eq("id", p.id).single(); if (data) setP(data); setShowPDF(false); }} />;
  if (showRecipients) return <RecipientsPlaceholder proposal={p} onBack={() => setShowRecipients(false)} />;

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
          <Btn sz="sm" v="ghost" onClick={() => setShowPDF(true)}>Generate PDF</Btn>
          {p.status !== "Sold" && <Btn sz="sm" onClick={() => setShowPDF(true)}>Send Proposal</Btn>}
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
                <div key={wtc.id} style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>
                        {wtcLabel}{typeName ? ` — ${typeName}` : ""}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui, marginTop: 4 }}>{fmt$(price)}</div>
                      <div style={{ fontSize: 11, color: C.textFaint, marginTop: 2, fontFamily: F.ui }}>Created {fmtD(wtc.created_at?.slice(0,10))}</div>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div style={{ fontSize: 11, color: wtc.locked ? C.green : C.amber, fontWeight: 700, fontFamily: F.ui }}>{wtc.locked ? "🔒 Locked" : "⏳ In Progress"}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: pct === 100 ? C.green : C.textHead, fontFamily: F.display }}>{pct}%</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                    <Btn sz="sm" v="secondary" onClick={() => { setActiveWtcId(wtc.id); setShowWTC(true); }}>Edit WTC</Btn>
                    <button onClick={() => setExpandedWtc(isExpanded ? null : wtc.id)} style={{
                      background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 12px",
                      fontSize: 11, fontWeight: 700, color: C.textFaint, cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{isExpanded ? "Hide Checklist" : "Checklist"}</button>
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

          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Recipients</div><Btn sz="sm" v="ghost" onClick={() => setShowRecipients(true)}>+ Assign</Btn></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[["Role", "Signer"], ["Name", "—"], ["Email", "—"]].map(([k, val]) => (
                <div key={k}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui }}>{k}</div>
                  <div style={{ marginTop: 4, fontSize: 13.5, fontWeight: 600, color: k === "Email" ? C.tealDark : C.textHead, fontFamily: F.ui }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {attachments.length > 0 && (
            <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Attachments</div>
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

          <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Summary</div>
            {[["Customer", p.customer], ["Total", fmt$(wtcs.length ? wtcs.reduce((s, w) => s + calcWtcPrice(w), 0) : p.total)], ["Created", fmtD(p.created_at?.slice(0,10))], ["Status", p.status]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
            {signedPdfUrl && (
              <div style={{ marginTop: 14 }}>
                <a href={signedPdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", background: C.teal, color: C.dark, borderRadius: 8, padding: "10px 0", fontSize: 12, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
                  ⬇ Download Signed PDF
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Proposals({ teamMember, initialProposal, onClearInitial }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sel, setSel]             = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [preselectedJob, setPreselectedJob] = useState(null);

  useEffect(() => {
    if (initialProposal?.job) {
      setPreselectedJob(initialProposal.job);
      setShowModal(true);
      onClearInitial && onClearInitial();
    }
  }, [initialProposal]);

  const load = async () => {
    const { data } = await supabase
      .from("proposals")
      .select("*, call_log(jobsite_address, display_job_number, customer_name, sales_name, job_name, customer_id, customers(contact_email)), proposal_wtc(start_date, end_date)")
      .order("created_at", { ascending: false });
    setProposals(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (sel) return <ProposalDetail p={sel} onBack={() => setSel(null)} onDeleted={() => { setSel(null); load(); }} teamMember={teamMember} />;

  return (
    <>
      {showModal && (
        <NewProposalModal
          onClose={() => { setShowModal(false); setPreselectedJob(null); }}
          onCreated={(newProposal) => { setShowModal(false); setPreselectedJob(null); setSel(newProposal); }}
          preselectedJob={preselectedJob}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Proposals" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Proposal</Btn>} />
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",         l: "Proposal #", r: (v, row) => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{row.call_log?.display_job_number || v} P{row.proposal_number || 1}</span> },
              { k: "customer",   l: "Customer" },
              { k: "status",     l: "Status",     r: v => <Pill label={v} cm={PROP_C} /> },
              { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
              { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
              { k: "proposal_wtc", l: "Start", r: v => {
                const dates = (v || []).map(w => w.start_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "proposal_wtc", l: "End", r: v => {
                const dates = (v || []).map(w => w.end_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "_a", l: "", r: (_, row) => (
                <div style={{ display: "flex", gap: 5 }}>
                  <Btn sz="sm" v="secondary" onClick={() => setSel(row)}>Open</Btn>
                  <Btn sz="sm" v="ghost">PDF</Btn>
                </div>
              )},
            ]}
            rows={proposals}
            onRow={setSel}
          />
        )}
      </div>
    </>
  );
}




