// Generic job-list drill-in — used by the "Your Book" Sold tile so tapping it
// shows the EXACT jobs behind the number (this month, archive-aware), each row
// clicking straight through to the job. Not a Call Log stage filter (that can't
// reproduce "sold this month").
import { C, F, SP, R } from "../../lib/tokens";
import { fmt$ } from "../../lib/utils";

export default function JobListModal({ title, subtitle, items = [], onGoTo, onClose }) {
  const go = (item) => { onGoTo?.(item); onClose?.(); };
  const total = items.reduce((s, i) => s + (i.value || 0), 0);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 560, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: SP.xs }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>
        {subtitle && <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body, marginBottom: SP.lg }}>{subtitle} · {items.length} · {fmt$(total)}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
          {items.length === 0
            ? <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body }}>Nothing here yet.</div>
            : items.map((it, i) => (
              <button key={it.callLogId || i} onClick={() => go(it)}
                style={{ textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, width: "100%",
                  background: C.linen, border: `1px solid ${C.border}`, borderRadius: R.chip, padding: "10px 14px", cursor: "pointer" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "40%" }}>{it.name}</span>
                <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.sub}</span>
                <span style={{ marginLeft: "auto", background: C.dark, color: C.teal, fontSize: 12.5, fontWeight: 700, fontFamily: F.ui, borderRadius: 6, padding: "3px 10px", whiteSpace: "nowrap" }}>{fmt$(it.value)}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
