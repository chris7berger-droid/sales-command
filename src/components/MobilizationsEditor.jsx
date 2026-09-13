import { useEffect, useRef, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmtD } from "../lib/utils";
import Btn from "./Btn";

const SITE_CONTACT_ROLE = "Job Site Contact";

function digits(s) {
  return String(s || "").replace(/\D/g, "");
}

function emptySiteContact(id) {
  return { id, source: "manual", first_name: "", last_name: "", phone: "", note: "", team_member_id: "" };
}

function contactLabel(c, teamById) {
  if (c.source === "team") return teamById.get(c.team_member_id)?.name || c.team_member_name || "Sales person";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact";
}

function pickSiteFields(mobs) {
  const src = (mobs || []).find(m => (m.site_contacts || []).length || m.access_note) || (mobs || [])[0];
  return { contacts: src?.site_contacts || [], access: src?.access_note || "" };
}

function stampSite(mobs, contacts, access) {
  return (mobs || []).map(m => ({ ...m, site_contacts: contacts, access_note: access }));
}

// Writer: Sales. People SoT = customer_contacts (manual) or team_members (sales
// person). Trip jsonb holds ids + a display snapshot + per-contact note + access_note.
// Do not copy people onto field_sow days (Field handoff v17).
async function resolveSiteContacts(mobs, customerId, teamMembers) {
  const teamById = new Map((teamMembers || []).map(t => [t.id, t]));
  let known = [];
  if (customerId) {
    const { data, error } = await supabase.from("customer_contacts").select("id, name, phone, role").eq("customer_id", customerId);
    if (error) throw error;
    known = data || [];
  }
  const out = [];
  for (const mob of mobs) {
    const contacts = [];
    for (const c of mob.site_contacts || []) {
      const note = String(c.note || "").trim();
      if (c.source === "team") {
        if (!c.team_member_id) continue;
        const tm = teamById.get(c.team_member_id);
        contacts.push({
          id: c.id,
          source: "team",
          team_member_id: c.team_member_id,
          team_member_name: tm?.name || c.team_member_name || "",
          phone: tm?.phone || c.phone || "",
          note,
        });
        continue;
      }
      const first_name = String(c.first_name || "").trim();
      const last_name = String(c.last_name || "").trim();
      const phone = String(c.phone || "").trim();
      if (!first_name && !last_name && !phone) continue;
      const name = [first_name, last_name].filter(Boolean).join(" ");
      let customer_contact_id = c.customer_contact_id || null;
      if (customerId) {
        const match = known.find(cc =>
          (customer_contact_id && cc.id === customer_contact_id)
          || (digits(phone) && digits(cc.phone) === digits(phone))
          || (name && String(cc.name || "").trim().toLowerCase() === name.toLowerCase())
        );
        if (match) {
          customer_contact_id = match.id;
          if (match.role === SITE_CONTACT_ROLE && (match.name !== name || match.phone !== phone)) {
            const { error } = await supabase.from("customer_contacts").update({ name, phone }).eq("id", match.id);
            if (error) throw error;
            match.name = name;
            match.phone = phone;
          }
        } else {
          const { data: inserted, error } = await supabase.from("customer_contacts").insert({
            customer_id: customerId,
            name,
            phone,
            role: SITE_CONTACT_ROLE,
          }).select("id, name, phone, role").single();
          if (error) throw error;
          customer_contact_id = inserted.id;
          known.push(inserted);
        }
      }
      contacts.push({ id: c.id, source: "manual", first_name, last_name, phone, note, customer_contact_id });
    }
    out.push({ ...mob, site_contacts: contacts, access_note: String(mob.access_note || "").trim() });
  }
  return out;
}

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
export default function MobilizationsEditor({ proposalId, onChange, readOnly = false, currentWtcId = null, onTagCurrentWtcDays }) {
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
  // Standard job = one mobilization for the whole job. multiMode is the user opting
  // OUT of standard to run multiple trips even while only one exists yet (so the
  // checkbox can toggle off without snapping back). Adding a 2nd trip is inherently
  // multi. Derived below as `isStandard`.
  const [multiMode, setMultiMode] = useState(false);
  // Last array confirmed written to the DB — the revert target when a write fails, so
  // an optimistic edit that errors can't leave the UI ahead of the DB (audit #1).
  const savedRef = useRef([]);
  // Serialize persists: chain each write behind the previous so issue order == apply
  // order and two rapid onBlur commits never race to a stale last-writer (audit #2).
  const writeChain = useRef(Promise.resolve());
  const customerIdRef = useRef(null);
  const teamRef = useRef([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [siteContacts, setSiteContacts] = useState([]);
  const [accessNote, setAccessNote] = useState("");

  // Same UUID generator the day/task factory uses (WTCCalculator uid()), with the
  // non-secure-context fallback.
  const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  useEffect(() => {
    if (!proposalId) return;
    let alive = true;
    supabase.from("proposals").select("mobilizations, call_log(customer_id)").eq("id", proposalId).single()
      .then(({ data }) => {
        if (!alive) return;
        const m = data?.mobilizations || [];
        customerIdRef.current = data?.call_log?.customer_id || null;
        savedRef.current = m;
        const picked = pickSiteFields(m);
        setMobs(m);
        setSiteContacts(picked.contacts.length ? picked.contacts : [emptySiteContact(uid())]);
        setAccessNote(picked.access);
        setLoaded(true);
        onChange?.(m);
      })
      .catch(() => { if (alive) setLoaded(true); });
    supabase.from("team_members").select("id, name, phone").eq("active", true).order("name")
      .then(({ data }) => {
        if (!alive) return;
        const list = data || [];
        teamRef.current = list;
        setTeamMembers(list);
      });
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
    if (next.some(m => !String(m.label ?? '').trim())) { setError('Enter a trip title before saving.'); return false; }
    try {
      next = await resolveSiteContacts(stampSite(next, siteContacts, accessNote), customerIdRef.current, teamRef.current);
    } catch (e) {
      setError(e.message || "Could not save job site contacts.");
      return false;
    }
    next = next.map(m => ({ ...m, label: m.label.trim() }));
    const ids = new Set(), seqs = new Set();
    for (const m of next) {
      if (ids.has(m.id) || seqs.has(m.seq)) { setError("Duplicate trip id/seq — not saved."); return false; }
      ids.add(m.id); seqs.add(m.seq);
    }
    setMobs(next); onChange?.(next); setSaving(true); setError(null);
    writeChain.current = writeChain.current.then(async () => {
      const { error: e } = await supabase.from("proposals").update({ mobilizations: next }).eq("id", proposalId);
      if (e) {
        setMobs(savedRef.current); onChange?.(savedRef.current); setError(e.message); setSaving(false);
        const picked = pickSiteFields(savedRef.current);
        setSiteContacts(picked.contacts.length ? picked.contacts : [emptySiteContact(uid())]);
        setAccessNote(picked.access);
        return;
      }
      // Re-assert `next` on success: a prior queued write may have failed and reverted
      // the UI to an older savedRef; this reconciles it back to what we just committed.
      savedRef.current = next; setMobs(next); onChange?.(next); setSaving(false);
      const picked = pickSiteFields(next);
      setSiteContacts(picked.contacts.length ? picked.contacts : [emptySiteContact(uid())]);
      setAccessNote(picked.access);
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    });
    return true;
  }

  function addMob() {
    // Monotonic seq = max(existing) + 1, floored at 0 so the empty-list reduce
    // never yields -Infinity (round-2 R5). Never length+1 — that would reuse a
    // retired seq after a delete and mislabel the wire. Add LOCALLY and open it in
    // edit mode; nothing hits the DB (and the day dropdown never sees a blank mob)
    // until Save. onChange is deliberately NOT called here for the same reason.
    const nextSeq = mobs.reduce((mx, m) => Math.max(mx, m.seq || 0), 0) + 1;
    const row = { id: uid(), seq: nextSeq, label: "", start_date: null, end_date: null, site_contacts: siteContacts, access_note: accessNote };
    setMobs(ms => [...ms, row]);
    setEditingId(row.id);
  }

  // Local-only field edit (controlled input); the DB write happens on Save.
  const setField = (id, key, val) => setMobs(ms => ms.map(m => m.id === id ? { ...m, [key]: val } : m));
  const setContact = (contactId, patch) => setSiteContacts(cs => cs.map(c => c.id === contactId ? { ...c, ...patch } : c));
  const addContact = () => setSiteContacts(cs => [...cs, emptySiteContact(uid())]);
  const removeContact = contactId => setSiteContacts(cs => cs.filter(c => c.id !== contactId));

  // Save the row being edited: persist the whole array, collapse to the summary
  // view, and flash a per-row ✓. persist() handles the write + error-revert.
  async function saveRow(id) {
    if (mobs.some(m => !String(m.label ?? '').trim())) { setError('Enter a trip title before saving.'); return; }
    const ok = await persist(mobs);
    if (!ok) return;
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
    const picked = pickSiteFields(savedRef.current);
    setSiteContacts(picked.contacts.length ? picked.contacts : [emptySiteContact(uid())]);
    setAccessNote(picked.access);
    setEditingId(null);
    setError(null);
  }

  async function saveSite() {
    if (mobs.length === 0) { setError("Add a trip or check Standard job first."); return; }
    if (mobs.some(m => !String(m.label ?? "").trim())) { setError("Enter a trip title before saving."); return; }
    await persist(mobs);
  }

  // Standard job — collapse to a single mobilization (Mob 1) and tag EVERY field-SOW
  // day on the whole job to it, so no per-day picking is needed. Whole-job scope
  // (ratified): the current WTC's days route through onTagCurrentWtcDays so the open
  // SOW tab's local state stays in sync (and its autosave persists them); every OTHER
  // WTC on the proposal is tagged with a direct DB write. New days added later
  // auto-tag to the single mob (the day factory defaults to mobilizations[0]).
  async function applyStandardJob() {
    if (mobs.length > 1 && !window.confirm(
      "Standard job uses a single trip. Trips 2+ will be removed and every field-SOW day tagged to Trip 1. Continue?"
    )) return;
    const mob = mobs[0] || { id: uid(), seq: 1, label: "", start_date: null, end_date: null, site_contacts: siteContacts, access_note: accessNote };
    if (!String(mob.label ?? '').trim()) {
      setMobs([mob]); setEditingId(mob.id); setMultiMode(true);
      setError('Enter and save a trip title, then select Standard job.');
      return;
    }
    setMultiMode(false);
    setEditingId(null);
    // 1. Collapse the proposal's mobilization list to just this one (persist + onChange).
    persist([mob]);
    // 2. Tag the currently-open WTC's days via the SOW tab (keeps its local state honest).
    onTagCurrentWtcDays?.(mob.id);
    // 3. Tag every other WTC's days directly. field_sow is an array of day objects.
    try {
      const { data: rows } = await supabase.from("proposal_wtc").select("id, field_sow").eq("proposal_id", proposalId);
      for (const r of (rows || [])) {
        if (r.id === currentWtcId) continue; // handled by the callback above
        const days = r.field_sow || [];
        if (days.length === 0) continue;
        const tagged = days.map(d => ({ ...d, mobilization_id: mob.id }));
        await supabase.from("proposal_wtc").update({ field_sow: tagged }).eq("id", r.id);
      }
    } catch (e) {
      setError("Tagged this work type, but couldn't tag the other work types' days: " + (e.message || e));
    }
  }

  async function deleteMob(mob) {
    // In-use scan before delete (§4 B3/B1): count days across every WTC's field_sow
    // that still tag this mobilization by id, and warn — deleting leaves detectable
    // orphans that [K1] will block at send, so surface it now instead of at send.
    const { data: wtcRows } = await supabase.from("proposal_wtc").select("field_sow").eq("proposal_id", proposalId);
    let count = 0;
    (wtcRows || []).forEach(w => (w.field_sow || []).forEach(d => { if (d.mobilization_id === mob.id) count++; }));
    if (count > 0 && !window.confirm(
      `Trip ${mob.seq} — ${mob.label || "(no label)"} is tagged on ${count} field-SOW day(s). ` +
      `Deleting it will leave those days without a trip and block Send to Schedule until you re-tag them. Delete anyway?`
    )) return;
    persist(mobs.filter(m => m.id !== mob.id));
  }

  const inp = { padding: "6px 8px", fontSize: 12, fontFamily: F.ui, border: `1px solid ${C.borderStrong}`, borderRadius: 5, background: C.linenDeep, color: C.textBody, WebkitAppearance: "none", boxSizing: "border-box" };

  // Standard job = exactly one trip, user not opted into multi. The single mob shows
  // without a Delete, and +Add is hidden — adding a trip is how you go multi.
  const configuredStandard = !readOnly && !multiMode && mobs.length === 1;
  const showAdd = !readOnly && !configuredStandard;

  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Step 1 · Trips</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {saving && <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>Saving…</span>}
          {saved && !saving && <span style={{ fontSize: 11, color: C.green, fontFamily: F.ui }}>✓ Saved</span>}
          {showAdd && <Btn sz="sm" onClick={addMob} disabled={!loaded || saving || editingId != null}>+ Add Trip</Btn>}
        </div>
      </div>
      {/* Proposal-wide scope note — the editor lives inside a per-WTC tab, but the list
          is shared by every work type on the proposal. Say so, always visible. */}
      <div style={{ fontSize: 11.5, color: C.tealDark, fontFamily: F.ui, fontWeight: 700, background: "rgba(48,207,172,0.10)", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>
        ⓘ These trips apply to the whole job — every work type on this proposal shares this one list.
      </div>

      {/* Standard-job shortcut — most jobs are a single trip. Checking it makes ONE
          mobilization and tags every field-SOW day on the whole job to it, so there's
          no per-day picking. Adding a second trip switches to multiple mobilizations. */}
      {!readOnly && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 11px", background: C.linen, border: `1px solid ${configuredStandard ? C.tealDark : C.border}`, borderRadius: 8, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={configuredStandard} disabled={!loaded || saving}
            onChange={e => { if (e.target.checked) applyStandardJob(); else setMultiMode(true); }}
            style={{ marginTop: 1, width: 15, height: 15, accentColor: C.tealDark, cursor: "pointer", flexShrink: 0 }} />
          <span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.textHead, fontFamily: F.ui }}>Standard job — one trip for the whole job</span>
            <span style={{ display: "block", fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 2, lineHeight: 1.4 }}>
              Creates a single trip (Trip 1) and tags every field-SOW day on this job to it — across every work type — so you don't pick a trip per day. Uncheck, or add a second trip, if the job needs more than one trip.
            </span>
          </span>
        </label>
      )}

      <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginBottom: 12 }}>
        {readOnly
          ? "This job is live — its trips are now owned by Schedule Command. Add or change trips (including go-back work) there; edits here no longer reach the scheduled job."
          : configuredStandard
            ? "One trip for the whole job. Every field-SOW day is tagged to Trip 1."
            : "Group the job into trips, then tag each field-SOW day below to one of them."}
      </div>

      {(() => {
        const teamById = new Map(teamMembers.map(t => [t.id, t]));
        const lbl = { fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 };
        const filled = siteContacts.filter(c => c.source === "team" ? c.team_member_id : (c.first_name || c.last_name || c.phone));
        if (readOnly) {
          return (
            <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={lbl}>Job Site Contact</div>
              {filled.length === 0
                ? <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginBottom: 8 }}>None</div>
                : filled.map(c => (
                  <div key={c.id} style={{ fontSize: 12, color: C.textBody, fontFamily: F.ui, marginBottom: 4 }}>
                    {contactLabel(c, teamById)}{c.phone ? ` · ${c.phone}` : ""}{c.note ? ` — ${c.note}` : ""}
                  </div>
                ))}
              <div style={{ ...lbl, marginTop: 8 }}>Access info</div>
              <div style={{ fontSize: 12, color: accessNote ? C.textBody : C.textFaint, fontFamily: F.ui, whiteSpace: "pre-wrap" }}>{accessNote || "None"}</div>
            </div>
          );
        }
        return (
          <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ ...lbl, marginBottom: 0 }}>Job Site Contact</div>
              <button type="button" onClick={addContact} style={{ background: "none", border: `1px dashed ${C.borderStrong}`, borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, color: C.textBody, cursor: "pointer", fontFamily: F.display }}>＋ Add</button>
            </div>
            {siteContacts.map(c => (
              <div key={c.id} style={{ background: C.linenDeep, border: `1px solid ${C.border}`, borderRadius: 7, padding: 8, marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <select aria-label="Contact type" value={c.source || "manual"} onChange={e => setContact(c.id, e.target.value === "team"
                    ? { source: "team", first_name: "", last_name: "", customer_contact_id: null, team_member_id: "" }
                    : { source: "manual", team_member_id: "", team_member_name: "" })}
                    style={{ ...inp, width: 170 }}>
                    <option value="manual">First / Last / Phone</option>
                    <option value="team">Sales person</option>
                  </select>
                  <button type="button" onClick={() => removeContact(c.id)} style={{ background: "none", border: "none", color: C.textFaint, cursor: "pointer", fontSize: 16, lineHeight: 1, marginLeft: "auto" }} aria-label="Remove contact">×</button>
                </div>
                {c.source === "team" ? (
                  <select aria-label="Sales person" value={c.team_member_id || ""} onChange={e => setContact(c.id, { team_member_id: e.target.value })}
                    style={{ ...inp, width: "100%", marginBottom: 6 }}>
                    <option value="">— select —</option>
                    {teamMembers.map(t => <option key={t.id} value={t.id}>{t.name}{t.phone ? ` · ${t.phone}` : ""}</option>)}
                  </select>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <input aria-label="First name" value={c.first_name || ""} placeholder="First name" onChange={e => setContact(c.id, { first_name: e.target.value })} style={{ ...inp, flex: 1, minWidth: 110 }} />
                    <input aria-label="Last name" value={c.last_name || ""} placeholder="Last name" onChange={e => setContact(c.id, { last_name: e.target.value })} style={{ ...inp, flex: 1, minWidth: 110 }} />
                    <input aria-label="Phone" value={c.phone || ""} placeholder="Phone" onChange={e => setContact(c.id, { phone: e.target.value })} style={{ ...inp, width: 140 }} />
                  </div>
                )}
                <input aria-label="Contact note" value={c.note || ""} placeholder="Note" onChange={e => setContact(c.id, { note: e.target.value })} style={{ ...inp, width: "100%" }} />
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <div style={lbl}>Access info</div>
              <textarea aria-label="Access info" value={accessNote} rows={3} placeholder="Gate, lock, badge, hours…"
                onChange={e => setAccessNote(e.target.value)}
                style={{ ...inp, width: "100%", resize: "vertical" }} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Btn sz="sm" onClick={saveSite} disabled={!loaded || saving}>Save</Btn>
            </div>
          </div>
        );
      })()}
      {error && <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui, marginBottom: 10 }}>{error}</div>}
      {!loaded ? (
        <div style={{ fontSize: 12.5, color: C.textFaint, fontFamily: F.ui, padding: "8px 0" }}>Loading…</div>
      ) : mobs.length === 0 ? (
        <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "10px 0" }}>
          {readOnly ? "No trips were authored before this job went live." : "Most jobs are one trip — check Standard job above. Or add multiple trips."}
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
            <div key={mob.id} style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "10px 12px", background: C.linen, border: `1.5px solid ${C.tealDark}`, borderRadius: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <div style={{ width: 46, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>Trip</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{mob.seq}</div>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, marginBottom: 3 }}>Label</div>
                <input autoFocus aria-label="Trip title" required value={mob.label || ""} placeholder="Trip title (required), e.g. Prep & mask" onChange={e => setField(mob.id, "label", e.target.value)} style={{ ...inp, width: "100%" }} />
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
            <span style={{ fontSize: 13, fontWeight: 800, color: C.tealDark, fontFamily: F.display, minWidth: 52 }}>Trip {mob.seq}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.textBody, fontFamily: F.ui }}>{mob.label || <span style={{ color: C.textFaint, fontWeight: 400 }}>(no label)</span>}</span>
            <span style={{ fontSize: 11.5, color: C.textMuted, fontFamily: F.ui }}>{dateText}</span>
            {justSavedId === mob.id && <span style={{ fontSize: 11, fontWeight: 700, color: C.green, fontFamily: F.ui }}>✓ Saved</span>}
            {!readOnly && (
              <>
                <button onClick={() => setEditingId(mob.id)} disabled={anyEditing} style={{ background: "none", border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: C.textBody, cursor: anyEditing ? "default" : "pointer", opacity: anyEditing ? 0.4 : 1, fontFamily: F.display, flexShrink: 0 }}>Edit</button>
                {/* No Delete in standard mode — the single trip stays; uncheck Standard job to manage multiple. */}
                {!configuredStandard && <button onClick={() => deleteMob(mob)} disabled={anyEditing} title="Delete trip" style={{ background: "none", border: `1px solid ${C.red}`, borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, color: C.red, cursor: anyEditing ? "default" : "pointer", opacity: anyEditing ? 0.4 : 1, fontFamily: F.display, flexShrink: 0 }}>Delete</button>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
