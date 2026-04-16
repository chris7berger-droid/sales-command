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

function WorkTypesSection() {
  const [workTypes, setWorkTypes]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [tenantId, setTenantId]     = useState(null);
  const [editing, setEditing]       = useState(null); // row being edited (or { isNew:true })
  const [saving, setSaving]         = useState(false);
  const [deleteId, setDeleteId]     = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: tc } = await supabase.from("tenant_config").select("id").single();
    if (tc) setTenantId(tc.id);
    const { data } = await supabase
      .from("work_types")
      .select("id, name, cost_code, sales_sow, sort_order")
      .not("tenant_id", "is", null)
      .order("name");
    if (data) setWorkTypes(data);
    setLoading(false);
  }

  const startNew  = () => setEditing({ isNew: true, name: "", cost_code: "", sales_sow: "" });
  const startEdit = (wt) => setEditing({ ...wt });
  const cancel    = () => setEditing(null);

  async function save() {
    if (!editing.name.trim()) return;
    setSaving(true);
    if (editing.isNew) {
      await supabase.from("work_types").insert({
        name: editing.name.trim(),
        cost_code: editing.cost_code.trim(),
        sales_sow: editing.sales_sow.trim() || null,
        tenant_id: tenantId,
        active: true,
      });
    } else {
      await supabase.from("work_types").update({
        name: editing.name.trim(),
        cost_code: editing.cost_code.trim(),
        sales_sow: editing.sales_sow.trim() || null,
      }).eq("id", editing.id);
    }
    setSaving(false);
    setEditing(null);
    load();
  }

  async function remove(id) {
    setDeleteId(id);
    await supabase.from("work_types").delete().eq("id", id);
    setDeleteId(null);
    load();
  }

  const rowStyle = { display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 12, alignItems: "center", padding: "10px 14px", borderRadius: 8, background: C.linenDeep, border: `1px solid ${C.borderStrong}` };
  const colHead  = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui };

  if (loading) return <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Column headers */}
      {workTypes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 12, padding: "0 14px" }}>
          <span style={colHead}>Work Type Name</span>
          <span style={colHead}>Cost Code</span>
          <span style={{ ...colHead, minWidth: 80 }} />
        </div>
      )}

      {/* Existing rows */}
      {workTypes.map(wt =>
        editing && !editing.isNew && editing.id === wt.id ? (
          <EditRow key={wt.id} editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} inputStyle={inputStyle} />
        ) : (
          <div key={wt.id} style={rowStyle}>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textBody }}>{wt.name}</span>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textMuted }}>{wt.cost_code || "—"}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn sz="sm" v="ghost" onClick={() => startEdit(wt)}>Edit</Btn>
              <Btn sz="sm" v="ghost" onClick={() => remove(wt.id)} disabled={deleteId === wt.id}>
                {deleteId === wt.id ? "…" : "Delete"}
              </Btn>
            </div>
          </div>
        )
      )}

      {/* New row form */}
      {editing?.isNew && (
        <EditRow editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} inputStyle={inputStyle} />
      )}

      {!workTypes.length && !editing && (
        <div style={{ fontSize: 13, fontFamily: F.ui, color: C.textFaint, padding: "10px 0" }}>
          No work types yet. Add your first one below.
        </div>
      )}

      {/* Add button */}
      {!editing && (
        <div style={{ marginTop: 4 }}>
          <Btn sz="sm" onClick={startNew}>+ Add Work Type</Btn>
        </div>
      )}
    </div>
  );
}

function EditRow({ editing, setEditing, onSave, onCancel, saving, inputStyle }) {
  const set = (k, v) => setEditing(e => ({ ...e, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 8, background: C.linenCard, border: `1px solid ${C.tealBorder}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12 }}>
        <div>
          <div style={labelStyle}>Work Type Name</div>
          <input
            style={inputStyle}
            value={editing.name}
            onChange={e => set("name", e.target.value)}
            placeholder="e.g. Concrete Coating"
            autoFocus
          />
        </div>
        <div>
          <div style={labelStyle}>Cost Code</div>
          <input
            style={inputStyle}
            value={editing.cost_code}
            onChange={e => set("cost_code", e.target.value)}
            placeholder="e.g. 0916.1"
          />
        </div>
      </div>
      <div>
        <div style={labelStyle}>Default Sales SOW</div>
        <textarea
          style={{ ...inputStyle, minHeight: 80, resize: "vertical", lineHeight: 1.5 }}
          value={editing.sales_sow}
          onChange={e => set("sales_sow", e.target.value)}
          placeholder="Default scope of work text for proposals (optional)"
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn sz="sm" onClick={onSave} disabled={saving || !editing.name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Btn>
        <Btn sz="sm" v="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
      </div>
    </div>
  );
}

function MaterialsCatalogSection() {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [tenantId, setTenantId] = useState(null);
  const [editing, setEditing]   = useState(null);
  const [saving, setSaving]     = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: tc } = await supabase.from("tenant_config").select("id").single();
    if (tc) setTenantId(tc.id);
    const { data } = await supabase
      .from("materials_catalog")
      .select("id, name, kit_size, price, coverage, supplier")
      .not("tenant_id", "is", null)
      .order("name");
    if (data) setRows(data);
    setLoading(false);
  }

  const startNew  = () => setEditing({ isNew: true, name: "", kit_size: "", price: "", coverage: "", supplier: "" });
  const startEdit = (r) => setEditing({ ...r, price: r.price == null ? "" : String(r.price) });
  const cancel    = () => setEditing(null);

  async function save() {
    if (!editing.name.trim()) return;
    setSaving(true);
    const payload = {
      name:      editing.name.trim(),
      kit_size:  editing.kit_size.trim() || null,
      price:     parseFloat(editing.price) || 0,
      coverage:  editing.coverage.trim() || null,
      supplier:  editing.supplier.trim() || null,
    };
    if (editing.isNew) {
      await supabase.from("materials_catalog").insert({ ...payload, tenant_id: tenantId, active: true });
    } else {
      await supabase.from("materials_catalog").update(payload).eq("id", editing.id);
    }
    setSaving(false);
    setEditing(null);
    load();
  }

  async function remove(id) {
    setDeleteId(id);
    await supabase.from("materials_catalog").delete().eq("id", id);
    setDeleteId(null);
    load();
  }

  const rowStyle = { display: "grid", gridTemplateColumns: "1.6fr 1fr 100px auto", gap: 12, alignItems: "center", padding: "10px 14px", borderRadius: 8, background: C.linenDeep, border: `1px solid ${C.borderStrong}` };
  const colHead  = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui };

  if (loading) return <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textMuted, marginBottom: 4 }}>
        Your tenant’s custom materials. The 159 built-in products stay available in the WTC picker — this list adds to (and can override) them.
      </div>

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 100px auto", gap: 12, padding: "0 14px" }}>
          <span style={colHead}>Material</span>
          <span style={colHead}>Kit Size</span>
          <span style={colHead}>Price</span>
          <span style={{ ...colHead, minWidth: 80 }} />
        </div>
      )}

      {rows.map(r =>
        editing && !editing.isNew && editing.id === r.id ? (
          <MaterialEditRow key={r.id} editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} />
        ) : (
          <div key={r.id} style={rowStyle}>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textBody }}>{r.name}</span>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textMuted }}>{r.kit_size || "—"}</span>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textBody }}>{fmt$(r.price || 0)}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn sz="sm" v="ghost" onClick={() => startEdit(r)}>Edit</Btn>
              <Btn sz="sm" v="ghost" onClick={() => remove(r.id)} disabled={deleteId === r.id}>
                {deleteId === r.id ? "…" : "Delete"}
              </Btn>
            </div>
          </div>
        )
      )}

      {editing?.isNew && (
        <MaterialEditRow editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} />
      )}

      {!rows.length && !editing && (
        <div style={{ fontSize: 13, fontFamily: F.ui, color: C.textFaint, padding: "10px 0" }}>
          No custom materials yet. Add one to reuse it on every future WTC.
        </div>
      )}

      {!editing && (
        <div style={{ marginTop: 4 }}>
          <Btn sz="sm" onClick={startNew}>+ Add Material</Btn>
        </div>
      )}
    </div>
  );
}

function MaterialEditRow({ editing, setEditing, onSave, onCancel, saving }) {
  const set = (k, v) => setEditing(e => ({ ...e, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 8, background: C.linenCard, border: `1px solid ${C.tealBorder}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 12 }}>
        <div>
          <div style={labelStyle}>Material Name</div>
          <input style={inputStyle} value={editing.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Key Resins 502" autoFocus />
        </div>
        <div>
          <div style={labelStyle}>Kit Size</div>
          <input style={inputStyle} value={editing.kit_size} onChange={e => set("kit_size", e.target.value)} placeholder="e.g. 3 gallon" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", gap: 12 }}>
        <div>
          <div style={labelStyle}>Price</div>
          <input style={inputStyle} type="number" step="0.01" value={editing.price} onChange={e => set("price", e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <div style={labelStyle}>Coverage (optional)</div>
          <input style={inputStyle} value={editing.coverage} onChange={e => set("coverage", e.target.value)} placeholder="e.g. 200 Sqft/gal" />
        </div>
        <div>
          <div style={labelStyle}>Supplier (optional)</div>
          <input style={inputStyle} value={editing.supplier} onChange={e => set("supplier", e.target.value)} placeholder="e.g. CSS" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn sz="sm" onClick={onSave} disabled={saving || !editing.name.trim()}>
          {saving ? "Saving…" : "Save"}
        </Btn>
        <Btn sz="sm" v="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
      </div>
    </div>
  );
}

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

const APP_LABELS = { sales: "Sales Command", schedule: "Schedule Command" };
const DEPLOYED_APPS = ["sales", "schedule"];
const PRICE_PER_APP = 699;
const BUNDLE_DISCOUNT = 0.107;

function BillingSection() {
  const [status, setStatus] = useState(null); // null=loading
  const [loading, setLoading] = useState(true);
  const [selectedApps, setSelectedApps] = useState(["sales"]);
  const [actionLoading, setActionLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("create-billing-session", {
          body: { action: "status" },
        });
        if (error) throw error;
        setStatus(data);
        if (data?.subscribed_apps?.length) setSelectedApps(data.subscribed_apps);
      } catch (e) {
        console.error("Failed to load billing status:", e);
      }
      setLoading(false);
    })();
  }, []);

  const hasSubscription = status?.subscription_status === "active" || status?.subscription_status === "past_due";

  const toggleApp = (app) => {
    setSelectedApps(prev =>
      prev.includes(app) ? prev.filter(a => a !== app) : [...prev, app]
    );
  };

  const subtotal = selectedApps.length * PRICE_PER_APP;
  const discountAmt = selectedApps.length >= 2 ? subtotal * BUNDLE_DISCOUNT : 0;
  const total = subtotal - discountAmt;

  const handleCheckout = async () => {
    if (!selectedApps.length) return;
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-session", {
        body: { action: "checkout", apps: selectedApps },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e) {
      alert("Failed to start checkout: " + e.message);
    }
    setActionLoading(false);
  };

  const handlePortal = async () => {
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-session", {
        body: { action: "portal" },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e) {
      alert("Failed to open billing portal: " + e.message);
    }
    setActionLoading(false);
  };

  if (loading) return <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "12px 0" }}>Loading billing...</div>;

  const statusColor = status?.subscription_status === "active" ? C.green : status?.subscription_status === "past_due" ? C.orange : C.red;
  const statusLabel = status?.subscription_status === "active" ? "Active" : status?.subscription_status === "past_due" ? "Past Due" : status?.subscription_status === "canceled" ? "Canceled" : "No Subscription";

  return (
    <div style={{ background: C.linenCard, borderRadius: 12, border: `1px solid ${C.borderStrong}`, padding: "24px 28px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textHead }}>
          Subscription Plan
        </div>
        {hasSubscription && (
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
            color: statusColor, background: C.dark, borderRadius: 4, padding: "3px 10px", fontFamily: F.ui,
          }}>
            {statusLabel}
          </span>
        )}
      </div>

      {/* App list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {DEPLOYED_APPS.map(app => {
          const isSubscribed = hasSubscription && status?.subscribed_apps?.includes(app);
          const isSelected = selectedApps.includes(app);

          return (
            <div key={app} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 18px", borderRadius: 10,
              background: isSubscribed ? "rgba(48,207,172,0.06)" : C.linenDeep,
              border: `1px solid ${isSubscribed ? C.tealBorder : C.borderStrong}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {!hasSubscription && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleApp(app)}
                    style={{ width: 16, height: 16, accentColor: C.teal }}
                  />
                )}
                <div>
                  <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: C.textHead }}>
                    {APP_LABELS[app]}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: F.ui, fontSize: 14, fontWeight: 700, color: C.textBody }}>$699/mo</span>
                {isSubscribed && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    color: C.teal, background: C.dark, borderRadius: 4, padding: "2px 8px", fontFamily: F.ui,
                  }}>
                    Subscribed
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pricing summary */}
      <div style={{
        borderTop: `1px solid ${C.borderStrong}`, paddingTop: 16, marginBottom: 20,
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {selectedApps.length > 0 && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.ui, fontSize: 13, color: C.textMuted }}>
              <span>Subtotal ({selectedApps.length} app{selectedApps.length > 1 ? "s" : ""})</span>
              <span>${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}/mo</span>
            </div>
            {discountAmt > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.ui, fontSize: 13, color: C.green }}>
                <span>Bundle Discount (10.7%)</span>
                <span>-${discountAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}/mo</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.display, fontSize: 16, fontWeight: 800, color: C.textHead, marginTop: 4 }}>
              <span>Monthly Total</span>
              <span>${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}/mo</span>
            </div>
          </>
        )}
      </div>

      {/* Terms agreement (only shown before subscribing) */}
      {!hasSubscription && (
        <label style={{
          display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, cursor: "pointer",
          fontFamily: F.ui, fontSize: 12, color: C.textMuted, lineHeight: 1.5,
        }}>
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={e => setAgreedToTerms(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: C.teal, marginTop: 2, flexShrink: 0 }}
          />
          <span>
            I have read and agree to the{" "}
            <a href="https://www.sccmybiz.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: C.teal, fontWeight: 600, textDecoration: "none" }}>
              Command Suite Terms of Service
            </a>
            , including the binding arbitration clause, class action waiver, limitation of liability, and construction-specific disclaimers. Billing begins immediately and recurs monthly until canceled.
          </span>
        </label>
      )}

      {/* Actions */}
      {hasSubscription ? (
        <Btn sz="sm" onClick={handlePortal} disabled={actionLoading}>
          {actionLoading ? "Opening..." : "Manage Subscription"}
        </Btn>
      ) : (
        <Btn sz="sm" onClick={handleCheckout} disabled={actionLoading || !selectedApps.length || !agreedToTerms}>
          {actionLoading ? "Loading..." : "Subscribe"}
        </Btn>
      )}

      {/* Billing entity */}
      <div style={{ marginTop: 16, fontFamily: F.ui, fontSize: 11, color: C.textFaint }}>
        Billed by Sub Con Command LLC
      </div>
    </div>
  );
}

export default function Settings({ userRole }) {
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

      {/* ─── Work Types ─── */}
      <div style={sectionStyle}>Work Types</div>
      <WorkTypesSection />

      {/* ─── Materials Catalog ─── */}
      <div style={sectionStyle}>Materials Catalog</div>
      <MaterialsCatalogSection />

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

      {/* ─── Billing (Admin only) ─── */}
      {userRole === "Admin" && (
        <>
          <div style={sectionStyle}>Billing</div>
          <BillingSection />
        </>
      )}

      {/* ─── Integrations ─── */}
      <div style={sectionStyle}>Integrations</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <QBIntegrationCard />
        <div style={{ background: C.linenCard, borderRadius: 10, border: `1px solid ${C.borderStrong}`, padding: "16px 20px", flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.ui }}>Stripe</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.dark, borderRadius: 4, padding: "2px 8px", fontFamily: F.ui, letterSpacing: "0.05em", textTransform: "uppercase" }}>Connected</span>
          </div>
          <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textMuted }}>Customers can pay invoices online via Stripe.</div>
        </div>
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}
