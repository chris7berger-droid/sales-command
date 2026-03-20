// SC-20 — Call Log Row Detail View
import { useState } from "react";
import { C, F } from "../lib/tokens";
import Btn from "./Btn";
import { supabase } from "../lib/supabase";

const STAGES = ["New Inquiry", "Wants Bid", "Has Bid", "Sold", "Lost"];

const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenLight, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  boxSizing: "border-box",
};

const labelStyle = {
  fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
  textTransform: "uppercase", color: C.textFaint,
  fontFamily: F.display, marginBottom: 6,
};

function Field({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "span 1" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function stageColor(stage) {
  const map = {
    "New Inquiry": { bg: "rgba(79,70,229,0.15)", color: "#a5b4fc" },
    "Wants Bid":   { bg: "rgba(217,119,6,0.15)",  color: "#fcd34d" },
    "Has Bid":     { bg: "rgba(5,150,105,0.15)",   color: "#6ee7b7" },
    "Sold":        { bg: "rgba(16,185,129,0.2)",   color: "#34d399" },
    "Lost":        { bg: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  };
  return map[stage] || { bg: "rgba(255,255,255,0.06)", color: C.textFaint };
}

export default function CallLogDetail({ job, teamMembers, workTypes, onBack, onSaved, onDeleted, teamMember, onNewProposal }) {
  const [form, setForm] = useState({
    stage:            job.stage            || "",
    bid_due:          job.bid_due          || "",
    follow_up:        job.follow_up        || "",
    notes:            job.notes            || "",
    sales_name:       job.sales_name       || "",
    jobsite_address:  job.jobsite_address  || "",
    jobsite_city:     job.jobsite_city     || "",
    jobsite_state:    job.jobsite_state    || "",
    jobsite_zip:      job.jobsite_zip      || "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);
  const [saved,  setSaved]  = useState(false);
  const [selectedWorkTypes, setSelectedWorkTypes] = useState(
    (job.job_work_types || []).map(jw => jw.work_type_id)
  );

  function toggleWorkType(id) {
    setSelectedWorkTypes(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const canDelete = teamMember && (teamMember.role === "Admin" || teamMember.name === job.sales_name);
  async function handleDelete() {
    const { data: proposals } = await supabase
      .from("proposals")
      .select("id")
      .eq("call_log_id", job.id);
    if (proposals && proposals.length > 0) {
      alert("This job has a proposal attached. Delete the proposal first, then delete the job.");
      return;
    }
    if (!window.confirm("Delete this job? This cannot be undone.")) return;
    await supabase.from("call_log").delete().eq("id", job.id);
    onDeleted && onDeleted();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("call_log")
      .update({
        stage:           form.stage,
        bid_due:         form.bid_due        || null,
        follow_up:       form.follow_up      || null,
        notes:           form.notes,
        sales_name:      form.sales_name     || null,
        jobsite_address: form.jobsite_address || null,
        jobsite_city:    form.jobsite_city    || null,
        jobsite_state:   form.jobsite_state   || null,
        jobsite_zip:     form.jobsite_zip     || null,
      })
      .eq("id", job.id);
    setSaving(false);
    if (err) { setError(err.message); return; }

    // Save work types — delete existing, re-insert selected
    await supabase.from("job_work_types").delete().eq("call_log_id", job.id);
    if (selectedWorkTypes.length > 0) {
      await supabase.from("job_work_types").insert(
        selectedWorkTypes.map(wt_id => ({ call_log_id: job.id, work_type_id: wt_id }))
      );
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onSaved && onSaved();
  }

  const sc = stageColor(form.stage);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* Back */}
      <button onClick={onBack} style={{ background: C.dark, border: "none", cursor: "pointer", color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", padding: "6px 14px", borderRadius: 6, marginBottom: 20, alignSelf: "flex-start" }}>
        ← Call Log
      </button>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em" }}>
          {job.display_job_number || job.job_name}
        </h2>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 12px", borderRadius: 20, background: sc.bg, color: sc.color, fontFamily: F.display }}>
          {form.stage || "No Stage"}
        </span>
        {job.is_change_order && (
          <span style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#9b59b6", padding: "3px 10px", borderRadius: 10, fontFamily: F.ui }}>CO</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onNewProposal && (
            <Btn sz="sm" onClick={onNewProposal}>+ New Proposal</Btn>
          )}
          {canDelete && (
            <Btn sz="sm" v="ghost" onClick={handleDelete} style={{ color: C.red, borderColor: C.red }}>🗑 Delete</Btn>
          )}
        </div>
      </div>
      <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui, marginBottom: 28 }}>
        {job.customer_name || "—"}{job.customer_type ? ` · ${job.customer_type}` : ""}
        {job.date ? ` · Created ${new Date(job.date).toLocaleDateString()}` : ""}
      </div>

      {/* Form grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 28px", marginBottom: 24 }}>

        <Field label="Stage">
          <select value={form.stage} onChange={e => set("stage", e.target.value)} style={inputStyle}>
            <option value="">— Select —</option>
            {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>

        <Field label="Sales Rep">
          <select value={form.sales_name} onChange={e => set("sales_name", e.target.value)} style={inputStyle}>
            <option value="">— Unassigned —</option>
            {teamMembers.map(m => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Bid Due">
          <input type="date" value={form.bid_due} onChange={e => set("bid_due", e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Follow-Up Date">
          <input type="date" value={form.follow_up} onChange={e => set("follow_up", e.target.value)} style={inputStyle} />
        </Field>

        {/* Jobsite address — full width, split fields */}
        <Field label="Jobsite Address" wide>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text"
              value={form.jobsite_address}
              onChange={e => set("jobsite_address", e.target.value)}
              placeholder="Street Address"
              style={inputStyle}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 100px", gap: 8 }}>
              <input placeholder="City"  value={form.jobsite_city}  onChange={e => set("jobsite_city",  e.target.value)} style={inputStyle} />
              <input placeholder="State" value={form.jobsite_state} onChange={e => set("jobsite_state", e.target.value)} style={inputStyle} maxLength={2} />
              <input placeholder="Zip"   value={form.jobsite_zip}   onChange={e => set("jobsite_zip",   e.target.value)} style={inputStyle} />
            </div>
          </div>
        </Field>

        <Field label="Notes" wide>
          <textarea
            value={form.notes}
            onChange={e => set("notes", e.target.value)}
            rows={4}
            placeholder="Add notes…"
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>

      </div>

      {/* Work Types (editable) */}
      {workTypes?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>Work Types</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {workTypes.map(wt => {
              const selected = selectedWorkTypes.includes(wt.id);
              return (
                <button
                  key={wt.id}
                  type="button"
                  onClick={() => toggleWorkType(wt.id)}
                  style={{
                    background: selected ? C.dark : "transparent",
                    border: `1.5px solid ${selected ? C.teal : C.borderStrong}`,
                    borderRadius: 20, padding: "4px 14px", fontSize: 12,
                    color: selected ? C.teal : C.textFaint,
                    fontFamily: F.ui, fontWeight: 600, cursor: "pointer",
                    transition: "all 0.12s",
                  }}
                >
                  {wt.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Read-only meta */}
      <div style={{ display: "flex", gap: 24, marginBottom: 28, padding: "12px 16px", background: C.linenCard, borderRadius: 8, border: `1px solid ${C.border}` }}>
        <div>
          <div style={labelStyle}>Job Type</div>
          <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>{job.job_type || (job.is_change_order ? "Change Order" : "Standard")}</div>
        </div>
        {job.parent_job_id && (
          <div>
            <div style={labelStyle}>Parent Job</div>
            <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>{job.parent_job_id}</div>
          </div>
        )}
        <div>
          <div style={labelStyle}>Job #</div>
          <div style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>{job.job_number}</div>
        </div>
      </div>

      {/* Save */}
      {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ background: C.teal, border: "none", borderRadius: 8, padding: "10px 28px", color: C.dark, fontWeight: 800, fontSize: 14, cursor: saving ? "not-allowed" : "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {saved && <span style={{ color: "#4ade80", fontSize: 13, fontFamily: F.ui, fontWeight: 600 }}>✓ Saved</span>}
      </div>

    </div>
  );
}
