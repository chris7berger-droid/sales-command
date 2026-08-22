// Drill-in for the "Waking Up the Sleepers" panel (Box 6 / F51 v1).
// Shows the actual calls logged this week + the exact bids re-engaged, each row
// clicking straight through to the job so a rep can go work it more.
import { C, F, SP, R, FS } from "../../lib/tokens";
import { fmt$, fmtD } from "../../lib/utils";

function Row({ left, mid, right, onClick }) {
  return (
    <button onClick={onClick}
      style={{ textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, width: "100%",
        background: C.linen, border: `1px solid ${C.border}`, borderRadius: R.chip, padding: "9px 12px", cursor: "pointer" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "55%" }}>{left}</span>
      {mid && <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mid}</span>}
      <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, whiteSpace: "nowrap" }}>{right}</span>
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>{title}</div>
      {children}
    </div>
  );
}

export default function HuntResultsModal({ calls = [], jobs = [], onGoTo, onClose }) {
  const go = (item) => { onGoTo?.(item); onClose?.(); };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.65)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.linenCard, borderRadius: 14, padding: 28, width: 560, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.45)", border: `1px solid ${C.borderStrong}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: SP.lg }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>Waking Up the Sleepers · This Week</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.textFaint }}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: SP.xl }}>
          <Section title={`Bids back in motion (${jobs.length})`}>
            {jobs.length === 0
              ? <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body }}>No bids re-engaged yet this week.</div>
              : jobs.map(j => <Row key={`j-${j.callLogId}`} left={j.name} right={fmt$(j.value)} onClick={() => go(j)} />)}
          </Section>

          <Section title={`Calls logged (${calls.length})`}>
            {calls.length === 0
              ? <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.body }}>No calls logged yet this week.</div>
              : calls.map((c, i) => <Row key={`c-${i}`} left={c.name} mid={c.outcome} right={fmtD(c.date)} onClick={() => go(c)} />)}
          </Section>
        </div>
      </div>
    </div>
  );
}
