import { useEffect, useRef, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";

export default function QBLinkModal({ callLogId, currentQbCustomerId, onClose, onLinked }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [parentNames, setParentNames] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [linking, setLinking] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setError(null);
    if (q.trim().length < 2) {
      setResults([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const { data, error: fnErr } = await supabase.functions.invoke("qb-search-customers", { body: { q: q.trim() } });
      if (fnErr) {
        const body = await fnErr.context?.json?.().catch(() => null);
        setError(body?.error || fnErr.message || "Search failed.");
        setResults([]);
        setLoading(false);
        return;
      }
      if (data?.error) {
        setError(data.error);
        setResults([]);
        setLoading(false);
        return;
      }
      const list = data?.customers || [];
      setResults(list);
      const parentLookup = {};
      list.forEach(c => { parentLookup[c.id] = c.displayName; });
      setParentNames(parentLookup);
      setLoading(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  async function handleConfirm() {
    if (!selectedId) return;
    setLinking(true);
    setError(null);
    const { data, error: fnErr } = await supabase.functions.invoke("qb-link-customer", {
      body: { callLogId, qbCustomerId: selectedId },
    });
    if (fnErr) {
      const body = await fnErr.context?.json?.().catch(() => null);
      setError(body?.error || fnErr.message || "Link failed. Try again.");
      setLinking(false);
      return;
    }
    if (data?.error === "qb_customer_invalid") {
      setError("That QuickBooks customer is no longer active. Search again.");
      setResults([]);
      setSelectedId(null);
      setLinking(false);
      return;
    }
    if (data?.error) {
      setError(data.error || "Link failed. Try again.");
      setLinking(false);
      return;
    }
    onLinked?.({ id: data.qbCustomerId, displayName: data.displayName });
    onClose?.();
  }

  const inputStyle = {
    width: "100%", padding: "10px 12px", fontSize: 13.5, fontFamily: F.ui,
    background: C.linenDeep, color: C.textBody,
    border: `1.5px solid ${C.borderStrong}`, borderRadius: 8,
    WebkitAppearance: "none",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: C.linenCard, borderRadius: 14, padding: 32, width: 580, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>Link to QuickBooks Customer</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 18, lineHeight: 1.5 }}>
          Pick the existing QuickBooks customer or sub-customer this job should post invoices to. Sub-customers (jobs under a parent) are typically the right pick.
        </div>

        <input
          placeholder="Search customer or company name…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
          style={{ ...inputStyle, marginBottom: 12 }}
        />

        <div style={{ flex: 1, overflowY: "auto", maxHeight: 360, marginBottom: 14, border: `1px solid ${C.border}`, borderRadius: 8, background: C.linenDeep }}>
          {loading && (
            <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Searching…</div>
          )}
          {!loading && q.trim().length < 2 && (
            <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Type at least 2 characters to search</div>
          )}
          {!loading && q.trim().length >= 2 && results.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>No matches</div>
          )}
          {!loading && results.map(c => {
            const isSelected = selectedId === c.id;
            const parentLabel = c.isJob && c.parentId
              ? (parentNames[c.parentId] ? `Sub-customer of ${parentNames[c.parentId]}` : "Sub-customer")
              : null;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  padding: "12px 14px",
                  borderBottom: `1px solid ${C.border}`,
                  cursor: "pointer",
                  background: isSelected ? C.dark : "transparent",
                  color: isSelected ? C.teal : C.textBody,
                  borderLeft: isSelected ? `3px solid ${C.teal}` : "3px solid transparent",
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(28,24,20,0.06)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ fontWeight: 800, fontSize: 14, fontFamily: F.display, color: isSelected ? C.teal : C.textHead }}>
                  {c.displayName || "(no display name)"}
                  {c.id === currentQbCustomerId && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: C.teal, color: C.dark, letterSpacing: "0.04em", fontFamily: F.ui }}>CURRENT</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: isSelected ? C.teal : C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
                  {[c.companyName, parentLabel].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: "8px 12px", marginBottom: 12, background: "rgba(229,57,53,0.12)", border: `1px solid ${C.red}`, borderRadius: 6, fontSize: 12.5, color: C.red, fontFamily: F.ui }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Btn v="ghost" onClick={onClose} disabled={linking}>Cancel</Btn>
          <Btn onClick={handleConfirm} disabled={!selectedId || linking}>
            {linking ? "Linking…" : "Confirm Link"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
