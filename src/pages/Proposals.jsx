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

function NewProposalModal({ onClose, onCreated }) {
  const [jobs, setJobs]       = useState([]);
  const [search, setSearch]   = useState("");
  const [selJob, setSelJob]   = useState(null);
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
    const { data, error: err } = await supabase
      .from("proposals")
      .insert([{
        call_log_id: selJob.id,
        customer: selJob.customer_name || selJob.job_name,
        status: "Draft",
        total: 0,
      }])
      .select("*, call_log(jobsite_address, display_job_number)")
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

  const fmt$ = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("proposal_wtc")
        .select("*")
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
      burden_rate:    wtc.burden_rate    || 0,
      ot_burden_rate: wtc.ot_burden_rate || 0,
    });
    const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRowLocal(i), 0);
    const trav = Object.values(wtc.travel || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
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
        <div style={{ background: "white", borderRadius: 16, padding: 40, fontSize: 14, color: "#6B7280" }}>Loading WTC data…</div>
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,35,0.7)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "white", borderRadius: 16, width: "min(860px,95vw)", maxHeight: "93vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.35)", overflow: "hidden" }}>

        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #E5E7EB", background: "#FAFAFA", flexShrink: 0 }}>
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
                <button onClick={() => setView("send")} style={{ background: "#1976D2", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "white", cursor: "pointer", fontFamily: "inherit" }}>📨 Send to Customer →</button>
              </>
            )}
            {view === "send" && !sendDone && (
              <button onClick={() => setView("preview")} style={{ background: "none", border: "1.5px solid #E5E7EB", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#4B5563", cursor: "pointer", fontFamily: "inherit" }}>← Back to Preview</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#9CA3AF", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

          {view === "preview" && (
            <div>
              {/* Company header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, paddingBottom: 20, borderBottom: "2px solid #E5E7EB" }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{COMPANY.name}</div>
                  <div style={{ fontSize: 13, color: "#6B7280", marginTop: 3 }}>{COMPANY.tagline}</div>
                  <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 6 }}>{COMPANY.phone} · {COMPANY.email} · {COMPANY.website}</div>
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>{COMPANY.license}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Proposal Total</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "#4CAF50", letterSpacing: "-0.02em" }}>{fmt$(proposalPrice)}</div>
                </div>
              </div>

              {/* Cost breakdown */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Cost Breakdown</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                  {[
                    { label: "Labor",     value: fmt$(totals.labor) },
                    { label: "Materials", value: fmt$(totals.materials) },
                    { label: "Travel",    value: fmt$(totals.travel) },
                    { label: "Discount",  value: totals.discount > 0 ? `-${fmt$(totals.discount)}` : "—" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background: "#F9FAFB", borderRadius: 8, padding: "12px 14px", border: "1px solid #E5E7EB" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sales SOW */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Scope of Work</div>
                <div style={{ background: "#E8F5E9", border: "1.5px solid rgba(76,175,80,0.4)", borderRadius: 10, padding: "16px 18px" }}>
                  {combinedSOW
                    ? <pre style={{ margin: 0, fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{combinedSOW}</pre>
                    : <div style={{ fontSize: 13, color: "#9CA3AF", fontStyle: "italic" }}>No scope of work written yet. Add it in the WTC → Scope of Work tab.</div>
                  }
                </div>
              </div>

              {/* Signature block */}
              <div style={{ borderTop: "2px solid #E5E7EB", paddingTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 32 }}>Customer Signature</div>
                  <div style={{ borderBottom: "1.5px solid #9CA3AF", marginBottom: 6 }} />
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>Signature · Date</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 32 }}>Authorized By</div>
                  <div style={{ borderBottom: "1.5px solid #9CA3AF", marginBottom: 6 }} />
                  <div style={{ fontSize: 11, color: "#9CA3AF" }}>HDSP Representative · Date</div>
                </div>
              </div>
            </div>
          )}

          {view === "send" && !sendDone && (
            <div style={{ maxWidth: 520, margin: "0 auto" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 6 }}>Send Proposal to Customer</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>Select the contact who will receive and sign this proposal.</div>
              <div style={{ background: "#F9FAFB", border: "1.5px solid #E5E7EB", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#6B7280", fontStyle: "italic" }}>
                Recipients will be pulled from the linked customer record. Wire-up coming in SC-30.
              </div>
              <button onClick={() => setSendDone(true)} style={{ width: "100%", background: "#1976D2", color: "white", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                📨 Send Proposal
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


function SendPlaceholder({ proposal, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 420, gap: 16 }}>
      <div style={{ fontSize: 44 }}>📤</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a2e', fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Send Proposal</div>
      <div style={{ fontSize: 13, color: '#888', fontFamily: 'inherit' }}>Proposal {proposal.id} · SC-29 — Coming in Tier 2</div>
      <button onClick={onBack} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#00b4a0', fontWeight: 800, fontSize: 12, fontFamily: 'inherit', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        ← Back to Proposal
      </button>
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
const [showSend, setShowSend] = useState(false);
const [showRecipients, setShowRecipients] = useState(false);
const missingJobsite = !p.call_log?.jobsite_address;

  const [proposal, setProposal] = useState(p);
const [wtcs, setWtcs] = useState([]);

useEffect(() => {
  async function loadWtcs() {
    const { data } = await supabase
      .from("proposal_wtc")
      .select("id, work_type_id, locked, created_at")
      .eq("proposal_id", p.id)
      .order("created_at", { ascending: true });
    setWtcs(data || []);
  }
  loadWtcs();
}, [p.id]);

  async function toggleCheck(field) {
    const newVal = !proposal[field];
    await supabase.from("proposals").update({ [field]: newVal }).eq("id", proposal.id);
    setProposal(prev => ({ ...prev, [field]: newVal }));
  }

  const checks = [
    { l: "Proposal created",              done: true,                        field: null },
    { l: "Introduction completed",        done: proposal.intro_completed,    field: "intro_completed" },
    { l: "Attachments added",             done: proposal.attachments_added,  field: "attachments_added" },
    { l: "Recipients assigned",           done: proposal.recipients_assigned,field: "recipients_assigned" },
    { l: "Work Type Calculator verified", done: proposal.wtc_verified,       field: "wtc_verified" },
  ];
  const pct = Math.round((checks.filter(c => c.done).length / checks.length) * 100);
  const canDelete = teamMember && (teamMember.role === "Admin" || teamMember.name === p.call_log?.sales_name);
  async function handleDelete() {
    if (!window.confirm("Delete this proposal? This cannot be undone.")) return;
    await supabase.from("proposals").delete().eq("id", p.id);
    onDeleted && onDeleted();
  }

if (showWTC) return <WTCCalculator proposalId={p.id} wtcId={activeWtcId} onClose={async () => { const { data } = await supabase.from("proposals").select("*, call_log(jobsite_address, display_job_number)").eq("id", p.id).single(); if (data) setP(data); setShowWTC(false); setActiveWtcId(null); }} />;  if (showPDF) return <ProposalPDFModal proposal={p} onClose={() => setShowPDF(false)} />;
  if (showSend) return <SendPlaceholder proposal={p} onBack={() => setShowSend(false)} />;
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
          Proposal {p.call_log?.display_job_number || p.id}

        </h2>
        <Pill label={p.status} cm={PROP_C} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canDelete && (
            <Btn sz="sm" v="ghost" onClick={handleDelete} style={{ color: C.red, borderColor: C.red }}>🗑 Delete</Btn>
          )}
          <Btn sz="sm" v="ghost" onClick={() => setShowPDF(true)}>Generate PDF</Btn>
          <Btn sz="sm" onClick={() => setShowSend(true)}>Send Proposal</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Work Type Calculators</div>
            {wtcs.length === 0 && (
              <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "10px 0" }}>No work types yet.</div>
            )}
            {wtcs.map((wtc) => (
              <div key={wtc.id} style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>Work Type {wtc.work_type_id || "—"}</div>
                    <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: F.ui }}>Created {fmtD(wtc.created_at?.slice(0,10))}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: wtc.locked ? C.green : C.amber, fontWeight: 700, fontFamily: F.ui }}>{wtc.locked ? "🔒 Locked" : "⏳ In Progress"}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <Btn sz="sm" v="secondary" onClick={() => { setActiveWtcId(wtc.id); setShowWTC(true); }}>Edit WTC</Btn>
                </div>
              </div>
            ))}
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
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Checklist</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: pct === 100 ? C.green : C.amber, fontFamily: F.display }}>{pct}%</div>
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 4, marginBottom: 16 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.teal, borderRadius: 4 }} />
            </div>
            {checks.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < checks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: c.done ? C.teal : C.linen, border: `1.5px solid ${c.done ? C.teal : C.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {c.done && <span style={{ fontSize: 11, color: C.dark, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: c.done ? C.textBody : C.textFaint, fontWeight: c.done ? 600 : 400, fontFamily: F.ui }}>{c.l}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Summary</div>
            {[["Customer", p.customer], ["Total", fmt$(p.total)], ["Created", fmtD(p.created_at?.slice(0,10))], ["Status", p.status]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Proposals({ teamMember }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sel, setSel]             = useState(null);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("proposals")
      .select("*, call_log(jobsite_address, display_job_number)")
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
          onClose={() => setShowModal(false)}
          onCreated={(newProposal) => { setShowModal(false); setSel(newProposal); }}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Proposals" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Proposal</Btn>} />
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",         l: "Proposal #", r: (v, row) => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{row.call_log?.display_job_number || v}</span> },
              { k: "customer",   l: "Customer" },
              { k: "status",     l: "Status",     r: v => <Pill label={v} cm={PROP_C} /> },
              { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
              { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
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




