// SC-20 — Call Log Row Detail View
import { useState, useEffect, useRef } from "react";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import Btn from "./Btn";
import { supabase } from "../lib/supabase";

const STAGES = ["New Inquiry", "Wants Bid", "Has Bid", "Sold", "Lost"];

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

function Field({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "span 1" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

function Section({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16, border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: C.linenCard, border: "none", cursor: "pointer" }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textHead, fontFamily: F.display }}>{title}</span>
        <span style={{ fontSize: 10, color: C.textFaint }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: "16px 16px 8px" }}>{children}</div>}
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

export default function CallLogDetail({ job, teamMembers, workTypes, onBack, onSaved, onDeleted, teamMember, onNewProposal, onNavigateProposal, onNavigateInvoice, onNavigateCustomer }) {
  const cust = job.customers || {};
  const [linkedProposals, setLinkedProposals] = useState([]);
  const [linkedInvoices, setLinkedInvoices] = useState([]);
  const [form, setForm] = useState({
    stage:            job.stage            || "",
    customer_name:    job.customer_name    || "",
    job_name:         job.job_name         || "",
    bid_due:          job.bid_due          || "",
    follow_up:        job.follow_up        || "",
    notes:            job.notes            || "",
    sales_name:       job.sales_name       || "",
    jobsite_address:  job.jobsite_address  || "",
    jobsite_city:     job.jobsite_city     || "",
    jobsite_state:    job.jobsite_state    || "",
    jobsite_zip:      job.jobsite_zip      || "",
    contact_email:    cust.contact_email   || "",
    contact_phone:    cust.contact_phone   || "",
    billing_terms:    cust.billing_terms != null ? String(cust.billing_terms) : "30",
    billing_same:     cust.billing_same ?? true,
    billing_name:     cust.billing_name    || "",
    billing_phone:    cust.billing_phone   || "",
    billing_email:    cust.billing_email   || "",
  });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);
  const [saved,  setSaved]  = useState(false);
  const [selectedWorkTypes, setSelectedWorkTypes] = useState(
    (job.job_work_types || []).map(jw => jw.work_type_id)
  );
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [wtDropOpen, setWtDropOpen] = useState(false);
  const wtDropRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wtDropRef.current && !wtDropRef.current.contains(e.target)) setWtDropOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function fetchAttachments() {
    const { data, error: listErr } = await supabase.storage
      .from("job-attachments")
      .list(String(job.id));
    if (listErr || !data) return;
    setAttachments(
      data.map(file => {
        const { data: urlData } = supabase.storage
          .from("job-attachments")
          .getPublicUrl(`${job.id}/${file.name}`);
        const display = file.name.replace(/^\d+-/, "");
        return { name: display, url: urlData.publicUrl };
      })
    );
  }

  useEffect(() => { fetchAttachments(); }, [job.id]);

  useEffect(() => {
    async function fetchLinked() {
      const [{ data: props }, { data: invs }] = await Promise.all([
        supabase.from("proposals").select("id, status, total, proposal_number, call_log(display_job_number)").eq("call_log_id", job.id).order("created_at"),
        supabase.from("invoices").select("id, status, amount, job_name").eq("job_id", job.display_job_number).order("sent_at", { ascending: false }),
      ]);
      setLinkedProposals(props || []);
      setLinkedInvoices(invs || []);
    }
    fetchLinked();
  }, [job.id]);

  async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const failures = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${job.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file);
      if (upErr) failures.push(file.name);
    }
    if (failures.length) alert(`Failed to upload: ${failures.join(", ")}`);
    await fetchAttachments();
    setUploading(false);
    e.target.value = "";
  }

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
    // Delete linked work types first (FK constraint)
    const { error: wtErr } = await supabase.from("job_work_types").delete().eq("call_log_id", job.id);
    if (wtErr) console.warn("job_work_types delete:", wtErr.message);
    const { error: delErr, count } = await supabase.from("call_log").delete().eq("id", job.id).select();
    console.log("call_log delete result:", { delErr, count });
    if (delErr) { alert("Delete failed: " + delErr.message); return; }
    // Verify it was actually deleted (RLS may silently block)
    const { data: still } = await supabase.from("call_log").select("id").eq("id", job.id).maybeSingle();
    if (still) {
      console.warn("RLS blocked delete for call_log id:", job.id);
      alert("Delete blocked by database policy. Check Supabase RLS on call_log table — you need a DELETE policy.");
      return;
    }
    onDeleted && onDeleted();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("call_log")
      .update({
        stage:           form.stage,
        customer_name:   form.customer_name  || null,
        job_name:        form.job_name       || null,
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

    // Save customer contact info
    if (job.customer_id) {
      await supabase.from("customers").update({
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        billing_terms: parseInt(form.billing_terms) || 30,
        billing_same: form.billing_same,
        billing_name: form.billing_same ? null : (form.billing_name || null),
        billing_phone: form.billing_same ? null : (form.billing_phone || null),
        billing_email: form.billing_same ? null : (form.billing_email || null),
      }).eq("id", job.customer_id);
    }

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
  const iStyle = { ...inputStyle, ...(editing ? {} : { opacity: 0.75, pointerEvents: "none" }) };

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
          {!editing && <Btn sz="sm" v="ghost" onClick={() => setEditing(true)}>Edit</Btn>}
          {onNewProposal && (
            <Btn sz="sm" onClick={onNewProposal}>+ New Proposal</Btn>
          )}
          {editing && canDelete && (
            <Btn sz="sm" v="ghost" onClick={handleDelete} style={{ color: C.red, borderColor: C.red }}>🗑 Delete</Btn>
          )}
        </div>
      </div>
      <div style={{ color: C.textFaint, fontSize: 13, fontFamily: F.ui, marginBottom: 28 }}>
        {onNavigateCustomer && job.customer_id ? (
          <span onClick={() => onNavigateCustomer(job.customer_id)} style={{ color: C.tealDark, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>{job.customer_name || "—"}</span>
        ) : (job.customer_name || "—")}
        {job.customer_type ? ` · ${job.customer_type}` : ""}
        {job.created_at ? ` · Created ${new Date(job.created_at).toLocaleDateString()}` : ""}
      </div>

      {/* Job Info */}
      <Section title="Job Info" defaultOpen={true}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 24px" }}>
          <Field label="Stage">
            <select value={form.stage} onChange={e => set("stage", e.target.value)} style={iStyle}>
              <option value="">— Select —</option>
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Sales Rep">
            <select value={form.sales_name} onChange={e => set("sales_name", e.target.value)} style={iStyle}>
              <option value="">— Unassigned —</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Customer Name">
            <input type="text" value={form.customer_name} onChange={e => set("customer_name", e.target.value)} placeholder="Customer name" style={iStyle} />
          </Field>
          <Field label="Job Name">
            <input type="text" value={form.job_name} onChange={e => set("job_name", e.target.value)} placeholder="Job name" style={iStyle} />
          </Field>
          <Field label="Bid Due">
            <input type="date" value={form.bid_due} onChange={e => set("bid_due", e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...iStyle, cursor: "pointer" }} />
          </Field>
          <Field label="Follow-Up Date">
            <input type="date" value={form.follow_up} onChange={e => set("follow_up", e.target.value)} onClick={e => e.target.showPicker?.()} style={{ ...iStyle, cursor: "pointer" }} />
          </Field>
        </div>
      </Section>

      {/* Contact & Billing */}
      <Section title="Contact & Billing">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 24px" }}>
          <Field label="Customer Email">
            <input type="email" value={form.contact_email} onChange={e => set("contact_email", e.target.value)} placeholder="customer@example.com" style={iStyle} />
          </Field>
          <Field label="Customer Phone">
            <input type="tel" value={form.contact_phone} onChange={e => set("contact_phone", e.target.value)} placeholder="(555) 555-5555" style={iStyle} />
          </Field>
          <Field label="Billing Terms">
            <select value={[5,15,30,45,60,90,120].includes(Number(form.billing_terms)) ? form.billing_terms : "custom"} onChange={e => set("billing_terms", e.target.value)} style={iStyle}>
              <option value="5">Net 5</option>
              <option value="15">Net 15</option>
              <option value="30">Net 30</option>
              <option value="45">Net 45</option>
              <option value="60">Net 60</option>
              <option value="90">Net 90</option>
              <option value="120">Net 120</option>
              <option value="custom">Custom</option>
            </select>
            {![5,15,30,45,60,90,120].includes(Number(form.billing_terms)) && form.billing_terms !== "custom" && (
              <input type="number" value={form.billing_terms} onChange={e => set("billing_terms", e.target.value)} placeholder="Days" style={{ ...iStyle, marginTop: 8 }} />
            )}
            {form.billing_terms === "custom" && (
              <input type="number" value="" onChange={e => set("billing_terms", e.target.value)} placeholder="Days" style={{ ...iStyle, marginTop: 8 }} />
            )}
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <button onClick={() => editing && set("billing_same", !form.billing_same)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: editing ? "pointer" : "default", padding: "4px 0", opacity: editing ? 1 : 0.75 }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${!form.billing_same ? C.teal : C.borderStrong}`, background: !form.billing_same ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {!form.billing_same && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
            </div>
            <span style={{ fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>Is there a separate billing contact?</span>
          </button>
          {!form.billing_same && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 24px", marginTop: 10, padding: "12px 14px", background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>
              <Field label="Billing Contact Name" wide>
                <input type="text" value={form.billing_name} onChange={e => set("billing_name", e.target.value)} placeholder="Billing contact name" style={iStyle} />
              </Field>
              <Field label="Billing Phone">
                <input type="tel" value={form.billing_phone} onChange={e => set("billing_phone", e.target.value)} placeholder="Billing phone" style={iStyle} />
              </Field>
              <Field label="Billing Email">
                <input type="email" value={form.billing_email} onChange={e => set("billing_email", e.target.value)} placeholder="Billing email" style={iStyle} />
              </Field>
            </div>
          )}
        </div>
      </Section>

      {/* Address */}
      <Section title="Jobsite Address">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input type="text" value={form.jobsite_address} onChange={e => set("jobsite_address", e.target.value)} placeholder="Street Address" style={iStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 100px", gap: 8 }}>
            <input placeholder="City" value={form.jobsite_city} onChange={e => set("jobsite_city", e.target.value)} style={iStyle} />
            <input placeholder="State" value={form.jobsite_state} onChange={e => set("jobsite_state", e.target.value)} style={iStyle} maxLength={2} />
            <input placeholder="Zip" value={form.jobsite_zip} onChange={e => set("jobsite_zip", e.target.value)} style={iStyle} />
          </div>
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <textarea
          value={form.notes}
          onChange={e => set("notes", e.target.value)}
          rows={4}
          placeholder="Add notes…"
          style={{ ...iStyle, resize: "vertical" }}
        />
      </Section>

      {/* Work Types (dropdown with checkboxes) */}
      {workTypes?.length > 0 && (
        <div style={{ marginBottom: 24, position: "relative" }} ref={wtDropRef}>
          <div style={labelStyle}>Work Types</div>
          <button type="button" onClick={() => editing && setWtDropOpen(p => !p)}
            style={{ ...iStyle, textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: selectedWorkTypes.length ? C.textBody : C.textFaint, fontFamily: F.ui, fontSize: 13 }}>
              {selectedWorkTypes.length ? `${selectedWorkTypes.length} selected` : "Select work types…"}
            </span>
            <span style={{ fontSize: 10, color: C.textFaint }}>{wtDropOpen ? "▲" : "▼"}</span>
          </button>
          {wtDropOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.linenDeep, border: `1.5px solid ${C.borderStrong}`, borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", zIndex: 999, maxHeight: 240, overflowY: "auto", marginTop: 2 }}>
              {workTypes.map(wt => {
                const selected = selectedWorkTypes.includes(wt.id);
                return (
                  <div key={wt.id} onClick={() => toggleWorkType(wt.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", background: selected ? C.dark : "transparent", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ width: 16, height: 16, borderRadius: 3, border: `2px solid ${selected ? C.teal : C.borderStrong}`, background: selected ? C.teal : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {selected && <span style={{ color: C.dark, fontSize: 9, fontWeight: 900 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: selected ? 700 : 400, color: selected ? C.teal : C.textBody, fontFamily: F.ui }}>{wt.name}</span>
                  </div>
                );
              })}
            </div>
          )}
          {selectedWorkTypes.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {selectedWorkTypes.map(id => {
                const wt = workTypes.find(w => w.id === id);
                if (!wt) return null;
                return (
                  <span key={id} style={{ background: C.dark, color: C.teal, border: `1px solid ${C.tealBorder}`, borderRadius: 14, padding: "3px 10px", fontSize: 11, fontWeight: 700, fontFamily: F.ui, display: "flex", alignItems: "center", gap: 5 }}>
                    {wt.name}
                    <span onClick={() => toggleWorkType(id)} style={{ cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Attachments */}
      <div style={{ marginBottom: 24 }}>
        <div style={labelStyle}>Attachments</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
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
          {attachments.length === 0 && (
            <span style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>No attachments yet</span>
          )}
        </div>
        <label style={{ background: C.dark, color: C.teal, fontWeight: 800, fontSize: 12, fontFamily: F.display, letterSpacing: "0.06em", padding: "6px 14px", borderRadius: 6, cursor: uploading ? "not-allowed" : "pointer", display: "inline-block", opacity: uploading ? 0.6 : 1 }}>
          {uploading ? "Uploading…" : "+ Upload Files"}
          <input type="file" multiple onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>

      {/* Linked Items */}
      {(linkedProposals.length > 0 || linkedInvoices.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <div style={labelStyle}>Linked Items</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {linkedProposals.length > 0 && (
              <div style={{ background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: C.dark, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase" }}>Proposals</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.ui }}>{linkedProposals.length}</span>
                </div>
                {linkedProposals.map((p, i) => {
                  const label = `${p.call_log?.display_job_number || job.display_job_number || "P"} P${p.proposal_number || 1}`;
                  const statusColors = {
                    Draft: { bg: "rgba(28,24,20,0.08)", color: C.textMuted },
                    Sent:  { bg: "rgba(142,68,173,0.10)", color: "#5b2d7a" },
                    Sold:  { bg: "rgba(67,160,71,0.15)", color: "#1e5e22" },
                    Lost:  { bg: "rgba(229,57,53,0.10)", color: "#8b1a18" },
                  };
                  const sc = statusColors[p.status] || { bg: "rgba(28,24,20,0.06)", color: C.textFaint };
                  return (
                    <button key={`p-${p.id}`} onClick={() => onNavigateProposal && onNavigateProposal(p.id)}
                      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", background: i % 2 === 0 ? C.linenLight : C.linen, border: "none", borderBottom: `1px solid ${C.border}`, cursor: onNavigateProposal ? "pointer" : "default", textAlign: "left" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: C.tealDark, fontFamily: F.display, letterSpacing: "0.03em", minWidth: 140 }}>{label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: sc.bg, color: sc.color, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.status}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.display, fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>{fmt$(p.total)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {linkedInvoices.length > 0 && (
              <div style={{ background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: C.dark, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase" }}>Invoices</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.teal, fontFamily: F.ui }}>{linkedInvoices.length}</span>
                </div>
                {linkedInvoices.map((inv, i) => {
                  const invColors = {
                    New:    { bg: "rgba(28,24,20,0.08)", color: C.textMuted },
                    Sent:   { bg: "rgba(142,68,173,0.10)", color: "#5b2d7a" },
                    Paid:   { bg: "rgba(67,160,71,0.15)", color: "#1e5e22" },
                    "Past Due": { bg: "rgba(229,57,53,0.10)", color: "#8b1a18" },
                    "Waiting for Payment": { bg: "rgba(249,168,37,0.13)", color: "#7a5000" },
                  };
                  const ic = invColors[inv.status] || { bg: "rgba(28,24,20,0.06)", color: C.textFaint };
                  return (
                    <button key={`i-${inv.id}`} onClick={() => onNavigateInvoice && onNavigateInvoice(inv.id)}
                      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 14px", background: i % 2 === 0 ? C.linenLight : C.linen, border: "none", borderBottom: `1px solid ${C.border}`, cursor: onNavigateInvoice ? "pointer" : "default", textAlign: "left" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: C.tealDark, fontFamily: F.display, letterSpacing: "0.03em", minWidth: 140 }}>Invoice #{inv.id}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: ic.bg, color: ic.color, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.04em" }}>{inv.status}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.display, fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>{fmt$(inv.amount)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save */}
      {editing && (
        <>
          {error && <div style={{ color: C.red, fontSize: 13, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={async () => { await handleSave(); setEditing(false); }}
              disabled={saving}
              style={{ background: C.teal, border: "none", borderRadius: 8, padding: "10px 28px", color: C.dark, fontWeight: 800, fontSize: 14, cursor: saving ? "not-allowed" : "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <Btn sz="sm" v="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
            {saved && <span style={{ color: "#4ade80", fontSize: 13, fontFamily: F.ui, fontWeight: 600 }}>✓ Saved</span>}
          </div>
        </>
      )}

    </div>
  );
}
