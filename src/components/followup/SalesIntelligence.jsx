// Sales intelligence — "Where to Dig" (compact priority summary) + "Where to
// Hunt / Sleepers" + the log-a-call flow. RELOCATED from Home (F47) to Call Log
// per the 2026-08-22 rebalance (Home = performance, Call Log = action), then laid
// out two-column to match the mockup. The engine is unchanged: useAlerts()
// snapshot, followUp.js selectors, suppression/supersede, and the Log-outcome
// write. Leaf components (HuntBox / HuntResultsPanel / …) are reused as-is.
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, SP, R } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";
import { useAlerts } from "../../lib/alerts";
import { owedItems, huntResults, dormantCustomers, goneQuietBids, digSummary, SUPPRESSION_WINDOWS } from "../../lib/followUp";
import HuntBox from "./HuntBox";
import HuntResultsPanel from "./HuntResultsPanel";
import HuntResultsModal from "./HuntResultsModal";
import LogOutcomeModal from "./LogOutcomeModal";

const OWED_PREVIEW = 8;

// One compact priority card: numbered badge + title + sub, in the mockup's style.
// Clickable → filters the Call Log table to that bucket.
function DigCard({ n, color, title, sub, onClick }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, background: C.linen, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: R.chip, padding: "14px 16px", cursor: onClick ? "pointer" : "default", transition: "background 0.12s" }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = C.linenLight; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = C.linen; }}>
      <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: `2px solid ${color}`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, fontFamily: F.display }}>{n}</span>
      <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{title}</span>
        <span style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.body }}>{sub}</span>
      </span>
      <span style={{ color: C.textFaint, fontSize: 18 }}>›</span>
    </button>
  );
}

export default function SalesIntelligence({ repName = "", displayName = "", onDig }) {
  const navigate = useNavigate();
  const { snapshot, refresh } = useAlerts();

  const [logTarget, setLogTarget] = useState(null);
  const [showAllOwed, setShowAllOwed] = useState(false);
  const [showRevivals, setShowRevivals] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const dig = useMemo(() => (snapshot ? digSummary(snapshot, { repName }) : null), [snapshot, repName]);
  const owed = useMemo(() => (snapshot ? owedItems(snapshot, { repName }) : []), [snapshot, repName]);
  const repGoneQuiet = useMemo(() => (snapshot ? goneQuietBids(snapshot, { repName }) : []), [snapshot, repName]);
  const repDormant = useMemo(() => (snapshot ? dormantCustomers(snapshot, { repName }) : []), [snapshot, repName]);
  const results = useMemo(() => (snapshot ? huntResults(snapshot, { repName }) : { callsThisWeek: 0, reengaged: 0 }), [snapshot, repName]);

  if (!snapshot || !dig) return null;

  const onGoTo = (card) => {
    if (card.callLogId) navigate(`/calllog/${card.callLogId}`, { state: { from: "/calllog" } });
    else if (card.customerId) navigate(`/customers/${card.customerId}`);
  };

  const label = (t, right) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: SP.md }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textLight, fontFamily: F.ui }}>{t}</span>
      {right}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: SP.xl, alignItems: "start" }}>

      {/* ── LEFT · WHERE TO DIG (compact priority summary) ────────────────── */}
      <div>
        {label("Where To Dig (Priority)", owed.length > 0 && (
          <button onClick={() => setShowAllOwed(s => !s)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.tealDark, fontFamily: F.ui }}>
            {showAllOwed ? "Hide list ▴" : `See all (${owed.length}) →`}
          </button>
        ))}
        <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
          <DigCard n={dig.dueToday.count} color={C.red} title="Bids due today"
            sub={dig.dueToday.amount > 0 ? `${fmt$(dig.dueToday.amount)} in potential revenue` : "Nothing due today"}
            onClick={() => onDig?.("dueToday")} />
          <DigCard n={dig.overdue.count} color={C.red} title="Bids overdue"
            sub={dig.overdue.amount > 0 ? `${fmt$(dig.overdue.amount)} in potential revenue` : "None overdue"}
            onClick={() => onDig?.("overdue")} />
          <DigCard n={dig.followupsWeek.count} color={C.amber} title="Follow-ups this week"
            sub="Keep the momentum going"
            onClick={() => onDig?.("followups")} />
        </div>

        {/* full per-job list, on demand (nothing lost from the relocation) */}
        {showAllOwed && owed.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: SP.sm, marginTop: SP.md }}>
            {(showAllOwed ? owed : owed.slice(0, OWED_PREVIEW)).map(item => {
              const overdue = item.date && item.date < new Date().toLocaleDateString("en-CA");
              return (
                <button key={`${item.kind}-${item.id}`} onClick={() => navigate(`/calllog/${item.id}`, { state: { from: "/calllog" } })}
                  style={{ textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, background: C.linen, border: `1px solid ${C.border}`, borderLeft: `3px solid ${overdue ? C.red : C.amber}`, borderRadius: R.chip, padding: "9px 14px", cursor: "pointer" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "48%" }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: overdue ? C.red : C.amber, fontFamily: F.ui, whiteSpace: "nowrap" }}>
                    {item.kind === "bid" ? "bid" : "follow-up"}{overdue ? " · overdue" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* results companion (kept from Home — "back in motion" this week) */}
        {(results.callsThisWeek > 0 || results.reengaged > 0) && (
          <div style={{ marginTop: SP.lg }}>
            <HuntResultsPanel callsThisWeek={results.callsThisWeek} reengaged={results.reengaged} onDrill={() => setShowRevivals(true)} />
          </div>
        )}
      </div>

      {/* ── RIGHT · WHERE TO HUNT (Biggest Bid Hanging + Sleepers) ────────── */}
      <HuntBox goneQuiet={repGoneQuiet} dormant={repDormant} onGoTo={onGoTo} onLog={setLogTarget} />

      {showRevivals && (
        <HuntResultsModal calls={results.calls} jobs={results.jobs} onGoTo={onGoTo} onClose={() => setShowRevivals(false)} />
      )}

      {logTarget && (
        <LogOutcomeModal item={logTarget} loggedBy={repName || displayName} onClose={() => setLogTarget(null)}
          onLogged={(outcome) => {
            const days = SUPPRESSION_WINDOWS[outcome];
            const who = logTarget?.name || "That job";
            setToast(days ? `Logged — ${who} drops off your list, back in ${days} days.` : "Logged.");
            setLogTarget(null);
            refresh();
          }} />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: SP.xl, left: "50%", transform: "translateX(-50%)", zIndex: 200,
          background: C.dark, color: C.teal, fontFamily: F.ui, fontSize: 13, fontWeight: 700,
          padding: "12px 20px", borderRadius: R.chip, boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: SP.md }}>
          <span>✓ {toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(48,207,172,0.55)", fontSize: 15, padding: 0 }}>✕</button>
        </div>
      )}
    </div>
  );
}
