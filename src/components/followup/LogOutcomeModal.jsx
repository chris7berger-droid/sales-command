// Log-outcome modal (docs/plans/home-follow-up-screen.md §2.4).
// Outcome + optional note → logOutcome(). On success the target drops off the
// worklist (recent-outreach exclusion, keyed on customer_id). logged_by records
// who called. Corrections are a NEW superseding row (no edit/delete) — logging a
// newer outcome undoes a mis-tap (supersede rule, N8).
import { useState } from "react";
import { C, F } from "../../lib/tokens";
import { logOutcome, OUTCOMES } from "../../lib/followUp";
import Btn from "../Btn";

export default function LogOutcomeModal({ item, loggedBy, onClose, onLogged }) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!outcome) { setError("Pick an outcome."); return; }
    setSaving(true); setError(null);
    try {
      await logOutcome({
        source: item.source, outcome, note,
        customerId: item.customerId, callLogId: item.callLogId, loggedBy,
      });
      onLogged?.(outcome);
    } catch (e) {
      setError(e.message || "Couldn't save the outcome.");
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 460, maxWidth: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>Log Outcome</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body, marginBottom: 18 }}>{item.name || "—"}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {OUTCOMES.map(o => (
            <button key={o} onClick={() => setOutcome(o)} style={{
              textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontFamily: F.ui, fontSize: 13, fontWeight: 700,
              background: outcome === o ? C.dark : C.linenDeep,
              color: outcome === o ? C.teal : C.textMuted,
              border: `1.5px solid ${outcome === o ? C.teal : C.borderStrong}`,
            }}>{o}</button>
          ))}
        </div>

        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" rows={3}
          style={{ width: "100%", boxSizing: "border-box", background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: "10px 12px", fontFamily: F.body, fontSize: 13, color: C.textHead, WebkitAppearance: "none", resize: "vertical", marginBottom: 8 }} />

        {error && <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
          <Btn v="ghost" onClick={onClose} disabled={saving}>Cancel</Btn>
          <Btn v="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </div>
    </div>
  );
}
