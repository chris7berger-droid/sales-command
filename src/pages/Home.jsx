// Home → Follow-Up screen — ACTION-FIRST layout (docs/plans/home-follow-up-screen.md).
// The screen's job is "keep the crews busy two weeks out," so it leads with the
// decision (runway) and the action (who to call). The overdue-bid list is real
// but secondary, so it's compacted to the bottom behind an expander. All lists
// come from the shared AlertsProvider snapshot (no fetch fan-out).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { STAGES } from "../lib/mockData";
import { useAlerts } from "../lib/alerts";
import { useTenantConfig } from "../lib/TenantConfigContext";
import RunwayBar, { runwayColor } from "../components/followup/RunwayBar";
import AlertCard from "../components/followup/AlertCard";
import OutboundCard from "../components/followup/OutboundCard";
import LogOutcomeModal from "../components/followup/LogOutcomeModal";

const ALERT_PREVIEW = 4;   // overdue bids are secondary — show a few, expand for the rest
const OUTBOUND_CAP = 8;
const P_COLOR = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };
const RUNWAY_C = { green: C.green, yellow: C.amber, red: C.red, unset: C.textFaint };

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textLight, fontFamily: F.ui }}>{children}</div>
      {right}
    </div>
  );
}

export default function Home({ displayName = "there", displayRole = "Sales Rep" }) {
  const navigate = useNavigate();
  const cfg = useTenantConfig();
  const { bidDueAlerts, dormant, goneQuiet, footerStats, loading, hasSnapshot, firstLoadError, refresh } = useAlerts();

  const canManage = ["Admin", "Manager"].includes(displayRole);
  const weeks = cfg.schedule_runway_weeks ?? null;
  const color = runwayColor(weeks);

  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllOutbound, setShowAllOutbound] = useState(false);
  const [logTarget, setLogTarget] = useState(null);

  const firstName = displayName.split(" ")[0];
  const outbound = [...goneQuiet, ...dormant]; // warmest first (live bids, then dormant book)
  const alertCount = bidDueAlerts.length;

  const shownAlerts = showAllAlerts ? bidDueAlerts : bidDueAlerts.slice(0, ALERT_PREVIEW);
  const shownOutbound = showAllOutbound ? outbound : outbound.slice(0, OUTBOUND_CAP);
  const onUpdate = (id) => navigate(`/calllog/${id}`, { state: { from: "/home" } });
  const onLogged = () => { setLogTarget(null); refresh(); };
  const loadingCore = !hasSnapshot && loading;

  const Dot = () => <span style={{ color: C.textFaint, opacity: 0.5 }}>·</span>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* GREETING + SUMMARY STRIP */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.1 }}>
          Good Morning, {firstName}
        </h1>
        {!loadingCore && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10, fontSize: 13.5, fontFamily: F.ui, fontWeight: 700 }}>
            <span style={{ color: alertCount ? C.red : C.textMuted }}>{alertCount} bid{alertCount === 1 ? "" : "s"} due</span>
            <Dot />
            <span style={{ color: RUNWAY_C[color] }}>{weeks === null ? "runway not set" : `${weeks}-wk runway`}</span>
            <Dot />
            <span style={{ color: outbound.length ? C.tealDark : C.textMuted }}>{outbound.length} to call</span>
          </div>
        )}
      </div>

      {loadingCore ? (
        <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>
      ) : firstLoadError ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.red, fontFamily: F.ui }}>
          Couldn't load. <button onClick={refresh} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.tealDark, fontWeight: 700, fontFamily: F.ui }}>Retry</button>
        </div>
      ) : (
        <>
          {/* RUNWAY — the hero */}
          <RunwayBar canManage={canManage} />

          {/* WHO TO CALL — the action */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel right={outbound.length > OUTBOUND_CAP && (
              <button onClick={() => setShowAllOutbound(s => !s)} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontFamily: F.ui, fontWeight: 700, fontSize: 12 }}>
                {showAllOutbound ? "Show fewer ▴" : `+ ${outbound.length - OUTBOUND_CAP} more ▾`}
              </button>
            )}>Who To Call{outbound.length ? ` (${outbound.length})` : ""}</SectionLabel>
            {outbound.length === 0 ? (
              <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.body }}>No one to chase — pipeline's warm.</div>
            ) : (
              shownOutbound.map(o => <OutboundCard key={`${o.source}-${o.customerId || o.callLogId}`} item={o} onLog={setLogTarget} />)
            )}
          </div>

          {/* BIDS DUE — secondary, compact */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SectionLabel right={alertCount > ALERT_PREVIEW && (
              <button onClick={() => setShowAllAlerts(s => !s)} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontFamily: F.ui, fontWeight: 700, fontSize: 12 }}>
                {showAllAlerts ? "Show fewer ▴" : `+ ${alertCount - ALERT_PREVIEW} more ▾`}
              </button>
            )}>Bids Due{alertCount ? ` (${alertCount})` : ""}</SectionLabel>
            {alertCount === 0 ? (
              <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.body }}>All clear — no bids due.</div>
            ) : (
              shownAlerts.map(a => <AlertCard key={a.id} alert={a} onUpdate={onUpdate} />)
            )}
          </div>

          {/* FOOTER · slim all-roles stats strip */}
          {footerStats && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, borderTop: `1px solid ${C.borderStrong}`, paddingTop: 14, marginTop: 4 }}>
              {STAGES.map(s => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: P_COLOR[s] }} />
                  <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui }}>{s} <strong style={{ color: C.textHead }}>{footerStats.stageCounts[s] || 0}</strong></span>
                </div>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.08em" }}>Billings</span>
                <span style={{ background: C.dark, color: C.teal, fontSize: 13, fontWeight: 700, fontFamily: F.ui, borderRadius: 6, padding: "3px 10px" }}>
                  {fmt$(footerStats.monthBill)} · {footerStats.billingsPct}%
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {logTarget && (
        <LogOutcomeModal item={logTarget} loggedBy={displayName} onClose={() => setLogTarget(null)} onLogged={onLogged} />
      )}
    </div>
  );
}
