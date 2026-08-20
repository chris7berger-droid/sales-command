// Zone 2 schedule-runway bar (docs/plans/home-follow-up-screen.md §2.3).
// Reads weeks/note via useTenantConfig (K6) so an admin edit re-renders through
// the provider. Admin/Manager get an inline editor; Sales is read-only. The
// color is the mode switch that drives Zone 3 expansion — exported as
// runwayColor() so Home derives expansion from the same rule.
import { useState } from "react";
import { C, F } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import { useTenantConfig } from "../../lib/TenantConfigContext";
import { updateTenantConfig } from "../../lib/config";
import Btn from "../Btn";

// weeks ≥ 3 green · 2 yellow · < 2 red · null → unset (neutral). The null→unset
// guard is the E1 fix: `null < 2` is true in JS, which would render RED with
// Zone 3 alarmed on day one — so null MUST short-circuit before the comparison.
export function runwayColor(weeks) {
  if (weeks === null || weeks === undefined) return "unset";
  if (weeks >= 3) return "green";
  if (weeks === 2) return "yellow";
  return "red";
}
const COLOR = { green: C.green, yellow: C.amber, red: C.red, unset: C.textFaint };

// The runway's job is to tell the rep what to DO, not just show a number.
function runwayMessage(color, weeks) {
  if (color === "unset") return "Set your runway to turn on the outbound list.";
  if (color === "green") return `Crews booked ${weeks} weeks out — you're covered.`;
  if (color === "yellow") return "Crews thin in 2 weeks.";
  return weeks <= 0 ? "No booked work ahead — call today." : `Crews thin in ${weeks} week${weeks === 1 ? "" : "s"}.`;
}

export default function RunwayBar({ canManage }) {
  const cfg = useTenantConfig();
  const weeks = cfg.schedule_runway_weeks ?? null;
  const note = cfg.schedule_runway_note || "";
  const color = runwayColor(weeks);

  const [editing, setEditing] = useState(false);
  const [wInput, setWInput] = useState("");
  const [nInput, setNInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function startEdit() {
    setWInput(weeks === null ? "" : String(weeks));
    setNInput(note);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true); setError(null);
    // Cleared input → null (unset), not 0 (N13): distinguish "cleared" from "typed 0".
    const trimmed = wInput.trim();
    const weeksVal = trimmed === "" ? null : Number(trimmed);
    if (weeksVal !== null && (!Number.isFinite(weeksVal) || weeksVal < 0)) {
      setError("Enter a whole number of weeks, or clear it."); setSaving(false); return;
    }
    try {
      await updateTenantConfig({
        schedule_runway_weeks: weeksVal,
        schedule_runway_note: nInput,
        schedule_runway_updated_at: new Date().toISOString(),
      });
      await cfg.refresh();
      setEditing(false);
    } catch (e) {
      setError(e.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const pct = weeks === null ? 0 : Math.max(6, Math.min(100, (weeks / 6) * 100));

  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 12, padding: "18px 22px", boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>Schedule Runway</div>
        {canManage && !editing && (
          <button onClick={startEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.tealDark, fontFamily: F.ui, fontWeight: 700 }}>✎ Edit</button>
        )}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
            Weeks of booked crew work ahead
            <input type="number" min="0" value={wInput} onChange={e => setWInput(e.target.value)} placeholder="—"
              style={{ display: "block", marginTop: 4, width: 120, background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 10px", fontFamily: F.body, fontSize: 14, color: C.textHead, WebkitAppearance: "none" }} />
          </label>
          <label style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>
            Note (optional)
            <input type="text" value={nInput} onChange={e => setNInput(e.target.value)}
              style={{ display: "block", marginTop: 4, width: "100%", boxSizing: "border-box", background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 8, padding: "8px 10px", fontFamily: F.body, fontSize: 13, color: C.textHead, WebkitAppearance: "none" }} />
          </label>
          {error && <div style={{ fontSize: 12, color: C.red, fontFamily: F.ui }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn v="primary" sz="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
            <Btn v="ghost" sz="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
          </div>
        </div>
      ) : color === "unset" ? (
        <div style={{ fontSize: 14, color: C.textMuted, fontFamily: F.body }}>
          Runway not set{canManage ? <> — <button onClick={startEdit} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.tealDark, fontFamily: F.ui, fontWeight: 700, fontSize: 13.5 }}>set it</button></> : "."}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 92 }}>
              <span style={{ fontSize: 40, fontWeight: 800, color: COLOR[color], fontFamily: F.display, lineHeight: 1 }}>{weeks}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em" }}>{weeks === 1 ? "week" : "weeks"}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ height: 10, borderRadius: 6, background: C.linenDeep, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: COLOR[color] }} />
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: COLOR[color], fontFamily: F.ui, marginTop: 8 }}>{runwayMessage(color, weeks)}</div>
            </div>
          </div>
          {note && <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.body, marginTop: 10 }}>{note}</div>}
          {cfg.schedule_runway_updated_at && (
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>updated {fmtD(cfg.schedule_runway_updated_at)}</div>
          )}
        </div>
      )}
    </div>
  );
}
