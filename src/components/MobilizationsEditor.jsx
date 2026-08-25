import { useEffect, useRef, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmtD } from "../lib/utils";
import Btn from "./Btn";

// Mobilizations editor (material_flow Screen 1 §4). Writes proposals.mobilizations
// jsonb — the proposal-level bid intent, shared by EVERY work type (WTC) on the
// proposal. Relocated 2026-08-25 out of the proposal page and into each WTC's Scope
// of Work tab, as step 1 of building the field SOW; the per-day mobilization dropdown
// in that same tab reads this list.
//
// Two-identity model (§2): each entry carries a stable Sales-only `id` (uuid, what
// days bind to) plus a wire `seq` (int, what Schedule reads off job_wtcs.field_sow
// after send). seq is monotonic (max+1, never length+1 / never reused) so a
// delete-then-add can't recycle a retired seq onto the wire.
//
// readOnly — once the proposal is committed (Sent/Signed/Sold) the live job carries
// its OWN copy (mobilization_seq stamped on job_wtcs.field_sow, the Sales uuid
// stripped at send), so editing proposals.mobilizations here would be a no-op on the
// live job. We render read-only and point at Schedule Command, which owns post-send
// trips (go-backs, added mobilizations) without ever unlocking the proposal.
//
// onChange — notifies the parent WTC on every list change so its per-day dropdown
// refreshes the instant a trip is added/removed, without a re-fetch.
export default function MobilizationsEditor({ proposalId, onChange, readOnly = false }) {
  const [mobs, setMobs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  // Which row is open in edit mode (its id), and which row just saved (brief ✓).
  // A saved mobilization shows as a settled summary line; Edit / + Add open the fields.
  const [editingId, setEditingId] = useState(null);
  const [justSavedId, setJustSavedId] = useState(null);
  const savedTimer = useRef(null);
  // Last array confirmed written to the DB — the revert target when a write fails, so
  // an optimistic edit that errors can't leave the UI ahead of the DB (audit #1).
  const savedRef = useRef([]);
  // Serialize persists: chain each write behind the previous so issue order == apply
  // order and two rapid onBlur commits never race to a stale last-writer (audit #2).
  const writeChain = useRef(Promise.resolve());

  // Same UUID generator the day/task factory uses (WTCCalculator uid()), with the
  // non-secure-context fallback.
  const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  useEffect(() => {
    if (!proposalId) return;
    let alive = true;
    supabase.from("proposals").select("mobilizations").eq("id", proposalId).single()
      .then(({ data }) => { if (alive) { const m = data?.mobilizations || []; savedRef.current = m; setMobs(m); setLoaded(true); onChange?.(m); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [proposalId]);

  // Persist the given array to proposals.mobilizations. Optimistic: reflect `next`
  // locally right away (add / delete / inline-edit all funnel through here on ONE
  // path), then write. Duplicate guard (§4 B4): reject two entries sharing an id or a
  // seq before the write. Writes are SERIALIZED through writeChain so two rapid onBlur
  // commits can't land out of order and silently drop the later edit (audit #2). On DB
  // error, revert local state to the last DB-confirmed snapshot (savedRef) so the UI
  // never sits ahead of the DB, and surface the message (audit #1). Every optimistic
  // hop also fires onChange so the parent WTC's day dropdown tracks the same list.
  async function persist(next) {
    const ids = new Set(), seqs = new Set();
    for (const m of next) {
      if (ids.has(m.id) || seqs.has(m.seq)) { setError("Duplicate mobilization id/seq — not saved."); return; }
      ids.add(m.id); seqs.add(m.seq);
    }
    setMobs(next); onChange?.(next); setSaving(true); setError(null);
    writeChain.current = writeChain.current.then(async () => {
      const { error: e } = await supabase.from("proposals").update({ mobilizations: next }).eq("id", proposalId);
      if (e) { setMobs(savedRef.current); onChange?.(savedRef.current); setError(e.message); setSaving(false); return; }
      // Re-assert `next` on success: a prior queued write may have failed and reverted
      // the UI to an older savedRef; this reconciles it back to what we just committed.
      savedRef.current = next; setMobs(next); onChange?.(next); setSaving(false);
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    });
  }

  function addMob() {
    // Monotonic seq = max(existing) + 1, floored at 0 so the empty-list reduce
    // never yields -Infinity (round-2 R5). Never length+1 — that would reuse a
    // retired seq after a delete and mislabel the wire. Add LOCALLY and open it in
    // edit mode; nothing hits the DB (and the day dropdown never sees a blank mob)
    // until Save. onChange is deliberately NOT called here for the same reason.
    const nextSeq = mobs.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1;
    const row = { id: uid(), seq: nextSeq, label: "", start_date: null, end_date: null };
    setMobs(ms => [...ms, row]);
    setEditingId(row.id);
  }

  // Local-only field edit (controlled input); the DB write happens on Save.
  const setField = (id, key, val) => setMobs(ms => ms.map(m => m.id === id ? { ...m, [key]: val } : m));

  // Save the row being edited: persist the whole array, collapse to the summary
  // view, and flash a per-row ✓. persist() handles the write + error-revert.
  function saveRow(id) {
    persist(mobs);
    setEditingId(null);
    setJustSavedId(id);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSavedId(cur => (cur === id ? null : cur)), 1800);
  }

  // Cancel: discard local edits by restoring the last DB-confirmed snapshot. Drops
  // a brand-new unsaved row (it isn't in savedRef) and reverts field edits on an
  // existing one. Keeps the day dropdown honest via onChange.
  function cancelRow() {
    setMobs(savedRef.current);
    onChange?.(savedRef.current);
    setEditingId(null);
    setError(null);
  }

  async function deleteMob(mob) {
    // In-use scan before delete (§4 B3/B1): count days across every WTC's field_sow
    // that still tag this mobilization by id, and warn — deleting leaves detectable
    // orphans that [K1] will block at send, so surface it now instead of at send.
    const { data: wtcRows } = await supabase.from("proposal_wtc").select("field_sow").eq("proposal_id", proposalId);
    let count = 0;
    (wtcRows || []).forEach(w => (w.field_sow || []).forEach(d => { if (d.mobilization_id === mob.id) count++; }));
    if (count > 0 && !window.confirm(
      `Mobilization ${mob.seq} — ${mob.label || "(no label)"} is tagged on ${count} field-SOW day(s). ` +
      `Deleting it will leave those days without a mobilization and block Send to Schedule until you re-tag them. Delete anyway?`
    )) return;
    persist(mobs.filter(m => m.id !== mob.id));
  }

  const inp = { padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none", boxSizing: "border-box" };

  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Step 1 · Mobilizations</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saving && <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Saving…</span>}
          {saved && !saving && <span style={{ fontSize: 11, color: C.green, fontFamily: F.ui }}>✓ Saved</span>}
          {!readOnly && <Btn sz="sm" onClick={addMob} disabled={!loaded || saving || editingId != null}>+ Add Mobilization</Btn>}
        </div>
      </div>
      {/* Proposal-wide scope note — the editor lives inside a per-WTC tab, but the list
          is shared by every work type on the proposal. Say so, always visible. */}
      <div style={{ fontSize: 11.5, color: C.tealDark, fontFamily: F.ui, fontWeight: 700, background: "rgba(48,207,172,0.10)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>
        ⓘ These mobilizations (trips to site) apply to the whole job — every work type on this proposal shares this one list.
      </div>
      <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginBottom: 12 }}>
        {readOnly
          ? "This job is live — its mobilizations are now owned by Schedule Command. Add or change trips (including go-back work) there; edits here no longer reach the scheduled job."
          : "Group the job into mobilizations (trips to site), then tag each field-SOW day below to one of them."}
      </div>
      {error && <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>}
      {!loaded ? (
        <div style={{ fontSize: 12.5, color: C.textFaint, fontFamily: F.ui, padding: "8px 0" }}>Loading…</div>
      ) : mobs.length === 0 ? (
        <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "10px 0" }}>
          {readOnly ? "No mobilizations were authored before this job went live." : "No mobilizations yet. Add one to start grouping the field SOW."}
        </div>
      ) : mobs.map(mob => {
        const editing = editingId === mob.id;
        const anyEditing = editingId != null;
        const dateText = (mob.start_date || mob.end_date)
          ? `${mob.start_date ? fmtD(mob.start_date) : "—"} → ${mob.end_date ? fmtD(mob.end_date) : "—"}`
          : "no dates set";

        // Edit mode — inline fields + Save / Cancel. Teal border marks the open row.
        if (editing) {
          return (
            <div key={mob.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", background: C.linen, border: `1.5px solid ${C.tealDark}`, borderRadius: 8, marginBottom: 6 }}>
              <div style={{ width: 46, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>Mob</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{mob.seq}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>Label</div>
                <input autoFocus value={mob.label || ""} placeholder="e.g. Prep & mask" onChange={e => setField(mob.id, "label", e.target.value)} style={{ ...inp, width: "100%" }} />
              </div>
              <div style={{ width: 130, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>Start</div>
                <input type="date" value={mob.start_date || ""} onChange={e => setField(mob.id, "start_date", e.target.value || null)} style={{ ...inp, width: "100%" }} />
              </div>
              <div style={{ width: 130, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>End</div>
                <input type="date" value={mob.end_date || ""} min={mob.start_date || ""} onChange={e => setField(mob.id, "end_date", e.target.value || null)} style={{ ...inp, width: "100%" }} />
              </div>
              <Btn sz="sm" onClick={() => saveRow(mob.id)}>Save</Btn>
              <button onClick={cancelRow} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 700, color: C.textBody, cursor: "pointer", fontFamily: F.display, flexShrink: 0 }}>Cancel</button>
            </div>
          );
        }

        // Display (saved) mode — settled summary + Edit / Delete, with a brief ✓.
        return (
          <div key={mob.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.tealDark, fontFamily: F.display, minWidth: 52 }}>Mob {mob.seq}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui }}>{mob.label || <span style={{ color: C.textFaint, fontWeight: 400 }}>(no label)</span>}</span>
            <span style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui }}>{dateText}</span>
            {justSavedId === mob.id && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, fontFamily: F.ui }}>✓ Saved</span>}
            {!readOnly && (
              <>
                <button onClick={() => setEditingId(mob.id)} disabled={anyEditing} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: C.textBody, cursor: anyEditing ? "default" : "pointer", opacity: anyEditing ? 0.4 : 1, fontFamily: F.display, flexShrink: 0 }}>Edit</button>
                <button onClick={() => deleteMob(mob)} disabled={anyEditing} title="Delete mobilization" style={{ background: "none", border: `1px solid ${C.red}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: C.red, cursor: anyEditing ? "default" : "pointer", opacity: anyEditing ? 0.4 : 1, fontFamily: F.display, flexShrink: 0 }}>Delete</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
