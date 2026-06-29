// OPEN: customer_type filter default — Commercial-only with Residential toggle (spec recommends Commercial-only)
// OPEN: CO call_log gate on Entry Point B — spec recommends hide on COs

import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$ } from "../lib/utils";
import { calcWtcPrice, calcProposalTotal, usesExactPricing } from "../lib/calc";

const inputStyle = {
  padding: "10px 14px", borderRadius: 8,
  border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, fontSize: 14,
  color: C.textBody, fontFamily: F.ui,
  outline: "none", width: "100%",
  WebkitAppearance: "none",
};

const StepLabel = ({ n, label }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.dark, border: `2px solid ${C.teal}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 900, color: C.teal, fontFamily: F.display }}>{n}</span>
    </div>
    <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textHead, fontFamily: F.display }}>{label}</span>
  </div>
);

const NavCircle = ({ onClick, disabled, children, primary }) => (
  <button onClick={onClick} disabled={disabled} style={{
    width: 48, height: 48, borderRadius: "50%", border: `2px solid ${C.teal}`,
    background: primary ? C.teal : C.dark, color: primary ? C.dark : C.teal,
    fontSize: 20, fontWeight: 900, cursor: disabled ? "default" : "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    opacity: disabled ? 0.4 : 1, transition: "opacity 0.15s",
    fontFamily: F.display, padding: 0, lineHeight: 1,
  }}>{children}</button>
);

const BILLING_TERMS = [5, 15, 30, 45, 60, 90, 120];

export default function MultiGCWizard({ sourceProposalId, onClose, onSaved }) {
  const [state, setState] = useState({
    step: 0,
    sourceProposalId,
    sourceProposal: null,
    sourceWtcs: [],
    callLogId: null,
    existingSisterCustomerIds: [],
    targets: [],
    saving: false,
    error: null,
    partialResults: null,
  });

  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showResidential, setShowResidential] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [contactsByCustomer, setContactsByCustomer] = useState({});
  const [expandedWtcs, setExpandedWtcs] = useState({});

  const set = (k, v) => setState(prev => ({ ...prev, [k]: v }));
  const setTarget = (idx, k, v) => setState(prev => ({
    ...prev,
    targets: prev.targets.map((t, i) => i === idx ? { ...t, [k]: v } : t),
  }));

  // Entry Point B source-picker variant deferred to step 10.
  // sourceProposalId is always pre-set by Entry Point A for now.

  useEffect(() => {
    if (!sourceProposalId) return;
    (async () => {
      const { data: p } = await supabase
        .from("proposals")
        .select("*, call_log(id, display_job_number, customer_name, customer_id, job_name, customers(id, name, email, contact_email, billing_terms))")
        .eq("id", sourceProposalId)
        .maybeSingle();
      if (!p) return;

      const { data: wtcs } = await supabase
        .from("proposal_wtc")
        .select("*, work_types(name)")
        .eq("proposal_id", sourceProposalId)
        .order("created_at");

      const { data: sisters } = await supabase
        .from("proposals")
        .select("customer_id")
        .eq("call_log_id", p.call_log_id)
        .eq("cloned_from_proposal_id", sourceProposalId)
        .is("deleted_at", null);

      setState(prev => ({
        ...prev,
        sourceProposal: p,
        sourceWtcs: wtcs || [],
        callLogId: p.call_log_id,
        existingSisterCustomerIds: (sisters || []).map(s => s.customer_id).filter(Boolean),
      }));
    })();
  }, [sourceProposalId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, customer_type, billing_terms")
        .order("name");
      setCustomers(data || []);
    })();
  }, []);

  const loadContacts = async (customerId) => {
    if (contactsByCustomer[customerId]) return;
    const { data } = await supabase
      .from("customer_contacts")
      .select("id, name, email, phone, role, is_primary")
      .eq("customer_id", customerId)
      .order("is_primary", { ascending: false })
      .order("name");
    setContactsByCustomer(prev => ({ ...prev, [customerId]: data || [] }));
  };

  const { step, sourceProposal: sp, sourceWtcs, targets, saving, error, existingSisterCustomerIds } = state;
  const sourceCustomerId = sp?.customer_id ?? sp?.call_log?.customer_id;

  const filteredCustomers = customers.filter(c => {
    if (!showResidential && c.customer_type !== "Commercial") return false;
    if (customerSearch && !c.name.toLowerCase().includes(customerSearch.toLowerCase())) return false;
    return true;
  });

  const toggleCustomer = (c) => {
    const exists = targets.find(t => t.customer_id === c.id);
    if (exists) {
      const newTargets = targets.filter(t => t.customer_id !== c.id);
      setState(prev => ({ ...prev, targets: newTargets }));
      if (activeTab >= newTargets.length && newTargets.length > 0) setActiveTab(newTargets.length - 1);
    } else {
      setState(prev => ({
        ...prev,
        targets: [...prev.targets, {
          customer_id: c.id,
          customer_name: c.name,
          primary_contact_id: null,
          viewer_contact_ids: [],
          rfp_number: "",
          bid_due_date: null,
          billing_terms: c.billing_terms || 30,
          intro: sp?.intro || "",
          intro_locally_edited: false,
          markup_override_pct: null,
        }],
      }));
    }
  };

  const isDisabledCustomer = (c) => {
    if (c.id === sourceCustomerId) return "this is the source proposal's GC";
    if (existingSisterCustomerIds.includes(c.id)) return "already has a GC copy on this project";
    return null;
  };

  const canNext = () => {
    if (step === 0) return targets.length >= 1;
    if (step === 1) return targets.every(t =>
      t.primary_contact_id && t.rfp_number?.trim() && t.bid_due_date
    );
    return true;
  };

  const goNext = () => {
    if (step < 3 && canNext()) {
      set("step", step + 1);
      if (step === 0) {
        targets.forEach(t => loadContacts(t.customer_id));
      }
    }
  };
  const goBack = () => { if (step > 0) set("step", step - 1); };

  const handleCreate = async () => {
    set("saving", true);
    set("error", null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("clone_proposal_to_gcs", {
        p_source_proposal_id: sourceProposalId,
        p_targets: targets.map(t => ({
          customer_id: t.customer_id,
          rfp_number: t.rfp_number || null,
          bid_due: t.bid_due_date || null,
          markup_override_pct: t.markup_override_pct,
          signer_contact_id: t.primary_contact_id || null,
          viewer_contact_ids: (t.viewer_contact_ids || []).length > 0 ? t.viewer_contact_ids : null,
          intro_override: t.intro_locally_edited ? t.intro : null,
          billing_terms: t.billing_terms || null,
        })),
      });
      if (rpcErr) throw rpcErr;
      set("partialResults", data);
      if (onSaved) onSaved(data);
    } catch (err) {
      set("error", err.message || "Failed to create GC copies");
    } finally {
      set("saving", false);
    }
  };

  const tabHasMissing = (t) => !t.primary_contact_id || !t.rfp_number?.trim() || !t.bid_due_date;

  if (!sp) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,20,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, color: C.textMuted, fontFamily: F.ui }}>Loading…</div>
      </div>
    );
  }

  const sourceTotal = calcProposalTotal(sourceWtcs, parseFloat(sp?.markup_override_pct) || 0, usesExactPricing(sp));
  const displayLabel = `${sp.call_log?.display_job_number || ""} P${sp.proposal_number || ""}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,20,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Left nav */}
      {step > 0 && (
        <div style={{ position: "absolute", left: "calc(50% - 414px)", zIndex: 1001 }}>
          <NavCircle onClick={goBack}>←</NavCircle>
        </div>
      )}
      {/* Right nav */}
      {step < 3 && (
        <div style={{ position: "absolute", right: "calc(50% - 414px)", zIndex: 1001 }}>
          <NavCircle onClick={goNext} disabled={!canNext()} primary={step === 2}>→</NavCircle>
        </div>
      )}
      {step === 3 && (
        <div style={{ position: "absolute", right: "calc(50% - 414px)", zIndex: 1001 }}>
          <NavCircle onClick={handleCreate} disabled={saving} primary>✓</NavCircle>
        </div>
      )}

      <div onClick={e => e.stopPropagation()} style={{
        background: C.linenCard, borderRadius: 14, padding: 32,
        width: 720, maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        border: `1px solid ${C.borderStrong}`,
        position: "relative",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: F.display, fontSize: 22, color: C.textHead, letterSpacing: "0.02em" }}>Send to Additional GCs</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 22, cursor: "pointer", fontFamily: F.display, padding: 0 }}>✕</button>
        </div>

        {/* Source sub-strip */}
        <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 9, padding: "10px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontFamily: F.display }}>Source Proposal</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{displayLabel}</div>
        </div>

        {/* Screen content */}
        {step === 0 && <Screen1
          targets={targets} toggleCustomer={toggleCustomer} filteredCustomers={filteredCustomers}
          customerSearch={customerSearch} setCustomerSearch={setCustomerSearch}
          showResidential={showResidential} setShowResidential={setShowResidential}
          isDisabledCustomer={isDisabledCustomer}
        />}
        {step === 1 && <Screen2
          targets={targets} activeTab={activeTab} setActiveTab={setActiveTab}
          setTarget={setTarget} contactsByCustomer={contactsByCustomer}
          loadContacts={loadContacts} tabHasMissing={tabHasMissing}
          sourceIntro={sp?.intro || ""}
        />}
        {step === 2 && <Screen3
          targets={targets} setTarget={setTarget} sourceWtcs={sourceWtcs}
          sourceTotal={sourceTotal} sp={sp} expandedWtcs={expandedWtcs}
          setExpandedWtcs={setExpandedWtcs}
        />}
        {step === 3 && <Screen4
          targets={targets} sp={sp} sourceWtcs={sourceWtcs} sourceTotal={sourceTotal}
          displayLabel={displayLabel} saving={saving} error={error}
          handleCreate={handleCreate} contactsByCustomer={contactsByCustomer}
        />}

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
          {step + 1} / 4
        </div>
      </div>
    </div>
  );
}

/* ── Screen 1: Pick GCs ────────────────────────────────────────────── */

function Screen1({ targets, toggleCustomer, filteredCustomers, customerSearch, setCustomerSearch, showResidential, setShowResidential, isDisabledCustomer }) {
  const selectedIds = new Set(targets.map(t => t.customer_id));

  return (
    <div>
      <StepLabel n={1} label="Pick GCs" />
      <p style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, marginBottom: 14, marginTop: 0 }}>
        Pick one or more General Contractors to receive a copy of this proposal. Each will get its own customer, contacts, RFP#, and pricing.
      </p>

      <input
        placeholder="Search GC customers…"
        value={customerSearch}
        onChange={e => setCustomerSearch(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10 }}
      />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          onClick={() => setShowResidential(!showResidential)}
          style={{ background: "none", border: "none", color: C.textFaint, fontSize: 11, cursor: "pointer", fontFamily: F.ui, padding: 0 }}
        >
          {showResidential ? "Hide Residential" : "Show Residential too"}
        </button>
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredCustomers.length === 0 && (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13, padding: "20px 0", textAlign: "center" }}>
            No GC customers yet. Use + Add New GC Customer to create one.
          </div>
        )}
        {filteredCustomers.map(c => {
          const selected = selectedIds.has(c.id);
          const disabledReason = isDisabledCustomer(c);
          return (
            <button
              key={c.id}
              onClick={() => !disabledReason && toggleCustomer(c)}
              disabled={!!disabledReason}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                borderRadius: 8, cursor: disabledReason ? "not-allowed" : "pointer",
                background: selected ? C.dark : C.linen,
                border: `1.5px solid ${selected ? C.teal : C.border}`,
                opacity: disabledReason ? 0.4 : 1,
                transition: "all 0.12s", width: "100%", textAlign: "left",
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: 3, flexShrink: 0,
                border: `2px solid ${selected ? C.teal : C.borderStrong}`,
                background: selected ? C.teal : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {selected && <span style={{ color: C.dark, fontSize: 12, fontWeight: 900 }}>✓</span>}
              </div>
              <span style={{
                flex: 1, fontSize: 13, fontFamily: F.ui,
                color: selected ? C.teal : C.textBody,
                fontWeight: selected ? 700 : 400,
              }}>
                {c.name}
                {disabledReason && <span style={{ color: C.textFaint, fontStyle: "italic" }}> ({disabledReason})</span>}
              </span>
              <span style={{ fontSize: 11, color: selected ? "rgba(255,255,255,0.35)" : C.textFaint, fontFamily: F.ui }}>
                {c.customer_type}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Screen 2: Per-GC Details ──────────────────────────────────────── */

function Screen2({ targets, activeTab, setActiveTab, setTarget, contactsByCustomer, loadContacts, tabHasMissing, sourceIntro }) {
  const t = targets[activeTab];
  if (!t) return null;

  const contacts = contactsByCustomer[t.customer_id] || [];

  useEffect(() => { loadContacts(t.customer_id); }, [t.customer_id]);

  return (
    <div>
      <StepLabel n={2} label="Per-GC Details" />

      {/* Tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {targets.map((tgt, i) => {
          const sel = i === activeTab;
          const label = tgt.customer_name?.length > 20 ? tgt.customer_name.slice(0, 20) + "…" : tgt.customer_name;
          return (
            <button key={tgt.customer_id} onClick={() => setActiveTab(i)} style={{
              padding: "7px 14px", borderRadius: 20, cursor: "pointer",
              border: `1.5px solid ${sel ? C.teal : C.border}`,
              background: sel ? C.dark : "transparent",
              color: sel ? C.teal : C.textMuted,
              fontFamily: F.display, fontSize: 11, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.05em",
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {label}
              {tabHasMissing(tgt) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e53935", display: "inline-block" }} />}
            </button>
          );
        })}
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, alignSelf: "center", marginLeft: "auto" }}>
          {activeTab + 1} of {targets.length}
        </span>
      </div>

      {/* Tab body */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 18, color: C.textHead }}>{t.customer_name}</div>
          <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Commercial</div>
        </div>

        {/* Primary contact */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4, display: "block" }}>
            Primary Contact (Signer)
          </label>
          <select
            value={t.primary_contact_id || ""}
            onChange={e => setTarget(activeTab, "primary_contact_id", e.target.value || null)}
            style={inputStyle}
          >
            <option value="">Select a contact…</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.name} — {c.email || "no email"}{c.is_primary ? " (primary)" : ""}</option>
            ))}
          </select>
        </div>

        {/* RFP # */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4, display: "block" }}>
            RFP #
          </label>
          <input
            value={t.rfp_number}
            onChange={e => setTarget(activeTab, "rfp_number", e.target.value)}
            placeholder="e.g. RFP-2026-042"
            style={inputStyle}
          />
        </div>

        {/* Bid due date */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4, display: "block" }}>
            Bid Due Date
          </label>
          <input
            type="date"
            value={t.bid_due_date || ""}
            onChange={e => setTarget(activeTab, "bid_due_date", e.target.value || null)}
            style={inputStyle}
          />
        </div>

        {/* Billing terms */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4, display: "block" }}>
            Billing Terms
          </label>
          <select
            value={t.billing_terms}
            onChange={e => setTarget(activeTab, "billing_terms", parseInt(e.target.value) || 30)}
            style={inputStyle}
          >
            {BILLING_TERMS.map(n => <option key={n} value={n}>Net {n}</option>)}
          </select>
        </div>

        {/* Intro override */}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            Email Introduction
          </label>
          <div style={{ fontSize: 11, fontFamily: F.ui, marginBottom: 6, color: t.intro_locally_edited ? C.amber : C.textFaint }}>
            {t.intro_locally_edited
              ? "Overridden for this GC. Future source edits will not auto-sync this field."
              : "From source proposal. Edit to override for this GC only."}
          </div>
          <textarea
            value={t.intro}
            onChange={e => {
              const val = e.target.value;
              setTarget(activeTab, "intro", val);
              setTarget(activeTab, "intro_locally_edited", val !== sourceIntro);
            }}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Screen 3: Pricing ─────────────────────────────────────────────── */

function Screen3({ targets, setTarget, sourceWtcs, sourceTotal, sp, expandedWtcs, setExpandedWtcs }) {
  // D2: target sisters don't exist yet — preview off the SOURCE era. A confirmed
  // sister inherits the right pricing_anchor_at via the clone RPC. (plan §3.5.2)
  const exact = usesExactPricing(sp);
  return (
    <div>
      <StepLabel n={3} label="Pricing" />
      <p style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, marginBottom: 14, marginTop: 0 }}>
        Adjust pricing per GC. The override adds (or subtracts) percentage points to every WTC's labor markup on this GC's proposal. Material markup and travel are unaffected. Leave blank for no change from the source.
      </p>

      {/* Source total reference */}
      <div style={{ background: C.dark, borderRadius: 9, padding: "10px 16px", border: `1px solid ${C.tealBorder}`, marginBottom: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", fontFamily: F.display }}>Source proposal total</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{fmt$(sourceTotal)}</div>
        {sp?.markup_override_pct != null && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: F.ui, marginTop: 2 }}>
            Source's own markup override is already applied to the source total above. Sister overrides do not inherit.
          </div>
        )}
      </div>

      {/* Per-sister pricing cards */}
      {targets.map((t, idx) => {
        const sisterTotal = (sourceWtcs || []).reduce(
          (sum, w) => sum + calcWtcPrice(w, parseFloat(t.markup_override_pct) || 0, exact), 0
        );
        const delta = sisterTotal - sourceTotal;
        const expanded = expandedWtcs[idx];
        const overrideVal = t.markup_override_pct;
        const absOverride = Math.abs(parseFloat(overrideVal) || 0);

        return (
          <div key={t.customer_id} style={{
            background: C.linen, border: `1.5px solid ${C.borderStrong}`,
            borderRadius: 10, padding: 16, marginBottom: 10,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 140px", gap: 16, alignItems: "center" }}>
              {/* Left: customer */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 15, color: C.textHead }}>{t.customer_name}</div>
                <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Commercial</div>
              </div>

              {/* Center: override input */}
              <div style={{ position: "relative" }}>
                <input
                  type="number"
                  value={overrideVal ?? ""}
                  onChange={e => {
                    const raw = e.target.value;
                    setTarget(idx, "markup_override_pct", raw === "" ? null : parseFloat(raw));
                  }}
                  placeholder="e.g. -5"
                  style={{ ...inputStyle, paddingRight: 30, width: "100%" }}
                />
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: C.textFaint, fontFamily: F.ui, pointerEvents: "none" }}>pp</span>
                {absOverride > 25 && (
                  <div style={{ fontSize: 10, color: C.amber, fontFamily: F.ui, marginTop: 4 }}>
                    ⚠ Large markup override — verify with manager.
                  </div>
                )}
              </div>

              {/* Right: computed total */}
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: F.display, fontSize: 18, color: C.teal }}>{fmt$(sisterTotal)}</div>
                <div style={{ fontSize: 11, fontFamily: F.ui, color: delta > 0 ? C.amber : delta < 0 ? C.green : C.textFaint }}>
                  vs source: {delta >= 0 ? "+" : "−"}{fmt$(Math.abs(delta)).replace("$", "$")}
                </div>
              </div>
            </div>

            {/* Per-WTC breakdown disclosure */}
            <button
              onClick={() => setExpandedWtcs(prev => ({ ...prev, [idx]: !prev[idx] }))}
              style={{ background: "none", border: "none", color: C.textFaint, fontSize: 11, cursor: "pointer", fontFamily: F.ui, padding: "6px 0 0 0", display: "flex", alignItems: "center", gap: 4 }}
            >
              {expanded ? "▾" : "▸"} Show per-WTC breakdown
            </button>
            {expanded && (
              <div style={{ marginTop: 8, paddingLeft: 4 }}>
                {sourceWtcs.map((w, wi) => {
                  const wtcPrice = calcWtcPrice(w, parseFloat(t.markup_override_pct) || 0, exact);
                  const sourceWtcPrice = calcWtcPrice(w, undefined, exact);
                  return (
                    <div key={w.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, fontFamily: F.ui, color: C.textBody }}>
                      <span>WTC {wi + 1} — {w.work_types?.name || "Unknown"}</span>
                      <span>
                        <span style={{ color: C.teal, fontWeight: 600 }}>{fmt$(wtcPrice)}</span>
                        {t.markup_override_pct != null && (
                          <span style={{ color: C.textFaint, marginLeft: 8 }}>was {fmt$(sourceWtcPrice)}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Screen 4: Review ──────────────────────────────────────────────── */

function Screen4({ targets, sp, sourceWtcs, sourceTotal, displayLabel, saving, error, handleCreate, contactsByCustomer }) {
  const exact = usesExactPricing(sp);
  return (
    <div>
      <StepLabel n={4} label="Review" />

      {/* Source summary card */}
      <div style={{ background: C.linenCard, border: `1.5px solid ${C.borderStrong}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.display, marginBottom: 8 }}>Source Proposal</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", fontSize: 13, fontFamily: F.ui }}>
          <div><span style={{ color: C.textFaint }}>Job:</span> <span style={{ color: C.textBody }}>{sp?.call_log?.display_job_number} — {sp?.call_log?.job_name}</span></div>
          <div><span style={{ color: C.textFaint }}>Customer:</span> <span style={{ color: C.textBody }}>{sp?.call_log?.customer_name}</span></div>
          <div><span style={{ color: C.textFaint }}>Status:</span> <span style={{ color: C.textBody }}>{sp?.status}</span></div>
          <div><span style={{ color: C.textFaint }}>Total:</span> <span style={{ color: C.teal, fontWeight: 700 }}>{fmt$(sourceTotal)}</span></div>
          <div><span style={{ color: C.textFaint }}>WTC count:</span> <span style={{ color: C.textBody }}>{sourceWtcs.length}</span></div>
        </div>
      </div>

      {/* Sister cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>
        {targets.map((t, idx) => {
          const sisterTotal = (sourceWtcs || []).reduce(
            (sum, w) => sum + calcWtcPrice(w, parseFloat(t.markup_override_pct) || 0, exact), 0
          );
          const contacts = contactsByCustomer[t.customer_id] || [];
          const signer = contacts.find(c => c.id === t.primary_contact_id);
          const overridePp = t.markup_override_pct != null ? (t.markup_override_pct >= 0 ? `+${t.markup_override_pct}` : `${t.markup_override_pct}`) : "+0";

          return (
            <div key={t.customer_id} style={{
              background: C.linen, border: `1.5px solid ${C.borderStrong}`,
              borderRadius: 10, padding: 14,
            }}>
              <div style={{ fontFamily: F.display, fontSize: 15, color: C.textHead, marginBottom: 4 }}>{t.customer_name}</div>
              {signer && (
                <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 8 }}>
                  {signer.name} — {signer.email || "no email"}
                </div>
              )}

              {/* Metadata chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {t.rfp_number && (
                  <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, fontFamily: F.ui }}>
                    RFP# {t.rfp_number}
                  </span>
                )}
                {t.bid_due_date && (
                  <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, fontFamily: F.ui }}>
                    Bid due {new Date(t.bid_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, fontFamily: F.ui }}>
                  Net {t.billing_terms}
                </span>
                <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 700, fontFamily: F.ui }}>
                  {overridePp} pp
                </span>
              </div>

              {/* Total */}
              <div style={{ fontFamily: F.display, fontSize: 20, color: C.teal, marginBottom: 4 }}>{fmt$(sisterTotal)}</div>

              {/* Intro override indicator */}
              {t.intro_locally_edited && (
                <div style={{ fontSize: 11, color: C.amber, fontFamily: F.ui }}>intro: overridden from source</div>
              )}
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <button
        onClick={handleCreate}
        disabled={saving}
        style={{
          width: "100%", background: C.teal, border: "none", borderRadius: 9,
          padding: "13px 28px", color: C.dark, fontWeight: 800, fontSize: 14.5,
          fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "Creating…" : `Create ${targets.length} Sister Proposal${targets.length !== 1 ? "s" : ""}`}
      </button>

      {/* Error */}
      {error && (
        <div style={{ color: "#e53935", fontSize: 13, fontFamily: F.ui, marginTop: 10, textAlign: "center" }}>
          {error}
        </div>
      )}
    </div>
  );
}
