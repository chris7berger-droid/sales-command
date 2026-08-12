// Compact outbound row (docs/plans/home-follow-up-screen.md §2.4).
// The hero action in the action-first layout: who to call. One dense line —
// name, why they're here (last job / gone quiet), a tap-to-call phone, and Log.
import { C, F } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import Btn from "../Btn";

export default function OutboundCard({ item, onLog }) {
  const reason = item.source === "gone_quiet" ? "gone quiet since" : "last job";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${C.teal}`,
      borderRadius: 8, padding: "8px 12px",
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "55%" }}>
          {item.name || "—"}
        </span>
        <span style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {reason} {item.lastTouch ? fmtD(item.lastTouch) : "never"}
        </span>
      </div>
      {item.phone && (
        <a href={`tel:${item.phone}`} onClick={e => e.stopPropagation()} title={item.phone}
           style={{ fontSize: 13, color: C.tealDark, fontFamily: F.ui, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>☎</a>
      )}
      <Btn v="secondary" sz="sm" onClick={() => onLog?.(item)}>Log</Btn>
    </div>
  );
}
