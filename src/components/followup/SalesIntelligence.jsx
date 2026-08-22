// Sales intelligence — "Where to Dig" + "Where to Hunt / Sleepers" + the
// log-a-call flow. RELOCATED from Home (F47) to Call Log per the 2026-08-22
// rebalance (Home = performance, Call Log = action). The engine is unchanged:
// useAlerts() snapshot, followUp.js selectors, suppression/supersede, and the
// Log-outcome write — only the render location moved. Leaf components
// (HuntBox / HuntResultsPanel / …) are reused as-is.
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, SP, R } from "../../lib/tokens";
import { useAlerts } from "../../lib/alerts";
import { owedItems, dormantCustomers, goneQuietBids, huntResults, SUPPRESSION_WINDOWS } from "../../lib/followUp";
import HuntBox from "./HuntBox";
import HuntResultsPanel from "./HuntResultsPanel";
import HuntResultsModal from "./HuntResultsModal";
import LogOutcomeModal from "./LogOutcomeModal";

const OWED_PREVIEW = 8; // What You Owe caps to the most-overdue few, rest behind an expander

function BoxLabel({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SP.md }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textLight, fontFamily: F.ui }}>{children}</div>
      {right}
    </div>
  );
}

export default function SalesIntelligence({ repName = "", displayName = "" }) {
  const navigate = useNavigate();
  const { snapshot, refresh } = useAlerts();

  const [logTarget, setLogTarget] = useState(null);
  const [showAllOwed, setShowAllOwed] = useState(false);
  const [showRevivals, setShowRevivals] = useState(false);
  const [toast, setToast] = useState(null);

  // auto-dismiss the "logged" confirmation
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const owed = useMemo(() => (snapshot ? owedItems(snapshot, { repName }) : []), [snapshot, repName]);
  const repGoneQuiet = useMemo(() => (snapshot ? goneQuietBids(snapshot, { repName }) : []), [snapshot, repName]);
  const repDormant = useMemo(() => (snapshot ? dormantCustomers(snapshot, { repName }) : []), [snapshot, repName]);
  const results = useMemo(() => (snapshot ? huntResults(snapshot, { repName }) : { callsThisWeek: 0, reengaged: 0 }), [snapshot, repName]);

  if (!snapshot) return null;

  const onGoTo = (card) => {
    if (card.callLogId) navigate(`/calllog/${card.callLogId}`, { state: { from: "/calllog" } });
    else if (card.customerId) navigate(`/customers/${card.customerId}`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.xxl }}>

      {/* ── WHERE TO DIG (bids due + self-set follow-ups) ─────────────────── */}
      <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
        <BoxLabel right={owed.length > 0 && <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>{owed.length} open · oldest first</span>}>Where To Dig</BoxLabel>
        {owed.length === 0 ? (
          <div style={{ fontSize: 15, fontWeight: 700, color: C.tealDark, fontFamily: F.body }}>All caught up — go hunt. 🎯</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
            {(showAllOwed ? owed : owed.slice(0, OWED_PREVIEW)).map(item => {
              const overdue = item.date && item.date < new Date().toLocaleDateString("en-CA");
              return (
                <button key={`${item.kind}-${item.id}`} onClick={() => navigate(`/calllog/${item.id}`, { state: { from: "/calllog" } })}
                  style={{ textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, background: C.linen, border: `1px solid ${C.border}`, borderLeft: `3px solid ${overdue ? C.red : C.amber}`, borderRadius: R.chip, padding: "10px 14px", cursor: "pointer" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${C.borderStrong}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "45%" }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: overdue ? C.red : C.amber, fontFamily: F.ui, whiteSpace: "nowrap" }}>
                    {item.kind === "bid" ? "bid" : "follow-up"} {overdue ? "· overdue" : ""}
                  </span>
                </button>
              );
            })}
            {owed.length > OWED_PREVIEW && (
              <button onClick={() => setShowAllOwed(s => !s)}
                style={{ alignSelf: "flex-start", marginTop: SP.xs, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {showAllOwed ? "Show fewer ▴" : `+ ${owed.length - OWED_PREVIEW} more ▾`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── WHERE TO HUNT (Biggest Bid Hanging + Sleepers) + results ──────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: SP.lg, alignItems: "start" }}>
        <HuntBox goneQuiet={repGoneQuiet} dormant={repDormant} onGoTo={onGoTo} onLog={setLogTarget} />
        <HuntResultsPanel callsThisWeek={results.callsThisWeek} reengaged={results.reengaged} onDrill={() => setShowRevivals(true)} />
      </div>

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
