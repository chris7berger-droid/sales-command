// Home → Follow-Up screen (docs/plans/home-follow-up-screen.md).
// Three zones top-to-bottom by urgency — bid-due Alerts / Schedule Runway /
// Outbound worklist — plus a slim all-roles stats footer. All lists come from
// the shared AlertsProvider snapshot (no fetch fan-out). The runway color is the
// mode switch: green/unset keeps Zone 3 collapsed, yellow/red expands it.
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

const ALERT_CAP = 10;
const P_COLOR = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };

function ZoneHeader({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.borderStrong}`, paddingBottom: 6 }}>
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
  const color = runwayColor(cfg.schedule_runway_weeks ?? null);
  const autoExpand = color === "yellow" || color === "red";

  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [expandOverride, setExpandOverride] = useState(null); // null = follow runway color
  const [logTarget, setLogTarget] = useState(null);

  const zone3Expanded = expandOverride !== null ? expandOverride : autoExpand;
  const firstName = displayName.split(" ")[0];
  const outboundCount = dormant.length + goneQuiet.length;

  const shownAlerts = showAllAlerts ? bidDueAlerts : bidDueAlerts.slice(0, ALERT_CAP);
  const onUpdate = (id) => navigate(`/calllog/${id}`, { state: { from: "/home" } });
  const onLogged = () => { setLogTarget(null); refresh(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>

      {/* GREETING */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textFaint, fontFamily: F.ui, marginBottom: 6 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.1 }}>
          Good Morning, {firstName}
        </h1>
        <p style={{ margin: "8px 0 0", color: C.textMuted, fontSize: 14.5, fontFamily: F.body }}>
          Keep the crews busy two weeks out.
        </p>
      </div>

      {/* ZONE 1 · ALERTS · BID DUE */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ZoneHeader>Alerts · Bid Due Reached{bidDueAlerts.length ? ` (${bidDueAlerts.length})` : ""}</ZoneHeader>
        {!hasSnapshot && loading ? (
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "8px 2px" }}>Loading…</div>
        ) : firstLoadError ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.red, fontFamily: F.ui }}>
            Couldn't load. <button onClick={refresh} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.tealDark, fontWeight: 700, fontFamily: F.ui }}>Retry</button>
          </div>
        ) : bidDueAlerts.length === 0 ? (
          <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.body }}>All clear — no bids due.</div>
        ) : (
          <>
            {shownAlerts.map(a => <AlertCard key={a.id} alert={a} onUpdate={onUpdate} />)}
            {bidDueAlerts.length > ALERT_CAP && (
              <button onClick={() => setShowAllAlerts(s => !s)} style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontFamily: F.ui, fontWeight: 700, fontSize: 12.5 }}>
                {showAllAlerts ? "Show fewer ▴" : `+ ${bidDueAlerts.length - ALERT_CAP} more ▾`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ZONE 2 · SCHEDULE RUNWAY */}
      <RunwayBar canManage={canManage} />

      {/* ZONE 3 · OUTBOUND */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ZoneHeader right={
          outboundCount > 0 && (
            <button onClick={() => setExpandOverride(!zone3Expanded)} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontFamily: F.ui, fontWeight: 700, fontSize: 12 }}>
              {zone3Expanded ? "Collapse ▴" : "Expand ▾"}
            </button>
          )
        }>Outbound Worklist{outboundCount ? ` (${outboundCount})` : ""}</ZoneHeader>

        {!hasSnapshot && loading ? (
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, padding: "8px 2px" }}>Loading…</div>
        ) : outboundCount === 0 ? (
          <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.body }}>No outbound targets — pipeline's warm.</div>
        ) : !zone3Expanded ? (
          <button onClick={() => setExpandOverride(true)} style={{ textAlign: "left", background: C.linenCard, border: `1px dashed ${C.borderStrong}`, borderRadius: 10, padding: "12px 16px", cursor: "pointer", fontSize: 13, color: C.textMuted, fontFamily: F.ui }}>
            {outboundCount} warm lead{outboundCount > 1 ? "s" : ""} waiting — expand
          </button>
        ) : (
          <>
            {dormant.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginTop: 2 }}>Dormant Customers</div>
                {dormant.map(d => <OutboundCard key={`d-${d.customerId}`} item={d} onLog={setLogTarget} />)}
              </>
            )}
            {goneQuiet.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.ui, marginTop: 8 }}>Gone-Quiet Bids</div>
                {goneQuiet.map(g => <OutboundCard key={`g-${g.callLogId}`} item={g} onLog={setLogTarget} />)}
              </>
            )}
          </>
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

      {logTarget && (
        <LogOutcomeModal item={logTarget} loggedBy={displayName} onClose={() => setLogTarget(null)} onLogged={onLogged} />
      )}
    </div>
  );
}
