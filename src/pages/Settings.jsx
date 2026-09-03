import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { getTenantConfig, updateTenantConfig } from "../lib/config";
import { saveCatalogRow, catalogErrorMessage } from "../lib/materialsCatalog";
import { selectableWorkTypes } from "../lib/workTypes";
import { fmt$ } from "../lib/utils";
import SectionHeader from "../components/SectionHeader";
import Btn from "../components/Btn";
import Checkbox from "../components/Checkbox";

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

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div style={{ ...sectionStyle, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", userSelect: "none" }} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span style={{ fontSize: 11, color: C.textFaint, fontWeight: 600, transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>&#9660;</span>
      </div>
      {open && children}
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
  const [removeError, setRemoveError] = useState(null);
  const [saveError, setSaveError]   = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: tc } = await supabase.from("tenant_config").select("id").single();
    if (tc) setTenantId(tc.id);
    const { data } = await supabase
      .from("work_types")
      .select("id, name, cost_code, sales_sow, sort_order, tenant_id, active")
      .order("name");
    if (data) {
      // Tenant-owned and not retired — system defaults carry no SOW and are redundant here
      setWorkTypes(selectableWorkTypes(data));
    }
    setLoading(false);
  }

  const startNew  = () => { setSaveError(null); setEditing({ isNew: true, name: "", cost_code: "", sales_sow: "" }); };
  const startEdit = (wt) => { setSaveError(null); setEditing({ ...wt }); };
  const cancel    = () => { setSaveError(null); setEditing(null); };

  async function save() {
    if (!editing.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    // A new work type MUST carry the tenant_id — the INSERT RLS policy checks
    // tenant_id = get_user_tenant_id(), so an insert with a null tenant is
    // rejected. Don't let it fail silently: without this guard a failed
    // tenant_config load closes the form and shows nothing, which reads as
    // "I can't add a work type."
    if (editing.isNew && !tenantId) {
      setSaving(false);
      setSaveError("Couldn't determine your company — reload the page and try again.");
      return;
    }
    // .select() so an RLS block or constraint violation comes back as an error
    // (or zero rows) instead of a silent no-op — same pattern as remove().
    const { data, error } = editing.isNew
      ? await supabase.from("work_types").insert({
          name: editing.name.trim(),
          cost_code: editing.cost_code.trim(),
          sales_sow: editing.sales_sow.trim() || null,
          tenant_id: tenantId,
          active: true,
        }).select("id")
      : await supabase.from("work_types").update({
          name: editing.name.trim(),
          cost_code: editing.cost_code.trim(),
          sales_sow: editing.sales_sow.trim() || null,
        }).eq("id", editing.id).select("id");
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    if (!data?.length) {
      setSaveError("Nothing was saved — your account may not have permission to manage work types.");
      return;
    }
    setEditing(null);
    load();
  }

  async function remove(id) {
    setDeleteId(id);
    setRemoveError(null);
    // .select() so an RLS block shows up as zero rows returned rather than a silent no-op
    const { data: deleted, error } = await supabase.from("work_types").delete().eq("id", id).select("id");
    setDeleteId(null);
    if (error) {
      setRemoveError(
        error.code === "23503"
          ? "This work type is still attached to a job or a proposal work type card — including deleted proposals, which stay in the database. Clear it there first."
          : error.message
      );
      return;
    }
    if (!deleted?.length) {
      setRemoveError("Nothing was deleted — your account may not have permission to remove this work type.");
      return;
    }
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
          <EditRow key={wt.id} editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} saveError={saveError} inputStyle={inputStyle} />
        ) : (
          <div key={wt.id} style={rowStyle}>
            <span style={{ fontSize: 13, fontFamily: F.ui, color: C.textBody, display: "flex", alignItems: "center", gap: 10 }}>
              {wt.name}
              <span style={{ fontSize: 9, fontWeight: 700, color: C.teal, background: C.dark, borderRadius: 4, padding: "2px 6px", fontFamily: F.ui, letterSpacing: "0.05em", textTransform: "uppercase" }}>Custom</span>
            </span>
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
        <EditRow editing={editing} setEditing={setEditing} onSave={save} onCancel={cancel} saving={saving} saveError={saveError} inputStyle={inputStyle} />
      )}

      {!workTypes.length && !editing && (
        <div style={{ fontSize: 13, fontFamily: F.ui, color: C.textFaint, padding: "10px 0" }}>
          No work types yet. Add your first one below.
        </div>
      )}

      {removeError && (
        <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody, background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${C.teal}`, borderRadius: 8, padding: "10px 14px", lineHeight: 1.5 }}>
          {removeError}
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

function EditRow({ editing, setEditing, onSave, onCancel, saving, saveError, inputStyle }) {
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
      {saveError && (
        <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody, background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${C.red}`, borderRadius: 8, padding: "10px 14px", lineHeight: 1.5 }}>
          {saveError}
        </div>
      )}
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
      .select("id, tenant_id, name, kit_size, price, coverage, supplier, mils, mix_time, mix_speed, cure_time, unit, specs_updated_at")
      .not("tenant_id", "is", null)
      .order("name");
    if (data) setRows(data);
    setLoading(false);
  }

  const startNew  = () => setEditing({ isNew: true, name: "", kit_size: "", price: "", coverage: "", supplier: "", mils: "", mix_time: "", mix_speed: "", cure_time: "", unit: "" });
  const startEdit = (r) => setEditing({ ...r, price: r.price == null ? "" : String(r.price), _orig: r });
  const cancel    = () => setEditing(null);

  async function save() {
    if (!editing.name.trim()) return;
    setSaving(true);
    try {
      // Shared write path: INSERT-stamp + fork-on-edit + 0-rows/23505 handling.
      await saveCatalogRow({
        original: editing.isNew ? null : (editing._orig ?? editing),
        values: editing,
        tenantId,
      });
      setEditing(null);
      load();
    } catch (e) {
      alert("Could not save material: " + catalogErrorMessage(e));
    } finally {
      setSaving(false);
    }
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
      {/* Application specs (text) — flow to the SOW stamp + crew ticket */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12 }}>
        <div>
          <div style={labelStyle}>Mils</div>
          <input style={inputStyle} value={editing.mils || ""} onChange={e => set("mils", e.target.value)} placeholder="20-25" />
        </div>
        <div>
          <div style={labelStyle}>Mix Time</div>
          <input style={inputStyle} value={editing.mix_time || ""} onChange={e => set("mix_time", e.target.value)} placeholder="3 min" />
        </div>
        <div>
          <div style={labelStyle}>Mix Speed</div>
          <input style={inputStyle} value={editing.mix_speed || ""} onChange={e => set("mix_speed", e.target.value)} placeholder="Low" />
        </div>
        <div>
          <div style={labelStyle}>Cure Time</div>
          <input style={inputStyle} value={editing.cure_time || ""} onChange={e => set("cure_time", e.target.value)} placeholder="24 hrs" />
        </div>
        <div>
          <div style={labelStyle}>Unit</div>
          <input style={inputStyle} value={editing.unit || ""} onChange={e => set("unit", e.target.value)} placeholder="kit" />
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
        // billing status load failed — non-critical
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
                  <Checkbox checked={isSelected} onChange={() => toggleApp(app)} size={16} />
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
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16,
          fontFamily: F.ui, fontSize: 12, color: C.textMuted, lineHeight: 1.5,
        }}>
          <Checkbox checked={agreedToTerms} onChange={setAgreedToTerms} size={16} style={{ marginTop: 2 }} />
          <span>
            I have read and agree to the{" "}
            <a href="https://www.sccmybiz.com/terms" target="_blank" rel="noopener noreferrer" style={{ color: C.teal, fontWeight: 600, textDecoration: "none" }}>
              Command Suite Terms of Service
            </a>
            , including the binding arbitration clause, class action waiver, limitation of liability, and construction-specific disclaimers. Billing begins immediately and recurs monthly until canceled.
          </span>
        </div>
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
  const canManage = userRole === "Admin" || userRole === "Manager";

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [selectedApp, setSelectedApp] = useState("company");

  useEffect(() => {
    getTenantConfig().then(cfg => setForm({ ...cfg }));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    // The tenant_config UPDATE policy is Admin/Manager-only (P1). Guard the write
    // so a Sales user can't trigger a save the policy will silently reject.
    if (!canManage) { setError("Only an admin or manager can change settings."); return; }
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

  // [R2-4] Section list is gated by tenant_config.apps, run through the SAME
  // empty-array fail-open as groupVisible — a raw form.apps.includes(...) throws
  // on a null column (Settings crash) or vanishes the Sales section. Company is
  // always shown. Phase 1: apps=["sales"] → Company + Sales Command only.
  const enabledApps = (Array.isArray(form.apps) && form.apps.length) ? form.apps : ["sales"];
  const APP_SECTIONS = [
    { app: "company",  label: "Company" },
    { app: "sales",    label: "Sales Command" },
    { app: "schedule", label: "Schedule Command" },
    { app: "field",    label: "Field Command" },
    { app: "ar",       label: "AR Command" },
  ];
  const visibleSections = APP_SECTIONS.filter(s => s.app === "company" || enabledApps.includes(s.app));
  const sel = visibleSections.some(s => s.app === selectedApp) ? selectedApp : "company";

  return (
    <div style={{ maxWidth: 1040 }}>
      <SectionHeader title="Settings" action={
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {saved && <span style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: F.ui }}>Saved</span>}
          {error && <span style={{ fontSize: 12, fontWeight: 700, color: C.red, fontFamily: F.ui }}>{error}</span>}
          {canManage && <Btn sz="sm" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Btn>}
        </div>
      } />

      <div style={{ display: "flex", gap: 28, marginTop: 8, alignItems: "flex-start" }}>
        {/* Left-hand section list (§1f). A single save spans all fields — these
            are a VIEW filter over one form, not per-section saves. */}
        <div style={{ width: 176, flexShrink: 0, display: "flex", flexDirection: "column", gap: 3, position: "sticky", top: 0 }}>
          {visibleSections.map(s => {
            const on = s.app === sel;
            return (
              <button key={s.app} onClick={() => setSelectedApp(s.app)}
                style={{ textAlign: "left", padding: "9px 13px", borderRadius: 7, cursor: "pointer", fontFamily: F.display, fontSize: 12, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase",
                  background: on ? C.dark : "transparent",
                  color: on ? C.teal : C.textMuted,
                  border: on ? `1px solid ${C.tealBorder}` : "1px solid transparent" }}>
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content column — only the selected app's settings show */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: 900 }}>

          {sel === "company" && (<>
      <Section title="Company Info" defaultOpen>
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
      </Section>

      {userRole === "Admin" && (
        <Section title="Billing">
          <BillingSection />
        </Section>
      )}

      <Section title="Integrations">
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
      </Section>
          </>)}

          {sel === "sales" && (<>

      <Section title="Financial Defaults" defaultOpen>
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
      </Section>

      <Section title="Default Templates">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <Field label="Default Proposal Email Introduction" wide>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.default_proposal_email_intro || ""} onChange={e => set("default_proposal_email_intro", e.target.value)} placeholder="Appears in the email when a proposal is sent for signature" />
          </Field>
          <Field label="Default Invoice Email Introduction" wide>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.default_invoice_intro || ""} onChange={e => set("default_invoice_intro", e.target.value)} placeholder="Appears in the email above the invoice card. Not printed on the invoice." />
          </Field>
          <Field label="Default Invoice Work Description" wide>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.default_invoice_description || ""} onChange={e => set("default_invoice_description", e.target.value)} placeholder="Default description for the work being billed" />
          </Field>
        </div>
      </Section>

      {canManage && (
        <Section title="Work Types">
          <WorkTypesSection />
        </Section>
      )}

      {canManage && (
        <Section title="Materials Catalog">
          <MaterialsCatalogSection />
        </Section>
      )}

      <Section title="Sales Goals">
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
      </Section>

          </>)}

          {(sel === "schedule" || sel === "field" || sel === "ar") && (
            <AppSettingsPlaceholder label={visibleSections.find(s => s.app === sel)?.label || "This app"} />
          )}

          <div style={{ height: 40 }} />
        </div>
      </div>
    </div>
  );
}

// Placeholder for an enabled-but-not-yet-built app's settings (Schedule/Field/AR).
// Never shows in Phase 1 (only "sales" is in tenant_config.apps); rides in ready
// for later phases. Field's real content = threshold editors in Phase 3.
function AppSettingsPlaceholder({ label }) {
  return (
    <div style={{ background: C.linenCard, border: `1px dashed ${C.borderStrong}`, borderRadius: 12, padding: "40px 28px", textAlign: "center", marginTop: 20 }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>🧰</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label} settings</div>
      <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, marginTop: 6 }}>Available when {label} is enabled.</div>
    </div>
  );
}
