import { useEffect, useRef, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";

function parseMoney(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

export default function ArchiveProposalModal({ onClose, onCreated, preselectedJob }) {
  const [step, setStep] = useState(preselectedJob ? 2 : 1);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState("");
  const [selJob, setSelJob] = useState(preselectedJob || null);

  const [soldAmount, setSoldAmount] = useState("");
  const [description, setDescription] = useState("");
  const [allWorkTypes, setAllWorkTypes] = useState([]);
  const [selectedWtIds, setSelectedWtIds] = useState([]);
  const [wtDropOpen, setWtDropOpen] = useState(false);
  const wtDropRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function handleClick(e) {
      if (wtDropRef.current && !wtDropRef.current.contains(e.target)) setWtDropOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (preselectedJob) return;
    (async () => {
      const { data } = await supabase
        .from("call_log")
        .select("id, display_job_number, job_name, customer_name, archive_record_id")
        .not("archive_record_id", "is", null)
        .eq("archived", false)
        .order("id", { ascending: false });
      setJobs(data || []);
    })();
  }, [preselectedJob]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("work_types").select("id, name").order("name");
      setAllWorkTypes(data || []);
    })();
  }, []);

  useEffect(() => {
    if (!selJob) return;
    (async () => {
      const { data } = await supabase.from("job_work_types").select("work_type_id").eq("call_log_id", selJob.id);
      setSelectedWtIds((data || []).map(r => r.work_type_id));
    })();
  }, [selJob?.id]);

  function toggleWt(id) {
    setSelectedWtIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleCreate() {
    if (!selJob) { setError("Select a job first"); return; }
    if (!selJob.archive_record_id) { setError("This job is not from the archive."); return; }
    const amount = parseMoney(soldAmount);
    if (amount <= 0) { setError("Enter a sold amount."); return; }

    setSaving(true);
    setError(null);

    const { data: existing } = await supabase
      .from("proposals")
      .select("id")
      .eq("call_log_id", selJob.id)
      .is("deleted_at", null);
    const proposalNumber = (existing?.length || 0) + 1;

    const { data: newProp, error: pErr } = await supabase
      .from("proposals")
      .insert([{
        call_log_id: selJob.id,
        customer: selJob.customer_name || selJob.job_name,
        status: "Sold",
        total: amount,
        proposal_number: proposalNumber,
        signing_token: crypto.randomUUID(),
        is_archive_proposal: true,
        intro: description || null,
        approved_at: new Date().toISOString(),
      }])
      .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, customers(email, contact_email, business_address, business_city, business_state, business_zip))")
      .single();
    if (pErr) { setError(pErr.message); setSaving(false); return; }

    await supabase.from("job_work_types").delete().eq("call_log_id", selJob.id);
    if (selectedWtIds.length > 0) {
      await supabase.from("job_work_types").insert(
        selectedWtIds.map(wt_id => ({ call_log_id: selJob.id, work_type_id: wt_id }))
      );
    }

    setSaving(false);
    onCreated(newProp);
  }

  const filtered = jobs.filter(j => {
    const name = (j.display_job_number || j.job_name || "").toLowerCase();
    const cust = (j.customer_name || "").toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || cust.includes(q);
  });

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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 580, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Archive Job Proposal</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 18, lineHeight: 1.5 }}>
          Lightweight proposal for archive-imported jobs — capture the sold amount and a description without building out WTCs. Used for invoicing legacy work and recreating history.
        </div>

        {step === 1 && (
          <>
            <div style={labelStyle}>Select an Archive-Imported Job</div>
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
                  {jobs.length === 0 ? "No archive-imported jobs found" : "No matches"}
                </div>
              )}
              {filtered.map(j => (
                <div key={j.id} onClick={() => { setSelJob(j); setStep(2); }}
                  style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = C.linenDeep}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.textHead, fontFamily: F.display }}>
                      {j.display_job_number || j.job_name}
                    </div>
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>{j.customer_name}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 2 && selJob && (
          <>
            <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginBottom: 16 }}>
              <span style={{ fontWeight: 800, color: C.textHead }}>{selJob.display_job_number || selJob.job_name}</span>
              {" · "}{selJob.customer_name}
              {!preselectedJob && (
                <button onClick={() => setStep(1)} style={{ marginLeft: 12, background: "none", border: "none", color: C.teal, cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: F.display }}>← Change</button>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Sold Amount *</div>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.textFaint, fontFamily: F.ui, fontSize: 14 }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={soldAmount}
                  onChange={e => setSoldAmount(e.target.value)}
                  placeholder="0"
                  style={{ ...inputStyle, paddingLeft: 24 }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={labelStyle}>Description</div>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                placeholder="Brief description of work — appears on invoice and in proposal history."
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={labelStyle}>Work Types (optional, for tagging)</div>
              <div ref={wtDropRef} style={{ position: "relative" }}>
                <div onClick={() => setWtDropOpen(o => !o)} style={{ ...inputStyle, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{selectedWtIds.length === 0 ? "None selected" : `${selectedWtIds.length} selected`}</span>
                  <span style={{ color: C.textFaint }}>▾</span>
                </div>
                {wtDropOpen && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: C.linenCard, border: `1.5px solid ${C.borderStrong}`, borderRadius: 8, maxHeight: 220, overflowY: "auto", zIndex: 10 }}>
                    {allWorkTypes.map(wt => (
                      <div key={wt.id} onClick={() => toggleWt(wt.id)} style={{ padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontFamily: F.ui, borderBottom: `1px solid ${C.border}`, background: selectedWtIds.includes(wt.id) ? C.linenDeep : "transparent" }}>
                        <input type="checkbox" checked={selectedWtIds.includes(wt.id)} readOnly />
                        {wt.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedWtIds.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {selectedWtIds.map(id => {
                    const wt = allWorkTypes.find(w => w.id === id);
                    if (!wt) return null;
                    return (
                      <span key={id} style={{ background: C.dark, color: C.teal, border: `1px solid ${C.tealBorder}`, borderRadius: 14, padding: "3px 10px", fontSize: 11, fontWeight: 700, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 5 }}>
                        {wt.name}
                        <span onClick={() => toggleWt(id)} style={{ cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
              {error && <div style={{ color: C.red, fontSize: 12, fontFamily: F.ui }}>{error}</div>}
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto" }}>
                <Btn v="ghost" onClick={onClose}>Cancel</Btn>
                <Btn onClick={handleCreate} disabled={saving}>{saving ? "Creating…" : "Create Proposal"}</Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
