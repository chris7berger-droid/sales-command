// Zone 3 outbound worklist card (docs/plans/home-follow-up-screen.md §2.4).
// Dormant customer or gone-quiet bid. Phone is a tel: link. Presentational —
// Home opens the LogOutcomeModal via onLog.
import { C, F } from "../../lib/tokens";
import { fmtD } from "../../lib/utils";
import Btn from "../Btn";

export default function OutboundCard({ item, onLog }) {
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
      background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10,
      padding: "12px 16px", boxShadow: "0 1px 4px rgba(28,24,20,0.05)",
    }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.02em" }}>
          {item.jobNumber ? `${item.jobNumber} · ` : ""}{item.name || "—"}
        </div>
        <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.lastJob || "—"}
        </div>
        <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>
          Last touch {item.lastTouch ? fmtD(item.lastTouch) : "never"}
        </div>
      </div>
      {item.phone && (
        <a href={`tel:${item.phone}`} style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textDecoration: "none", whiteSpace: "nowrap" }}>
          ☎ {item.phone}
        </a>
      )}
      <Btn v="secondary" sz="sm" onClick={() => onLog?.(item)}>Log outcome</Btn>
    </div>
  );
}
