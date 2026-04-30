import { useEffect, useState, useRef } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";

const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  WebkitAppearance: "none",
};

const labelStyle = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
  color: C.textFaint, fontFamily: F.ui, marginBottom: 6,
};

function pickBillingContact(contacts) {
  const billing = contacts.filter(c => c.role === "Billing Contact");
  if (billing.length === 0) return null;
  const primary = billing.find(c => c.is_primary);
  if (primary) return primary;
  return [...billing].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
}

export default function ContactBillingPicker({
  customerId,
  customerMode,
  customerName,
  contactValues,
  billingValues,
  onContactChange,
  onBillingChange,
  onBillingLockChange,
  requireBilling = false,
  showBillingTerms = false,
  hideBilling = false,
}) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (customerMode !== "existing" || !customerId) {
      setContacts([]);
      setSelectedPrimaryId("");
      setManualMode(false);
      onBillingLockChange?.(false, null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setLoadError(null);
    supabase.from("customer_contacts")
      .select("id, name, phone, email, role, is_primary, created_at")
      .eq("customer_id", customerId)
      .order("is_primary", { ascending: false })
      .order("created_at")
      .then(({ data, error }) => {
        if (seq !== fetchSeqRef.current) return;
        setLoading(false);
        if (error) {
          setLoadError(error.message || "Failed to load contacts");
          setContacts([]);
          onBillingLockChange?.(false, null);
          return;
        }
        const list = data || [];
        setContacts(list);
        setSelectedPrimaryId("");
        setManualMode(false);

        const billing = pickBillingContact(list);
        if (billing) {
          onBillingChange?.({
            billingName: billing.name || "",
            billingPhone: billing.phone || "",
            billingEmail: billing.email || "",
          });
          onBillingLockChange?.(true, billing.id);
        } else {
          onBillingLockChange?.(false, null);
        }
      });
  }, [customerId, customerMode]);

  const billingContact = pickBillingContact(contacts);
  const billingLocked = !!billingContact;
  const multipleBilling = contacts.filter(c => c.role === "Billing Contact").length > 1;

  const pickPrimary = (id) => {
    setSelectedPrimaryId(id);
    if (!id) {
      onContactChange?.({ contactName: "", contactPhone: "", contactEmail: "" });
      return;
    }
    const c = contacts.find(x => x.id === id);
    if (!c) return;
    onContactChange?.({
      contactName: c.name || "",
      contactPhone: c.phone || "",
      contactEmail: c.email || "",
    });
  };

  const renderPrimaryPicker = () => {
    if (customerMode !== "existing" || !customerId) return null;
    if (loading) {
      return (
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, padding: "6px 0" }}>
          Loading saved contacts…
        </div>
      );
    }
    if (loadError) {
      return (
        <div style={{ fontSize: 12, color: "#a07800", fontFamily: F.ui, padding: "8px 10px", background: "rgba(230,168,0,0.08)", border: "1px solid rgba(230,168,0,0.25)", borderRadius: 7 }}>
          Couldn't load saved contacts: {loadError}
        </div>
      );
    }
    if (contacts.length === 0) {
      return (
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, padding: "4px 0" }}>
          No saved contacts on file{customerName ? ` for ${customerName}` : ""}. Enter contact info below.
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={labelStyle}>Job Contact</div>
        <select
          value={selectedPrimaryId}
          onChange={e => pickPrimary(e.target.value)}
          style={inputStyle}
        >
          <option value="">— Select Saved Contact —</option>
          {contacts.map(c => (
            <option key={c.id} value={c.id}>
              {c.name || "(no name)"}{c.role ? ` — ${c.role}` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setManualMode(m => !m)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, textAlign: "left",
            textDecoration: "underline", marginTop: 2,
          }}
        >
          {manualMode ? "Hide manual entry" : "+ Use a different contact (manual entry)"}
        </button>
      </div>
    );
  };

  const showManualPrimary = manualMode || customerMode !== "existing" || !customerId || (!loading && !loadError && contacts.length === 0);

  const renderManualPrimary = () => {
    if (!showManualPrimary) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          placeholder="Contact Name (optional)"
          value={contactValues.contactName || ""}
          onChange={e => onContactChange?.({ contactName: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            placeholder="Phone"
            value={contactValues.contactPhone || ""}
            onChange={e => onContactChange?.({ contactPhone: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Email"
            value={contactValues.contactEmail || ""}
            onChange={e => onContactChange?.({ contactEmail: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>
    );
  };

  const renderBillingLocked = () => (
    <div style={{ marginTop: 10, padding: "12px 14px", background: C.dark, borderRadius: 8, border: `1px solid ${C.tealBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", fontFamily: F.ui }}>
          Billing Contact (on file)
        </span>
        <span style={{ fontSize: 9, color: C.teal, background: "rgba(48,207,172,0.12)", padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em", fontWeight: 700, fontFamily: F.ui }}>
          LOCKED
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.teal, fontFamily: F.display, marginBottom: 4 }}>
        {billingContact.name || "(no name)"}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: F.ui, lineHeight: 1.6 }}>
        {billingContact.phone || <span style={{ color: "rgba(255,255,255,0.3)" }}>no phone</span>}
        {" · "}
        {billingContact.email || <span style={{ color: "rgba(255,255,255,0.3)" }}>no email</span>}
      </div>
      <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: F.ui, marginTop: 8 }}>
        Edit on customer record to change.
      </div>
      {multipleBilling && (
        <div style={{ fontSize: 10.5, color: "#f9a825", fontFamily: F.ui, marginTop: 6 }}>
          Multiple billing contacts on file — using {billingContact.name}. Consolidate on customer record.
        </div>
      )}
    </div>
  );

  const renderBillingManual = () => (
    <div style={{ marginTop: 10, padding: "12px 14px", background: C.linen, borderRadius: 8, border: `1px solid ${C.border}` }}>
      <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
        Billing Contact
        {requireBilling && (
          <span style={{ fontSize: 10, color: C.teal, background: C.dark, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.08em" }}>REQUIRED</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          placeholder="Billing Contact Name"
          value={billingValues.billingName || ""}
          onChange={e => onBillingChange?.({ billingName: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            placeholder="Billing Phone"
            value={billingValues.billingPhone || ""}
            onChange={e => onBillingChange?.({ billingPhone: e.target.value })}
            style={inputStyle}
          />
          <input
            placeholder="Billing Email"
            value={billingValues.billingEmail || ""}
            onChange={e => onBillingChange?.({ billingEmail: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>
      {customerMode === "existing" && customerId && contacts.length > 0 && (
        <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 8 }}>
          Tip: add a Billing Contact to this customer's record so future jobs auto-fill.
        </div>
      )}
    </div>
  );

  const renderBillingTerms = () => {
    if (!showBillingTerms) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <div style={labelStyle}>Billing Terms</div>
        <select
          value={billingValues.billingTerms || "30"}
          onChange={e => onBillingChange?.({ billingTerms: e.target.value })}
          style={inputStyle}
        >
          <option value="5">Net 5</option>
          <option value="15">Net 15</option>
          <option value="30">Net 30</option>
          <option value="45">Net 45</option>
          <option value="60">Net 60</option>
          <option value="90">Net 90</option>
          <option value="120">Net 120</option>
        </select>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {renderPrimaryPicker()}
      {renderManualPrimary()}
      {!hideBilling && (billingLocked ? renderBillingLocked() : renderBillingManual())}
      {renderBillingTerms()}
    </div>
  );
}

export function billingContactIdFor(contacts) {
  const billing = contacts?.filter(c => c.role === "Billing Contact") || [];
  if (billing.length === 0) return null;
  const primary = billing.find(c => c.is_primary);
  if (primary) return primary.id;
  return [...billing].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0].id;
}
