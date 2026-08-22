// Box 6 — WHERE TO HUNT (home-engagement-redesign.md Box 6).
// The opportunity finder ("coach, not scoreboard"): serves ONE auto-ranked pick
// so even an unmotivated rep is handed a move. Refresh names its criteria and
// serves the next angle. Non-destructive — step Back or Pin to return to the best
// you've seen (session-local, no DB). Every nudge shows its reason. Tap → drops
// into that call. Four zero-QB angles ship in v1 (§Box 6). Beneath the served
// card sit the dormant + gone-quiet lists, each $-tagged so a call feels like
// chasing money.
import { useState, useMemo } from "react";
import { C, F, R, SP } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";
import Btn from "../Btn";
import OutboundCard from "./OutboundCard";

const LIST_CAP = 4;

// Build the ordered angle list from this rep's quiet bids + dormant book. Each
// angle yields one card (or null when it has no data — those are skipped, so a
// thin pipeline never serves an empty coach).
function buildAngles(goneQuiet, dormant) {
  const byValueDesc = [...goneQuiet].sort((a, b) => (b.value || 0) - (a.value || 0));
  const byValueAsc  = [...goneQuiet].filter(q => q.value > 0).sort((a, b) => (a.value || 0) - (b.value || 0));
  const opened      = goneQuiet.find(q => q.opened);
  const yourGuy     = [...dormant].sort((a, b) => (b.jobCount || 0) - (a.jobCount || 0))[0];

  const angles = [
    byValueDesc[0] && {
      key: "biggest", crit: "Biggest bid hanging",
      card: { ...byValueDesc[0], why: `Largest quiet bid — ${fmt$(byValueDesc[0].value)} still on the table.` },
    },
    opened && {
      key: "almost", crit: "Almost yes",
      card: { ...opened, why: `They opened this bid but never signed${opened.value ? ` — ${fmt$(opened.value)}` : ""}.` },
    },
    yourGuy && yourGuy.jobCount > 1 && {
      key: "theirguy", crit: "You're their guy",
      card: { ...yourGuy, why: `You've done ${yourGuy.jobCount} jobs with them${yourGuy.value ? ` (${fmt$(yourGuy.value)})` : ""} — gone quiet.` },
    },
    byValueAsc[0] && {
      key: "quickwin", crit: "Quick win",
      card: { ...byValueAsc[0], why: `Small and stale — an easy roll-start (${fmt$(byValueAsc[0].value)}).` },
    },
  ].filter(Boolean);

  // de-dupe angles that resolved to the same job/customer (keep the first/strongest)
  const seen = new Set();
  return angles.filter(a => {
    const id = a.card.callLogId || a.card.customerId;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  });
}

export default function HuntBox({ goneQuiet, dormant, onGoTo, onLog }) {
  const angles = useMemo(() => buildAngles(goneQuiet, dormant), [goneQuiet, dormant]);
  const [cursor, setCursor] = useState(0);
  const [pinned, setPinned] = useState(null); // index the rep pinned to return to
  const [showAll, setShowAll] = useState(false);

  const served = angles.length ? angles[cursor % angles.length] : null;
  const advance = () => setCursor(c => c + 1);
  const back = () => setCursor(c => Math.max(0, c - 1));

  const pile = [...goneQuiet, ...dormant];
  const list = showAll ? pile : pile.slice(0, LIST_CAP);
  const pileValue = pile.reduce((s, x) => s + (x.value || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.lg }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textLight, fontFamily: F.ui }}>Where To Hunt</div>

      {/* served card — the hero of this box, dark panel, one clear move */}
      {served ? (
        <div style={{ background: C.dark, borderRadius: R.hero, padding: SP.xl, display: "flex", flexDirection: "column", gap: SP.md }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.teal, fontFamily: F.ui }}>
              {served.crit}
            </span>
            {served.card.value > 0 && (
              <span style={{ fontSize: 15, fontWeight: 800, color: C.teal, fontFamily: F.display }}>{fmt$(served.card.value)}</span>
            )}
          </div>
          {/* content side-by-side: message on the left, actions on the right, so the tile stays short */}
          <div style={{ display: "flex", gap: SP.lg, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", gap: SP.xs }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f3ede1", fontFamily: F.display, letterSpacing: "0.02em", lineHeight: 1.1 }}>
                {served.card.name || served.card.lastJob || "—"} has gone dark.
              </div>
              <div style={{ fontSize: 13, color: "rgba(243,237,225,0.72)", fontFamily: F.body, lineHeight: 1.4 }}>
                {served.card.why}
              </div>
            </div>
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: SP.sm, alignItems: "flex-start" }}>
              <Btn v="teal" sz="md" onClick={() => onGoTo(served.card)}>Go to this job</Btn>
              <div style={{ display: "flex", alignItems: "center", gap: SP.sm }}>
                <button onClick={advance} title="Serve the next angle"
                  style={{ background: "transparent", border: `1.5px solid ${C.tealBorder}`, color: C.teal, borderRadius: R.chip, padding: "6px 12px", cursor: "pointer", fontFamily: F.display, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  ↻ Refresh
                </button>
                {cursor > 0 && (
                  <button onClick={back} title="Step back"
                    style={{ background: "transparent", border: "none", color: "rgba(243,237,225,0.45)", cursor: "pointer", fontFamily: F.ui, fontSize: 12, fontWeight: 700 }}>
                    ← back
                  </button>
                )}
                <button
                  onClick={() => (pinned === cursor ? setPinned(null) : setPinned(cursor))}
                  title={pinned === cursor ? "Unpin" : "Pin to return to this one"}
                  style={{ background: "transparent", border: "none", color: pinned === cursor ? C.teal : "rgba(243,237,225,0.35)", cursor: "pointer", fontSize: 15 }}>
                  {pinned === cursor ? "★" : "☆"}
                </button>
                {pinned != null && pinned !== cursor && (
                  <button onClick={() => setCursor(pinned)}
                    style={{ background: "transparent", border: "none", color: C.teal, cursor: "pointer", fontFamily: F.ui, fontSize: 12, fontWeight: 700 }}>
                    ★ pinned
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, fontSize: 14, color: C.textMuted, fontFamily: F.body }}>
          Nothing quiet to chase right now — your book's warm.
        </div>
      )}

      {/* dormant + gone-quiet lists, $-tagged, calmer beneath the coach.
          Header names the FULL pile (count + $ available) so the money-bar
          "revive a few of your N sleepers" number has a home. */}
      {pile.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SP.sm }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui }}>
              Sleepers · {pile.length}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.tealDark, fontFamily: F.ui }}>{fmt$(pileValue)} available</span>
          </div>
          {list.map(o => <OutboundCard key={`${o.source}-${o.customerId || o.callLogId}`} item={o} onLog={onLog} onOpen={onGoTo} />)}
          {pile.length > LIST_CAP && (
            <button onClick={() => setShowAll(s => !s)}
              style={{ alignSelf: "flex-start", marginTop: SP.xs, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {showAll ? "Show fewer ▴" : `+ ${pile.length - LIST_CAP} more ▾`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
