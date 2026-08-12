// Zone 1 bid-due alert card (docs/plans/home-follow-up-screen.md §2.2).
// Presentational — Home owns the navigation (onUpdate). Phone-responsive (K15):
// reps are the daily users, so it wraps at narrow widths.
import { C, F } from "../../lib/tokens";
import { fmtD, tod } from "../../lib/utils";
import Btn from "../Btn";

export default function AlertCard({ alert, onUpdate }) {
  const overdue = alert.bidDue && alert.bidDue < tod();
  const reason = alert.bidDue === tod() ? "Bid due today" : overdue ? `Bid due ${fmtD(alert.bidDue)} — overdue` : `Bid due ${fmtD(alert.bidDue)}`;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
      background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: `4px solid ${C.amber}`,
      borderRadius: 10, padding: "12px 16px", boxShadow: "0 1px 4px rgba(28,24,20,0.05)",
    }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.02em" }}>
          {alert.jobNumber ? `${alert.jobNumber} · ` : ""}{alert.customer || "—"}
        </div>
        <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.body, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alert.jobName || "—"}
        </div>
        <div style={{ fontSize: 11.5, color: overdue ? C.red : C.amber, fontFamily: F.ui, fontWeight: 700, marginTop: 4 }}>
          {reason}
        </div>
      </div>
      <Btn v="primary" sz="sm" onClick={() => onUpdate?.(alert.id)}>Update</Btn>
    </div>
  );
}
