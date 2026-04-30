import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { getCurrentTeamMember } from "../lib/auth";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Btn from "../components/Btn";
import CustomerMergeModal from "../components/CustomerMergeModal";

const STD_TERMS = [5, 15, 30, 45, 60, 90, 120];
const CONTACT_ROLES = ["Project Manager", "Office Manager", "Billing Contact"];
const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 7, border: `1px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui, WebkitAppearance: "none" };
const stageColor = s => ({ "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red }[s] || C.textFaint);

function Field({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

/* ─── Edit Modal ─── */
function CustomerModal({ customer, onClose, onSaved }) {
  const isNew = !customer;
  const [form, setForm] = useState({
    name:             customer?.name             || "",
    customer_type:    customer?.customer_type     || "Commercial",
    first_name:       customer?.first_name        || "",
    last_name:        customer?.last_name          || "",
    phone:            customer?.phone              || "",
    email:            customer?.email              || "",
    billing_same:     customer?.billing_same       ?? true,
    billing_name:     customer?.billing_name       || "",
    billing_phone:    customer?.billing_phone      || "",
    billing_email:    customer?.billing_email      || "",
    billing_terms:    customer?.billing_terms != null ? String(customer.billing_terms) : "30",
    business_address: customer?.business_address   || "",
    business_city:    customer?.business_city       || "",
    business_state:   customer?.business_state      || "",
    business_zip:     customer?.business_zip        || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim() && form.customer_type === "Commercial") { setError("Company name is required"); return; }
    if (form.customer_type === "Residential" && (!form.first_name.trim() || !form.last_name.trim())) { setError("First and last name required"); return; }
    setSaving(true); setError("");
    const name = form.customer_type === "Residential" ? `${form.first_name} ${form.last_name}` : form.name;
    const billingTerms = STD_TERMS.includes(Number(form.billing_terms)) ? Number(form.billing_terms) : (parseInt(form.billing_terms) || 30);
    const payload = {
      name, customer_type: form.customer_type, first_name: form.first_name || null, last_name: form.last_name || null,
      phone: form.phone || null, email: form.email || null,
      billing_same: form.billing_same, billing_name: form.billing_same ? null : (form.billing_name || null),
      billing_phone: form.billing_same ? null : (form.billing_phone || null), billing_email: form.billing_same ? null : (form.billing_email || null),
      billing_terms: billingTerms, business_address: form.business_address || null,
      business_city: form.business_city || null, business_state: form.business_state || null, business_zip: form.business_zip || null,
    };
    let err;
    if (isNew) ({ error: err } = await supabase.from("customers").insert([payload]));
    else ({ error: err } = await supabase.from("customers").update(payload).eq("id", customer.id));
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const termsVal = STD_TERMS.includes(Number(form.billing_terms)) ? form.billing_terms : "custom";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 520, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {isNew ? "Add Customer" : "Edit Customer"}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Customer Type" wide>
            <select value={form.customer_type} onChange={e => set("customer_type", e.target.value)} style={inputStyle}>
              <option value="Commercial">Commercial</option>
              <option value="Residential">Residential</option>
            </select>
          </Field>
          {form.customer_type === "Residential" ? (
            <><Field label="First Name"><input value={form.first_name} onChange={e => set("first_name", e.target.value)} style={inputStyle} /></Field>
            <Field label="Last Name"><input value={form.last_name} onChange={e => set("last_name", e.target.value)} style={inputStyle} /></Field></>
          ) : (
            <Field label="Company Name" wide><input value={form.name} onChange={e => set("name", e.target.value)} style={inputStyle} /></Field>
          )}
          <Field label="Company Phone"><input value={form.phone} onChange={e => set("phone", e.target.value)} style={inputStyle} /></Field>
          <Field label="Company Email"><input type="email" value={form.email} onChange={e => set("email", e.target.value)} style={inputStyle} /></Field>
          <Field label="Billing Same as Company?" wide>
            <button onClick={() => set("billing_same", !form.billing_same)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${form.billing_same ? C.teal : C.borderStrong}`, background: form.billing_same ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {form.billing_same && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Billing info is the same as company</span>
            </button>
          </Field>
          {!form.billing_same && (
            <><Field label="Billing Name" wide><input value={form.billing_name} onChange={e => set("billing_name", e.target.value)} style={inputStyle} /></Field>
            <Field label="Billing Phone"><input value={form.billing_phone} onChange={e => set("billing_phone", e.target.value)} style={inputStyle} /></Field>
            <Field label="Billing Email"><input type="email" value={form.billing_email} onChange={e => set("billing_email", e.target.value)} style={inputStyle} /></Field></>
          )}
          <Field label="Billing Terms">
            <select value={termsVal} onChange={e => set("billing_terms", e.target.value)} style={inputStyle}>
              {STD_TERMS.map(t => <option key={t} value={String(t)}>Net {t}</option>)}
              <option value="custom">Custom</option>
            </select>
            {termsVal === "custom" && (
              <input type="number" placeholder="Days" value={!STD_TERMS.includes(Number(form.billing_terms)) && form.billing_terms !== "custom" ? form.billing_terms : ""} onChange={e => set("billing_terms", e.target.value)} style={{ ...inputStyle, marginTop: 8 }} />
            )}
          </Field>
          <Field label="Business Address" wide>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input placeholder="Street" value={form.business_address} onChange={e => set("business_address", e.target.value)} style={inputStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px 100px", gap: 8 }}>
                <input placeholder="City" value={form.business_city} onChange={e => set("business_city", e.target.value)} style={inputStyle} />
                <input placeholder="State" value={form.business_state} onChange={e => set("business_state", e.target.value)} style={inputStyle} maxLength={2} />
                <input placeholder="Zip" value={form.business_zip} onChange={e => set("business_zip", e.target.value)} style={inputStyle} />
              </div>
            </div>
          </Field>
        </div>
        {error && <div style={{ marginTop: 14, color: C.red, fontSize: 13, fontFamily: F.ui }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <Btn v="ghost" sz="sm" onClick={onClose}>Cancel</Btn>
          <Btn sz="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isNew ? "Add Customer" : "Save Changes"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Contact Modal ─── */
function ContactModal({ contact, customerId, canManage, onClose, onSaved }) {
  const isNew = !contact;
  const [form, setForm] = useState({
    name:  contact?.name  || "",
    phone: contact?.phone || "",
    email: contact?.email || "",
    role:  contact?.role  || "",
    is_primary: contact?.is_primary || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const payload = {
      customer_id: customerId,
      name: form.name.trim(), phone: form.phone || null, email: form.email || null,
      role: form.role || null, is_primary: form.is_primary,
    };
    // If marking as primary, clear other primaries first
    if (form.is_primary) {
      await supabase.from("customer_contacts").update({ is_primary: false }).eq("customer_id", customerId);
    }
    let err;
    if (isNew) ({ error: err } = await supabase.from("customer_contacts").insert([payload]));
    else ({ error: err } = await supabase.from("customer_contacts").update(payload).eq("id", contact.id));
    setSaving(false);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  const handleDelete = async () => {
    if (!confirm("Delete this contact?")) return;
    const { error: err } = await supabase.from("customer_contacts").delete().eq("id", contact.id);
    if (err) { setError(err.message); return; }
    onSaved();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 420, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {isNew ? "Add Contact" : "Edit Contact"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name"><input value={form.name} onChange={e => set("name", e.target.value)} style={inputStyle} /></Field>
          <Field label="Role">
            <select value={form.role} onChange={e => set("role", e.target.value)} style={inputStyle}>
              <option value="">— Select Role —</option>
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Phone"><input value={form.phone} onChange={e => set("phone", e.target.value)} style={inputStyle} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={e => set("email", e.target.value)} style={inputStyle} /></Field>
          <Field label="Primary Contact?">
            <button onClick={() => set("is_primary", !form.is_primary)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${form.is_primary ? C.teal : C.borderStrong}`, background: form.is_primary ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {form.is_primary && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Mark as primary contact</span>
            </button>
          </Field>
        </div>
        {error && <div style={{ marginTop: 14, color: C.red, fontSize: 13, fontFamily: F.ui }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
          <div>
            {!isNew && canManage && <Btn v="ghost" sz="sm" onClick={handleDelete} style={{ color: C.red }}>Delete</Btn>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn v="ghost" sz="sm" onClick={onClose}>Cancel</Btn>
            <Btn sz="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isNew ? "Add Contact" : "Save"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Pay App Template Modal ─── */
function PayAppTemplateModal({ customerId, onClose, onSaved }) {
  const [label, setLabel]             = useState("");
  const [scope, setScope]             = useState("customer"); // "customer" | "job"
  const [proposalId, setProposalId]   = useState("");
  const [proposals, setProposals]     = useState([]);
  const [file, setFile]               = useState(null);
  const [isDefault, setIsDefault]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("proposals")
        .select("id, proposal_number, call_log!inner(customer_id, job_name)")
        .eq("call_log.customer_id", customerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      setProposals(data || []);
    })();
  }, [customerId]);

  const handleSave = async () => {
    if (!label.trim()) { setError("Label is required"); return; }
    if (!file)         { setError("PDF file is required"); return; }
    if (scope === "job" && !proposalId) { setError("Select a proposal for job-specific templates"); return; }

    setSaving(true); setError("");

    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `pay-app-templates/${customerId}/${Date.now()}-${cleanName}`;
    const { error: upErr } = await supabase.storage.from("job-attachments").upload(path, file, { contentType: "application/pdf" });
    if (upErr) { setSaving(false); setError(upErr.message); return; }

    const { data: pub } = supabase.storage.from("job-attachments").getPublicUrl(path);
    const pdf_url = pub?.publicUrl;

    // If setting as default (customer scope only), clear others first
    if (scope === "customer" && isDefault) {
      await supabase.from("customer_pay_app_templates")
        .update({ is_default: false })
        .eq("customer_id", customerId)
        .eq("scope", "customer");
    }

    const payload = {
      customer_id: customerId,
      proposal_id: scope === "job" ? proposalId : null,
      scope,
      label: label.trim(),
      pdf_url,
      is_fillable: false,
      field_mapping: null,
      is_default: scope === "customer" ? isDefault : false,
    };
    const { error: insErr } = await supabase.from("customer_pay_app_templates").insert([payload]);
    setSaving(false);
    if (insErr) { setError(insErr.message); return; }
    onSaved();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 460, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 20px", fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          Upload Pay App Template
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Label">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. HDSP G702/G703 Blank" style={inputStyle} />
          </Field>
          <Field label="Scope">
            <div style={{ display: "flex", gap: 14 }}>
              <button onClick={() => setScope("customer")} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, border: `2px solid ${scope === "customer" ? C.teal : C.borderStrong}`, background: scope === "customer" ? C.teal : "transparent" }} />
                <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Customer-wide</span>
              </button>
              <button onClick={() => setScope("job")} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                <div style={{ width: 16, height: 16, borderRadius: 8, border: `2px solid ${scope === "job" ? C.teal : C.borderStrong}`, background: scope === "job" ? C.teal : "transparent" }} />
                <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Job-specific</span>
              </button>
            </div>
          </Field>
          {scope === "job" && (
            <Field label="Proposal">
              <select value={proposalId} onChange={e => setProposalId(e.target.value)} style={inputStyle}>
                <option value="">— Select Proposal —</option>
                {proposals.map(p => (
                  <option key={p.id} value={p.id}>
                    {(p.proposal_number || p.id) + " - " + (p.call_log?.job_name || "")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="PDF File">
            <input type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "8px 10px" }} />
          </Field>
          {scope === "customer" && (
            <Field label="Default?">
              <button onClick={() => setIsDefault(!isDefault)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isDefault ? C.teal : C.borderStrong}`, background: isDefault ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {isDefault && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Set as default for this customer</span>
              </button>
            </Field>
          )}
        </div>
        {error && <div style={{ marginTop: 14, color: C.red, fontSize: 13, fontFamily: F.ui }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <Btn v="ghost" sz="sm" onClick={onClose}>Cancel</Btn>
          <Btn sz="sm" onClick={handleSave} disabled={saving}>{saving ? "Uploading..." : "Save"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Pay App Templates Section ─── */
function PayAppTemplatesSection({ customerId, canManage }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("customer_pay_app_templates")
      .select("id, label, scope, pdf_url, is_default, created_at, proposal_id, proposals(proposal_number)")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [customerId]);

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template "${t.label}"?`)) return;
    const { error: delErr } = await supabase.from("customer_pay_app_templates").delete().eq("id", t.id);
    if (delErr) { alert(delErr.message); return; }
    // Best-effort: strip the storage path from the public URL and remove
    try {
      const marker = "/job-attachments/";
      const idx = t.pdf_url?.indexOf(marker);
      if (idx >= 0) {
        const path = t.pdf_url.slice(idx + marker.length);
        await supabase.storage.from("job-attachments").remove([path]);
      }
    } catch (_) { /* ignore */ }
    load();
  };

  const card = { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: 18 };
  const headerStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui };
  const pill = { display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontFamily: F.display };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={headerStyle}>Pay App Templates</div>
        {canManage && <Btn sz="sm" onClick={() => setShowModal(true)}>+ Upload Template</Btn>}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>Loading...</div>
      ) : templates.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No templates uploaded</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {templates.map(t => (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px",
            }}>
              <div style={{ flex: 1, minWidth: 180, fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>
                {t.label || "(untitled)"}
              </div>
              <span style={pill}>{t.scope === "job" ? "Job" : "Customer"}</span>
              {t.scope === "job" && t.proposals?.proposal_number && (
                <span style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui }}>{t.proposals.proposal_number}</span>
              )}
              {t.is_default && <span style={pill}>Default</span>}
              {t.pdf_url && (
                <a href={t.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 700, color: C.tealDark, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase", textDecoration: "none" }}>View</a>
              )}
              {canManage && (
                <button onClick={() => handleDelete(t)} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 4px" }} title="Delete">×</button>
              )}
            </div>
          ))}
        </div>
      )}
      {showModal && (
        <PayAppTemplateModal
          customerId={customerId}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

/* ─── Customer Detail View ─── */
function CustomerDetail({ customer, onBack, onEdit, onNavigateJob, onNavigateProposal, onNavigateInvoice, onDeleted, onMerged }) {
  const [jobs, setJobs]           = useState([]);
  const [proposals, setProposals] = useState([]);
  const [invoices, setInvoices]   = useState([]);
  const [contacts, setContacts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState("jobs");
  const [contactModal, setContactModal] = useState(null); // null | "new" | contact obj
  const [teamMember, setTeamMember] = useState(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const canManage = !!teamMember && ["Admin", "Manager"].includes(teamMember.role);

  async function handleDelete() {
    if (deleting) return;
    // Client-side pre-check: skip the "are you sure" prompt entirely if we
    // already know the delete will be blocked. Server still re-checks inside
    // delete_customer() so this is just UX, not authorization.
    const childCount = jobs.length + contacts.length;
    if (childCount > 0) {
      const parts = [];
      if (jobs.length) parts.push(`${jobs.length} job${jobs.length === 1 ? "" : "s"}`);
      if (contacts.length) parts.push(`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`);
      window.alert(`Can't delete "${customer.name}" — it still has ${parts.join(" and ")} attached. Use Merge to consolidate it into another customer first.`);
      return;
    }
    if (!window.confirm(`Delete customer "${customer.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    const { error: rpcErr } = await supabase.rpc("delete_customer", { p_customer_id: customer.id });
    setDeleting(false);
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("HAS_CHILDREN")) {
        // Postgres exception DETAIL is returned as the second segment of the
        // error string; details vary by PostgREST version. We always have a
        // signal that children exist — show the actionable message.
        window.alert(`This customer can't be deleted because it still has jobs, contacts, or pay-app templates attached. Use Merge to consolidate it into another customer first.`);
      } else if (msg.includes("FORBIDDEN")) {
        window.alert("You don't have permission to delete customers.");
      } else if (msg.includes("NOT_FOUND")) {
        window.alert("Customer no longer exists. Reload and try again.");
      } else if (msg.includes("TENANT_MISMATCH")) {
        window.alert("Customer belongs to a different tenant.");
      } else {
        window.alert(msg || "Delete failed. Try again.");
      }
      return;
    }
    onDeleted?.();
  }

  useEffect(() => { getCurrentTeamMember().then(setTeamMember); }, []);

  const loadContacts = async () => {
    const { data } = await supabase.from("customer_contacts").select("*").eq("customer_id", customer.id).order("is_primary", { ascending: false }).order("name");
    setContacts(data || []);
  };

  useEffect(() => {
    async function load() {
      const [j, p, i] = await Promise.all([
        fetchAll(
          "call_log",
          "id, display_job_number, job_name, stage, sales_name, created_at",
          { filters: [["eq", "customer_id", customer.id]], order: { column: "id", ascending: false } }
        ),
        fetchAll(
          "proposals",
          "id, total, status, created_at, proposal_number, call_log_id, call_log!inner(customer_id), proposal_wtc(work_types(name))",
          { filters: [["is", "deleted_at", null], ["eq", "call_log.customer_id", customer.id]], order: { column: "created_at", ascending: false } }
        ),
        fetchAll(
          "invoices",
          "id, amount, status, sent_at, paid_at, job_id, job_name, invoice_lines(proposal_wtc(work_types(name)))",
          { filters: [["is", "deleted_at", null]], order: { column: "sent_at", ascending: false } }
        ),
      ]);
      const jobIds = new Set(j.map(x => x.id));
      setJobs(j);
      setProposals(p);
      setInvoices(i.filter(inv => jobIds.has(inv.job_id)));
      setLoading(false);
    }
    load();
    loadContacts();
  }, [customer.id]);

  const tabs = [
    { id: "jobs", label: "Jobs", count: jobs.length },
    { id: "proposals", label: "Proposals", count: proposals.length },
    { id: "invoices", label: "Invoices", count: invoices.length },
  ];

  const tabBtnStyle = (active) => ({
    padding: "7px 16px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    background: active ? C.dark : "transparent",
    color: active ? C.teal : C.textMuted,
  });

  const wtNames = (wtcArr) => [...new Set((wtcArr || []).map(w => w.work_types?.name).filter(Boolean))].join(", ");
  const invWtNames = (lines) => [...new Set((lines || []).map(l => l.proposal_wtc?.work_types?.name).filter(Boolean))].join(", ");
  const thStyle = { padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, whiteSpace: "nowrap" };
  const tdBase = { padding: "12px 15px", borderBottom: `1px solid ${C.border}` };

  const termsLabel = customer.billing_terms ? `Net ${customer.billing_terms}` : "—";
  const addr = [customer.business_address, customer.business_city, customer.business_state, customer.business_zip].filter(Boolean).join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ background: "none", border: `1.5px solid ${C.borderStrong}`, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", flex: 1 }}>{customer.name}</h2>
        {canManage && <Btn sz="sm" v="ghost" onClick={() => setMergeOpen(true)} style={{ color: C.amber }}>Merge</Btn>}
        {canManage && <Btn sz="sm" v="ghost" onClick={handleDelete} disabled={deleting} style={{ color: C.red }}>{deleting ? "Deleting…" : "Delete"}</Btn>}
        <Btn sz="sm" v="ghost" onClick={onEdit}>Edit</Btn>
      </div>

      {/* Quick Info */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "14px 18px", background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}` }}>
        {customer.phone && <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody }}><span style={{ color: C.textFaint, fontWeight: 700 }}>Phone:</span> {customer.phone}</div>}
        {customer.email && <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody }}><span style={{ color: C.textFaint, fontWeight: 700 }}>Email:</span> {customer.email}</div>}
        <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody }}><span style={{ color: C.textFaint, fontWeight: 700 }}>Terms:</span> {termsLabel}</div>
        {addr && <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody }}><span style={{ color: C.textFaint, fontWeight: 700 }}>Address:</span> {addr}</div>}
      </div>

      {/* Contacts */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui }}>Contacts</div>
          <Btn sz="sm" onClick={() => setContactModal("new")}>+ Add Contact</Btn>
        </div>
        {contacts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No contacts on file</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {contacts.map(c => (
              <div key={c.id} onClick={() => setContactModal(c)} style={{
                background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "16px 20px",
                cursor: "pointer", position: "relative", display: "flex", flexDirection: "column", gap: 8,
                boxShadow: "0 1px 3px rgba(28,24,20,0.06)",
              }}>
                {c.is_primary && (
                  <div style={{ position: "absolute", top: 12, right: 14, fontSize: 9.5, fontWeight: 800, color: C.teal, background: C.dark, borderRadius: 6, padding: "3px 9px", fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.08em" }}>Primary</div>
                )}
                <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.01em", lineHeight: 1.15, paddingRight: c.is_primary ? 60 : 0 }}>{c.name || "—"}</div>
                {c.role && (
                  <div style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontFamily: F.display }}>{c.role}</div>
                )}
                {(c.phone || c.email) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                    {c.email && <div style={{ fontSize: 12.5, color: C.textBody, fontFamily: F.ui }}>{c.email}</div>}
                    {c.phone && <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui }}>{c.phone}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact Modal */}
      {contactModal && <ContactModal contact={contactModal === "new" ? null : contactModal} customerId={customer.id} canManage={canManage} onClose={() => setContactModal(null)} onSaved={() => { setContactModal(null); loadContacts(); }} />}

      {/* Merge Modal */}
      {mergeOpen && (
        <CustomerMergeModal
          duplicateCustomer={customer}
          onClose={() => setMergeOpen(false)}
          onMerged={(survivorId) => { setMergeOpen(false); onMerged?.(survivorId); }}
        />
      )}

      {/* Pay App Templates */}
      <PayAppTemplatesSection customerId={customer.id} canManage={canManage} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={tabBtnStyle(tab === t.id)}>
            {t.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>({t.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : tab === "jobs" ? (
        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead><tr style={{ background: C.dark }}>
              <th style={thStyle}>Job #</th><th style={thStyle}>Job Name</th><th style={thStyle}>Sales Rep</th><th style={thStyle}>Status</th>
            </tr></thead>
            <tbody>
              {jobs.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: C.textFaint }}>No jobs</td></tr>}
              {jobs.map((j, i) => (
                <tr key={j.id} onClick={() => onNavigateJob && onNavigateJob(j)}
                  style={{ background: i % 2 === 0 ? C.linenLight : C.linen, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                >
                  <td style={{ ...tdBase, fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{j.display_job_number}</td>
                  <td style={{ ...tdBase, color: C.textBody }}>{j.job_name}</td>
                  <td style={{ ...tdBase, color: C.textMuted }}>{j.sales_name || "—"}</td>
                  <td style={tdBase}><span style={{ fontSize: 11, fontWeight: 700, color: stageColor(j.stage), fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.06em" }}>{j.stage}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "proposals" ? (
        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead><tr style={{ background: C.dark }}>
              <th style={thStyle}>Proposal #</th><th style={thStyle}>Work Type</th><th style={thStyle}>Status</th><th style={{ ...thStyle, textAlign: "right" }}>Amount</th><th style={thStyle}>Date</th>
            </tr></thead>
            <tbody>
              {proposals.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: C.textFaint }}>No proposals</td></tr>}
              {proposals.map((p, i) => (
                <tr key={p.id} onClick={() => onNavigateProposal && onNavigateProposal(p.id)}
                  style={{ background: i % 2 === 0 ? C.linenLight : C.linen, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                >
                  <td style={{ ...tdBase, fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{p.proposal_number || p.id}</td>
                  <td style={{ ...tdBase, color: C.textMuted, fontSize: 12 }}>{wtNames(p.proposal_wtc) || "—"}</td>
                  <td style={tdBase}><span style={{ fontSize: 11, fontWeight: 700, color: stageColor(p.status === "Sold" ? "Sold" : p.status === "Lost" ? "Lost" : "Has Bid"), fontFamily: F.display, textTransform: "uppercase" }}>{p.status}</span></td>
                  <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: C.textHead }}>{fmt$(p.total)}</td>
                  <td style={{ ...tdBase, color: C.textMuted }}>{p.created_at ? new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead><tr style={{ background: C.dark }}>
              <th style={thStyle}>Invoice #</th><th style={thStyle}>Job</th><th style={thStyle}>Work Type</th><th style={thStyle}>Status</th><th style={{ ...thStyle, textAlign: "right" }}>Amount</th><th style={thStyle}>Sent</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: C.textFaint }}>No invoices</td></tr>}
              {invoices.map((inv, i) => {
                const statusColor = inv.status === "Paid" ? C.green : inv.status === "Sent" ? C.amber : C.textFaint;
                return (
                  <tr key={inv.id} onClick={() => onNavigateInvoice && onNavigateInvoice(inv.id)}
                    style={{ background: i % 2 === 0 ? C.linenLight : C.linen, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                  >
                    <td style={{ ...tdBase, fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{inv.id}</td>
                    <td style={{ ...tdBase, color: C.textBody }}>{inv.job_name || "—"}</td>
                    <td style={{ ...tdBase, color: C.textMuted, fontSize: 12 }}>{invWtNames(inv.invoice_lines) || "—"}</td>
                    <td style={tdBase}><span style={{ fontSize: 11, fontWeight: 700, color: statusColor, fontFamily: F.display, textTransform: "uppercase" }}>{inv.status}</span></td>
                    <td style={{ ...tdBase, textAlign: "right", fontWeight: 700, color: C.textHead }}>{fmt$(inv.amount)}</td>
                    <td style={{ ...tdBase, color: C.textMuted }}>{inv.sent_at ? new Date(inv.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Main Customers Page ─── */
function matchSearch(c, q) {
  const s = q.toLowerCase();
  return (c.name || "").toLowerCase().includes(s)
    || (c.business_city || "").toLowerCase().includes(s)
    || (c.phone || "").toLowerCase().includes(s)
    || (c.email || "").toLowerCase().includes(s)
    || (c.contact_email || "").toLowerCase().includes(s)
    || (c.first_name || "").toLowerCase().includes(s)
    || (c.last_name || "").toLowerCase().includes(s);
}

export default function Customers({ setSubPage }) {
  const navigate = useNavigate();
  const { id: routeCustomerId } = useParams();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    const PAGE = 1000;
    let all = [], from = 0;
    while (true) {
      const { data } = await supabase.from("customers").select("*").order("name").range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setCustomers(all);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Sync viewing customer with URL :id param
  useEffect(() => {
    if (!routeCustomerId) { setViewing(null); return; }
    if (customers.length === 0) return;
    const match = customers.find(c => c.id === routeCustomerId);
    if (match) setViewing(match);
  }, [routeCustomerId, customers]);

  const termsLabel = (t) => t ? `Net ${t}` : "—";

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(viewing ? "detail" : editing ? "edit" : null);
  }, [viewing, editing]);

  if (viewing) {
    return (
      <>
        <CustomerDetail
          customer={viewing}
          onBack={() => navigate("/customers")}
          onEdit={() => setEditing(viewing)}
          onNavigateJob={(job) => navigate(`/calllog/${job.id}`)}
          onNavigateProposal={(id) => navigate(`/proposals/${id}`)}
          onNavigateInvoice={(id) => navigate(`/invoices/${id}`)}
          onDeleted={() => { setViewing(null); navigate("/customers"); load(); }}
          onMerged={(survivorId) => { setViewing(null); navigate(`/customers/${survivorId}`); load(); }}
        />
        {editing && (
          <CustomerModal
            customer={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); setViewing({ ...viewing }); load(); }}
          />
        )}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Customers" action={<Btn sz="sm" onClick={() => setEditing("new")}>+ Add Customer</Btn>} />

      {/* Search bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, city, phone, or email..."
          style={{
            flex: 1, padding: "9px 14px", borderRadius: 8,
            border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep,
            color: C.textBody, fontSize: 13, fontFamily: F.ui, WebkitAppearance: "none",
          }}
        />
        {search && (
          <span style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, whiteSpace: "nowrap" }}>
            {customers.filter(c => matchSearch(c, search)).length} of {customers.length}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <DataTable
          cols={[
            { k: "name",           l: "Company",       r: v => <span style={{ fontWeight: 800, fontFamily: F.display, letterSpacing: "0.03em" }}>{v}</span> },
            { k: "customer_type",  l: "Type",          r: v => <span style={{ fontSize: 11.5, fontWeight: 700, fontFamily: F.ui, color: v === "Residential" ? C.tealDark : C.purple }}>{v || "—"}</span> },
            { k: "business_city",  l: "City" },
            { k: "phone",          l: "Phone" },
            { k: "billing_terms",  l: "Terms",         r: v => termsLabel(v) },
          ]}
          rows={search ? customers.filter(c => matchSearch(c, search)) : customers}
          onRow={row => navigate(`/customers/${row.id}`)}
        />
      )}

      {editing && (
        <CustomerModal
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
