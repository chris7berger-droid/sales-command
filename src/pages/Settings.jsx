import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { getTenantConfig, updateTenantConfig } from "../lib/config";
import { fmt$ } from "../lib/utils";
import SectionHeader from "../components/SectionHeader";
import Btn from "../components/Btn";

const inputStyle = { width: "100%", padding: "9px 12px", borderRadius: 7, border: `1px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 13, fontFamily: F.ui, WebkitAppearance: "none" };
const labelStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4 };
const sectionStyle = { fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textHead, fontFamily: F.display, marginTop: 28, marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid ${C.borderStrong}` };

function Field({ label, children, wide, triple }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : triple ? "auto" : undefined }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

const STD_TERMS = [5, 15, 30, 45, 60, 90, 120];

const QB_CLIENT_ID = "ABg3H5TIV6XdDtSWlJXDC3rM7u8zKI3k5yHlbUaIrIiYNiUmc7";
const QB_REDIRECT_URI = "https://www.scmybiz.com/qb/callback";
const QB_AUTH_URL = `https://appcenter.intuit.com/connect/oauth2?client_id=${QB_CLIENT_ID}&redirect_uri=${encodeURIComponent(QB_REDIRECT_URI)}&response_type=code&scope=com.intuit.quickbooks.accounting&state=salescommand`;

function QBIntegrationCard() {
  const [status, setStatus] = useState(null); // null=loading, true=connected, false=disconnected
  const [realmId, setRealmId] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("qb-auth", { body: { action: "status" } });
      setStatus(data?.connected || false);
      setRealmId(data?.realm_id || null);
    })();
  }, []);

  return (
    <div style={{ background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}`, padding: "16px 20px", flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui }}>QuickBooks</div>
        {status === null ? (
          <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Checking…</span>
        ) : status ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.dark, borderRadius: 4, padding: "2px 8px", fontFamily: F.ui, letterSpacing: "0.05em", textTransform: "uppercase" }}>Connected</span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, color: C.red, background: C.dark, borderRadius: 4, padding: "2px 8px", fontFamily: F.ui, letterSpacing: "0.05em", textTransform: "uppercase" }}>Disconnected</span>
        )}
      </div>
      {status && realmId && (
        <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginBottom: 8 }}>Realm ID: {realmId}</div>
      )}
      <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textMuted, marginBottom: 12 }}>
        {status ? "Invoices and customers sync to QuickBooks Online." : "Connect to sync invoices and customers."}
      </div>
      {status ? (
        <a href={QB_AUTH_URL} style={{ fontSize: 11, fontWeight: 700, color: C.tealDark, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", textDecoration: "none" }}>
          Reconnect
        </a>
      ) : (
        <a href={QB_AUTH_URL} style={{ display: "inline-block", background: C.teal, color: C.dark, borderRadius: 6, padding: "6px 14px", fontSize: 11, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
          Connect to QuickBooks
        </a>
      )}
    </div>
  );
}

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getTenantConfig().then(cfg => setForm({ ...cfg }));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { id, created_at, updated_at, ...fields } = form;
      await updateTenantConfig({
        ...fields,
        default_burden_rate: parseFloat(fields.default_burden_rate) || 0,
        default_ot_burden_rate: parseFloat(fields.default_ot_burden_rate) || 0,
        default_tax_rate: parseFloat(fields.default_tax_rate) || 0,
        default_billing_terms: parseInt(fields.default_billing_terms) || 30,
        proposal_validity_days: parseInt(fields.proposal_validity_days) || 90,
        monthly_billing_goal: parseFloat(fields.monthly_billing_goal) || 0,
        yearly_billing_goal: parseFloat(fields.yearly_billing_goal) || 0,
        conversion_rate_goal: parseFloat(fields.conversion_rate_goal) || 0,
        proposals_sent_goal: parseInt(fields.proposals_sent_goal) || 0,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  if (!form) return <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13, padding: 20 }}>Loading...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 900 }}>
      <SectionHeader title="Settings" action={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: F.ui }}>Saved</span>}
          {error && <span style={{ fontSize: 12, fontWeight: 700, color: C.red, fontFamily: F.ui }}>{error}</span>}
          <Btn sz="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Btn>
        </div>
      } />

      {/* ─── Company Info ─── */}
      <div style={sectionStyle}>Company Info</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Company Name" wide>
          <input style={inputStyle} value={form.company_name} onChange={e => set("company_name", e.target.value)} />
        </Field>
        <Field label="Tagline" wide>
          <input style={inputStyle} value={form.tagline} onChange={e => set("tagline", e.target.value)} placeholder="e.g. Industrial & Commercial Concrete Coatings" />
        </Field>
        <Field label="Logo URL" wide>
          <input style={inputStyle} value={form.logo_url || ""} onChange={e => set("logo_url", e.target.value)} placeholder="/hdsp-logo.png or https://..." />
        </Field>
        <Field label="License Number">
          <input style={inputStyle} value={form.license_number} onChange={e => set("license_number", e.target.value)} />
        </Field>
        <Field label="Phone">
          <input style={inputStyle} value={form.phone} onChange={e => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <input style={inputStyle} value={form.email} onChange={e => set("email", e.target.value)} />
        </Field>
        <Field label="Website">
          <input style={inputStyle} value={form.website} onChange={e => set("website", e.target.value)} />
        </Field>
        <Field label="Address" wide>
          <input style={inputStyle} value={form.address} onChange={e => set("address", e.target.value)} />
        </Field>
        <Field label="City">
          <input style={inputStyle} value={form.city} onChange={e => set("city", e.target.value)} />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="State">
            <input style={inputStyle} value={form.state} onChange={e => set("state", e.target.value)} maxLength={2} />
          </Field>
          <Field label="Zip">
            <input style={inputStyle} value={form.zip} onChange={e => set("zip", e.target.value)} />
          </Field>
        </div>
      </div>

      {/* ─── Financial Defaults ─── */}
      <div style={sectionStyle}>Financial Defaults</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Default Burden Rate ($/hr)">
          <input style={inputStyle} type="number" step="0.01" value={form.default_burden_rate} onChange={e => set("default_burden_rate", e.target.value)} />
        </Field>
        <Field label="Default OT Burden Rate ($/hr)">
          <input style={inputStyle} type="number" step="0.01" value={form.default_ot_burden_rate} onChange={e => set("default_ot_burden_rate", e.target.value)} />
        </Field>
        <Field label="Default Tax Rate (%)">
          <input style={inputStyle} type="number" step="0.01" value={form.default_tax_rate} onChange={e => set("default_tax_rate", e.target.value)} />
        </Field>
        <Field label="Default Billing Terms">
          <select style={inputStyle} value={form.default_billing_terms} onChange={e => set("default_billing_terms", e.target.value)}>
            {STD_TERMS.map(t => <option key={t} value={t}>Net {t}</option>)}
          </select>
        </Field>
        <Field label="Proposal Validity (days)">
          <input style={inputStyle} type="number" value={form.proposal_validity_days} onChange={e => set("proposal_validity_days", e.target.value)} />
        </Field>
      </div>

      {/* ─── Sales Goals ─── */}
      <div style={sectionStyle}>Sales Goals</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Monthly Billing Goal ($)">
          <input style={inputStyle} type="number" value={form.monthly_billing_goal} onChange={e => set("monthly_billing_goal", e.target.value)} />
        </Field>
        <Field label="Yearly Billing Goal ($)">
          <input style={inputStyle} type="number" value={form.yearly_billing_goal} onChange={e => set("yearly_billing_goal", e.target.value)} />
        </Field>
        <Field label="Conversion Rate Goal (%)">
          <input style={inputStyle} type="number" step="1" value={form.conversion_rate_goal} onChange={e => set("conversion_rate_goal", e.target.value)} />
        </Field>
        <Field label="Proposals Sent Goal (per month)">
          <input style={inputStyle} type="number" value={form.proposals_sent_goal} onChange={e => set("proposals_sent_goal", e.target.value)} />
        </Field>
      </div>

      {/* ─── Integrations ─── */}
      <div style={sectionStyle}>Integrations</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <QBIntegrationCard />
        <div style={{ background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}`, padding: "16px 20px", flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>Stripe</div>
          <div style={{ fontSize: 13, fontFamily: F.ui, color: C.textMuted }}>Coming soon</div>
        </div>
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}
