import { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import Btn from "./Btn";

export default function SyncConflictModal({ sourceProposalId, changedFields, onClose, onApplied }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [forceOverwrite, setForceOverwrite] = useState(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("preview_sync_to_sisters", {
        p_source_proposal_id: sourceProposalId,
      });
      if (err) { setError(err.message); setLoading(false); return; }
      setPreview(data);
      setLoading(false);

      if (!data?.sisters?.length || data.sisters.every(s =>
        s.pending.length === 0 && s.conflicts.length === 0
      )) {
        if (onApplied) onApplied({ synced: [], skipped: [] });
        return;
      }
    })();
  }, [sourceProposalId]);

  const toggleForce = (key) => {
    setForceOverwrite(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("apply_source_edit_to_sisters", {
        p_source_proposal_id: sourceProposalId,
        p_changed_fields: changedFields,
        p_force_overwrite: Array.from(forceOverwrite),
      });
      if (err) throw err;
      if (onApplied) onApplied(data);
    } catch (err) {
      setError(err.message || "Sync failed");
      setApplying(false);
    }
  };

  const handleSkipAll = () => {
    if (onApplied) onApplied({ synced: [], skipped: [] });
  };

  if (loading) {
    return (
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,20,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div onClick={e => e.stopPropagation()} style={{ background: C.linenCard, borderRadius: 14, padding: 32, color: C.textMuted, fontFamily: F.ui }}>
          Checking sister proposals…
        </div>
      </div>
    );
  }

  if (!preview?.sisters?.length) return null;

  const totalPending = preview.sisters.reduce((s, sis) => s + sis.pending.length, 0);
  const totalConflicts = preview.sisters.reduce((s, sis) => s + sis.conflicts.length, 0);

  if (totalPending === 0 && totalConflicts === 0) return null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(28,24,20,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.linenCard, borderRadius: 14, padding: 32,
        width: 560, maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
        border: `1px solid ${C.borderStrong}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontFamily: F.display, fontSize: 20, color: C.textHead }}>Sync to Sister Proposals</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.textFaint, fontSize: 22, cursor: "pointer", fontFamily: F.display, padding: 0 }}>✕</button>
        </div>

        <p style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, marginTop: 0, marginBottom: 16 }}>
          Your edit changed fields shared with sister proposals. Review what will sync.
        </p>

        {preview.sisters.map(sis => (
          <div key={sis.sister_id} style={{ marginBottom: 16, background: C.linen, border: `1.5px solid ${C.borderStrong}`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontFamily: F.display, fontSize: 14, color: C.textHead, marginBottom: 10 }}>
              {sis.customer_name}
            </div>

            {sis.pending.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.green, fontFamily: F.ui, marginBottom: 4 }}>
                  Will auto-sync
                </div>
                {sis.pending.map((item, i) => (
                  <div key={i} style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody, padding: "2px 0" }}>
                    {item.scope ? `${item.scope} → ` : ""}{item.field}
                  </div>
                ))}
              </div>
            )}

            {sis.conflicts.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.amber, fontFamily: F.ui, marginBottom: 4 }}>
                  Conflicts (sister edited locally)
                </div>
                {sis.conflicts.map((item, i) => {
                  const key = `${sis.sister_id}:${item.field}`;
                  const forced = forceOverwrite.has(key);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                      <button
                        onClick={() => toggleForce(key)}
                        style={{
                          width: 18, height: 18, borderRadius: 3, flexShrink: 0, cursor: "pointer",
                          border: `2px solid ${forced ? C.teal : C.borderStrong}`,
                          background: forced ? C.teal : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                        }}
                      >
                        {forced && <span style={{ color: C.dark, fontSize: 11, fontWeight: 900 }}>✓</span>}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontFamily: F.ui, color: C.textBody }}>
                          {item.scope ? `${item.scope} → ` : ""}{item.field}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: F.ui, color: C.textFaint }}>
                          {forced ? "Will overwrite sister's version" : "Keeping sister's version"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {error && (
          <div style={{ color: "#e53935", fontSize: 13, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn sz="sm" onClick={handleApply} disabled={applying}>
            {applying ? "Syncing…" : `Sync ${totalPending + forceOverwrite.size} field${totalPending + forceOverwrite.size !== 1 ? "s" : ""}`}
          </Btn>
          <Btn sz="sm" v="ghost" onClick={handleSkipAll}>Skip All</Btn>
        </div>
      </div>
    </div>
  );
}
