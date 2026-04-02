import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { supabase } from "../lib/supabase";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Btn from "../components/Btn";

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
    contact_phone:    customer?.contact_phone      || "",
    contact_email:    customer?.contact_email      || "",
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
      phone: form.phone || null, email: form.email || null, contact_phone: form.contact_phone || null, contact_email: form.contact_email || null,
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
          <Field label="Phone"><input value={form.phone} onChange={e => set("phone", e.target.value)} style={inputStyle} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={e => set("email", e.target.value)} style={inputStyle} /></Field>
          <Field label="Contact Phone"><input value={form.contact_phone} onChange={e => set("contact_phone", e.target.value)} style={inputStyle} /></Field>
          <Field label="Contact Email"><input type="email" value={form.contact_email} onChange={e => set("contact_email", e.target.value)} style={inputStyle} /></Field>
          <Field label="Billing Contact Same?" wide>
            <button onClick={() => set("billing_same", !form.billing_same)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${form.billing_same ? C.teal : C.borderStrong}`, background: form.billing_same ? C.teal : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {form.billing_same && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{ fontSize: 13, color: C.textBody, fontFamily: F.ui }}>Billing contact is the same</span>
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
function ContactModal({ contact, customerId, onClose, onSaved }) {
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
            {!isNew && <Btn v="ghost" sz="sm" onClick={handleDelete} style={{ color: C.red }}>Delete</Btn>}
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

/* ─── Customer Detail View ─── */
function CustomerDetail({ customer, onBack, onEdit, onNavigateJob, onNavigateProposal, onNavigateInvoice }) {
  const [jobs, setJobs]           = useState([]);
  const [proposals, setProposals] = useState([]);
  const [invoices, setInvoices]   = useState([]);
  const [contacts, setContacts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState("jobs");
  const [contactModal, setContactModal] = useState(null); // null | "new" | contact obj

  const loadContacts = async () => {
    const { data } = await supabase.from("customer_contacts").select("*").eq("customer_id", customer.id).order("is_primary", { ascending: false }).order("name");
    setContacts(data || []);
  };

  useEffect(() => {
    async function load() {
      const [{ data: j }, { data: p }, { data: i }] = await Promise.all([
        supabase.from("call_log").select("id, display_job_number, job_name, stage, sales_name, created_at").eq("customer_id", customer.id).order("id", { ascending: false }),
        supabase.from("proposals").select("id, total, status, created_at, proposal_number, call_log_id, call_log!inner(customer_id), proposal_wtc(work_types(name))").eq("call_log.customer_id", customer.id).order("created_at", { ascending: false }),
        supabase.from("invoices").select("id, amount, status, sent_at, paid_at, job_id, job_name, invoice_lines(proposal_wtc(work_types(name)))").order("sent_at", { ascending: false }),
      ]);
      const jobIds = new Set((j || []).map(x => x.id));
      setJobs(j || []);
      setProposals(p || []);
      setInvoices((i || []).filter(inv => jobIds.has(inv.job_id)));
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
          <Btn sz="sm" v="ghost" onClick={() => setContactModal("new")}>+ Add Contact</Btn>
        </div>
        {contacts.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, fontStyle: "italic" }}>No contacts on file</div>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {contacts.map(c => (
              <div key={c.id} onClick={() => setContactModal(c)} style={{
                background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "12px 16px",
                minWidth: 200, cursor: "pointer", position: "relative",
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.display, marginBottom: 2 }}>{c.name || "—"}</div>
                {c.role && (
                  <div style={{ display: "inline-block", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    background: C.dark, color: C.teal, borderRadius: 4, padding: "2px 7px", fontFamily: F.display, marginBottom: 4 }}>{c.role}</div>
                )}
                {c.phone && <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui }}>{c.phone}</div>}
                {c.email && <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui }}>{c.email}</div>}
                {c.is_primary && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 9, fontWeight: 700, color: C.teal, fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.08em" }}>Primary</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact Modal */}
      {contactModal && <ContactModal contact={contactModal === "new" ? null : contactModal} customerId={customer.id} onClose={() => setContactModal(null)} onSaved={() => { setContactModal(null); loadContacts(); }} />}

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
export default function Customers({ setActive, setInitialProposal, setInitialInvoiceId, initialCustomerId, onClearInitialCustomer, setSubPage }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("name");
    setCustomers(data || []);
    setLoading(false);
    // Auto-open customer if navigated from another page
    if (initialCustomerId && data) {
      const match = data.find(c => c.id === initialCustomerId);
      if (match) setViewing(match);
      if (onClearInitialCustomer) onClearInitialCustomer();
    }
  };

  useEffect(() => { load(); }, []);

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
          onBack={() => setViewing(null)}
          onEdit={() => setEditing(viewing)}
          onNavigateJob={(job) => {
            // Navigate to call log with this job selected
            if (setActive) setActive("calllog");
          }}
          onNavigateProposal={(id) => {
            if (setInitialProposal) setInitialProposal({ openId: id });
            if (setActive) setActive("proposals");
          }}
          onNavigateInvoice={(id) => {
            if (setInitialInvoiceId) setInitialInvoiceId(id);
            if (setActive) setActive("invoices");
          }}
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
          rows={customers}
          onRow={row => setViewing(row)}
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
