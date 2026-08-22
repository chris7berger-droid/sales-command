// Compact bid-due alert row (docs/plans/home-follow-up-screen.md §2.2).
// Secondary content in the action-first layout — one dense line, not a big card.
// display_job_number already carries the job name, so there's no separate name
// line (that was the redundant-looking second row).
import { C, F } from "../../lib/tokens";
import { fmtD, tod } from "../../lib/utils";
import Btn from "../Btn";

export default function AlertCard({ alert, onUpdate }) {
  const overdue = alert.bidDue && alert.bidDue < tod();
  const date = alert.bidDue ? fmtD(alert.bidDue) : "";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${overdue ? C.red : C.amber}`,
      borderRadius: 8, padding: "8px 12px",
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0, maxWidth: "55%" }}>
          {alert.jobNumber || "—"}
        </span>
        <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {alert.customer || ""}
        </span>
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: overdue ? C.red : C.amber, fontFamily: F.ui, whiteSpace: "nowrap" }}>
        {overdue ? `${date} · overdue` : date}
      </span>
      <Btn v="primary" sz="sm" onClick={() => onUpdate?.(alert.id)}>Update</Btn>
    </div>
  );
}
