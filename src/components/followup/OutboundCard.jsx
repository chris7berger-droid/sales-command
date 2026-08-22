// Compact outbound row (docs/plans/home-follow-up-screen.md §2.4).
// The hero action in the action-first layout: who to call. One dense line —
// name, why they're here (last job / gone quiet), a tap-to-call phone, and Log.
import { C, F } from "../../lib/tokens";
import { fmtD, fmt$ } from "../../lib/utils";
import Btn from "../Btn";

export default function OutboundCard({ item, onLog, onOpen }) {
  const reason = item.source === "gone_quiet" ? "gone quiet since" : "last job";
  return (
    <div
      onClick={onOpen ? () => onOpen(item) : undefined}
      title={onOpen ? "Open this job" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderLeft: `3px solid ${C.teal}`,
        borderRadius: 8, padding: "8px 12px",
        cursor: onOpen ? "pointer" : "default",
      }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8, overflow: "hidden" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "55%" }}>
          {item.name || "—"}
        </span>
        <span style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {reason} {item.lastTouch ? fmtD(item.lastTouch) : "never"}
        </span>
      </div>
      {item.value > 0 && (
        <span style={{ background: C.dark, color: C.teal, fontSize: 12, fontWeight: 700, fontFamily: F.ui, borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap" }}>
          {fmt$(item.value)}
        </span>
      )}
      <Btn v="secondary" sz="sm" onClick={(e) => { e?.stopPropagation?.(); onLog?.(item); }}>Log</Btn>
    </div>
  );
}
