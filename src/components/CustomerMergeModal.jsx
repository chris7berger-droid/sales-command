import { useEffect, useMemo, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";

// Picks a survivor customer, previews what will move, requires the user to
// type MERGE to enable the final button, then calls the merge_customers RPC.
//
// Props:
//   duplicateCustomer — the customer being merged FROM (deleted on success)
//   onClose()         — close without action
//   onMerged(survivorId, counts) — fired after a successful merge

export default function CustomerMergeModal({ duplicateCustomer, onClose, onMerged }) {
  const [step, setStep] = useState(1); // 1 = pick survivor, 2 = preview + confirm
  const [allCustomers, setAllCustomers] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [counts, setCounts] = useState(null); // { jobs, contacts, templates }
  const [loadingCounts, setLoadingCounts] = useState(false);

  const [confirmText, setConfirmText] = useState("");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState(null);

  // Load candidate customers (everyone in the tenant except the duplicate).
  // Uses the same paginated fetch pattern as Customers.jsx.
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const PAGE = 1000;
      let all = [], from = 0;
      while (true) {
        const { data, error: e } = await supabase
          .from("customers")
          .select("id, name, customer_type, business_city, phone, email, qb_customer_id")
          .order("name")
          .range(from, from + PAGE - 1);
        if (e) { setError(e.message); break; }
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
      if (cancelled) return;
      setAllCustomers(all.filter(c => c.id !== duplicateCustomer.id));
      setLoadingList(false);
    }
    loadAll();
    return () => { cancelled = true; };
  }, [duplicateCustomer.id]);

  // Load duplicate's child counts on mount — these drive the preview copy.
  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      setLoadingCounts(true);
      const [j, c, t] = await Promise.all([
        supabase.from("call_log").select("id", { count: "exact", head: true }).eq("customer_id", duplicateCustomer.id),
        supabase.from("customer_contacts").select("id", { count: "exact", head: true }).eq("customer_id", duplicateCustomer.id),
        supabase.from("customer_pay_app_templates").select("id", { count: "exact", head: true }).eq("customer_id", duplicateCustomer.id),
      ]);
      if (cancelled) return;
      setCounts({ jobs: j.count || 0, contacts: c.count || 0, templates: t.count || 0 });
      setLoadingCounts(false);
    }
    loadCounts();
    return () => { cancelled = true; };
  }, [duplicateCustomer.id]);

  const filtered = useMemo(() => {
    if (!q.trim()) return allCustomers;
    const s = q.toLowerCase();
    return allCustomers.filter(c =>
      (c.name || "").toLowerCase().includes(s)
      || (c.business_city || "").toLowerCase().includes(s)
      || (c.phone || "").toLowerCase().includes(s)
      || (c.email || "").toLowerCase().includes(s)
    );
  }, [allCustomers, q]);

  const survivor = useMemo(
    () => allCustomers.find(c => c.id === selectedId) || null,
    [allCustomers, selectedId]
  );

  const dup = duplicateCustomer;
  const qbRule = useMemo(() => {
    if (!survivor) return null;
    if (survivor.qb_customer_id && dup.qb_customer_id) {
      return { tone: "warn", text: "Both have QuickBooks links. Survivor's link will be kept; the duplicate's QB record will need manual cleanup in QuickBooks." };
    }
    if (!survivor.qb_customer_id && dup.qb_customer_id) {
      return { tone: "info", text: "Survivor has no QuickBooks link — the duplicate's link will be copied onto the survivor." };
    }
    if (survivor.qb_customer_id && !dup.qb_customer_id) {
      return { tone: "info", text: "Survivor's QuickBooks link will be kept. No QuickBooks change needed." };
    }
    return { tone: "info", text: "Neither customer is linked to QuickBooks." };
  }, [survivor, dup]);

  async function handleConfirm() {
    if (!survivor) return;
    setMerging(true);
    setError(null);
    const { data, error: rpcErr } = await supabase.rpc("merge_customers", {
      p_dup_id: dup.id,
      p_survivor_id: survivor.id,
    });
    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("FORBIDDEN")) setError("You don't have permission to merge customers.");
      else if (msg.includes("SAME_CUSTOMER")) setError("Can't merge a customer into itself.");
      else if (msg.includes("TENANT_MISMATCH")) setError("These customers belong to different tenants.");
      else if (msg.includes("NOT_FOUND")) setError("One of the customers no longer exists. Reload and try again.");
      else setError(msg || "Merge failed. Try again.");
      setMerging(false);
      return;
    }
    setMerging(false);
    onMerged?.(survivor.id, data || {});
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 13.5, fontFamily: F.ui,
    background: C.linenDeep, color: C.textBody,
    border: `1.5px solid ${C.borderStrong}`, borderRadius: 8,
    WebkitAppearance: "none",
  };

  const noteRow = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, fontFamily: F.ui }}>
      <span style={{ color: C.textFaint, fontWeight: 700 }}>{label}</span>
      <span style={{ color: C.textHead, fontWeight: 700 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 620, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Merge Customer
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 18, lineHeight: 1.5 }}>
          Move all jobs, contacts, and pay-app templates from <strong style={{ color: C.textHead }}>{dup.name}</strong> into another customer, then delete <strong style={{ color: C.textHead }}>{dup.name}</strong>. This cannot be undone.
        </div>

        {step === 1 && (
          <>
            <input
              placeholder="Search by name, city, phone, or email…"
              value={q}
              onChange={e => setQ(e.target.value)}
              autoFocus
              style={{ ...inputStyle, marginBottom: 12 }}
            />

            <div style={{ flex: 1, overflowY: "auto", maxHeight: 360, marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 8, background: C.linenDeep }}>
              {loadingList && (
                <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading customers…</div>
              )}
              {!loadingList && filtered.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>
                  {q.trim() ? "No matches" : "No other customers in this tenant"}
                </div>
              )}
              {!loadingList && filtered.map(c => {
                const isSelected = selectedId === c.id;
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      padding: "12px 14px",
                      borderBottom: `1px solid ${C.border}`,
                      cursor: "pointer",
                      background: isSelected ? C.dark : "transparent",
                      borderLeft: isSelected ? `3px solid ${C.teal}` : "3px solid transparent",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(28,24,20,0.06)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 800, fontSize: 14, fontFamily: F.display, color: isSelected ? C.teal : C.textHead }}>
                        {c.name || "(no name)"}
                      </div>
                      {c.customer_type && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: isSelected ? C.teal : C.dark, color: isSelected ? C.dark : C.teal, letterSpacing: "0.04em", fontFamily: F.ui }}>
                          {c.customer_type}
                        </span>
                      )}
                      {c.qb_customer_id && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: C.dark, color: C.teal, letterSpacing: "0.04em", fontFamily: F.ui }}>QB ✓</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: isSelected ? C.teal : C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
                      {[c.business_city, c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Btn v="ghost" onClick={onClose}>Cancel</Btn>
              <Btn onClick={() => { setStep(2); setConfirmText(""); }} disabled={!selectedId}>Continue</Btn>
            </div>
          </>
        )}

        {step === 2 && survivor && (
          <>
            <div style={{ background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 8 }}>What will happen</div>
              {noteRow("Duplicate (will be deleted)", dup.name)}
              {noteRow("Survivor (will receive everything)", survivor.name)}
              <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
              {loadingCounts ? (
                <div style={{ padding: "6px 0", fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Counting…</div>
              ) : (
                <>
                  {noteRow("Jobs to move", counts?.jobs ?? 0)}
                  {noteRow("Contacts to move", counts?.contacts ?? 0)}
                  {noteRow("Pay-app templates to move", counts?.templates ?? 0)}
                </>
              )}
            </div>

            {qbRule && (
              <div style={{
                padding: "10px 14px", marginBottom: 14, borderRadius: 8, fontSize: 12.5, fontFamily: F.ui, lineHeight: 1.5,
                background: qbRule.tone === "warn" ? "rgba(229,150,57,0.12)" : C.linen,
                border: `1px solid ${qbRule.tone === "warn" ? C.amber : C.border}`,
                color: C.textBody,
              }}>
                <strong style={{ color: C.textHead }}>QuickBooks: </strong>{qbRule.text}
              </div>
            )}

            <div style={{ padding: "10px 14px", marginBottom: 14, borderRadius: 8, background: C.linen, border: `1px solid ${C.border}`, fontSize: 12.5, color: C.textBody, fontFamily: F.ui, lineHeight: 1.5 }}>
              Duplicate contacts may result if the survivor and duplicate share contact info. Review the survivor's contact list afterward.
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
                Type <span style={{ color: C.red, fontWeight: 900 }}>MERGE</span> to confirm
              </div>
              <input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                autoFocus
                placeholder="MERGE"
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ padding: "8px 12px", marginBottom: 12, background: "rgba(229,57,53,0.12)", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12.5, color: C.red, fontFamily: F.ui }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <Btn v="ghost" onClick={() => { setStep(1); setError(null); }} disabled={merging}>← Back</Btn>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn v="ghost" onClick={onClose} disabled={merging}>Cancel</Btn>
                <Btn onClick={handleConfirm} disabled={confirmText !== "MERGE" || merging} style={{ background: C.red, color: "#fff" }}>
                  {merging ? "Merging…" : "Confirm Merge"}
                </Btn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
