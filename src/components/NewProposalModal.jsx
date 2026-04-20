import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";
import SearchSelect from "./SearchSelect";
import ArchiveProposalModal from "./ArchiveProposalModal";

function NewProposalModal({ onClose, onCreated, preselectedJob }) {
  const [jobs, setJobs]       = useState([]);
  const [search, setSearch]   = useState("");
  const [selJob, setSelJob]   = useState(preselectedJob || null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("call_log")
        .select("id, display_job_number, job_name, customer_name, jobsite_address, archive_record_id")
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
      .eq("call_log_id", selJob.id)
      .is("deleted_at", null);
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
      .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, customers(email, contact_email, business_address, business_city, business_state, business_zip))")
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

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 10, flexWrap: "wrap" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: 0 }}>Cancel</button>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto" }}>
            {selJob?.archive_record_id && (
              <Btn v="secondary" onClick={() => setShowArchive(true)} disabled={saving} title="Use this tool for building simple proposals without WTC to create invoice or easily recreate a history">
                Archive Job Proposal →
              </Btn>
            )}
            <Btn onClick={handleCreate} disabled={saving || !selJob}>{saving ? "Creating…" : "Create Proposal →"}</Btn>
          </div>
        </div>

      </div>
      {showArchive && selJob && (
        <ArchiveProposalModal
          preselectedJob={selJob}
          onClose={() => setShowArchive(false)}
          onCreated={(newProp) => { setShowArchive(false); onCreated(newProp); }}
        />
      )}
    </div>
  );
}





// COMPANY is loaded from tenant_config in components that need it

export default NewProposalModal;
