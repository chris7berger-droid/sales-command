import { C, F } from "../lib/tokens";
import { periodLabel } from "../lib/utils";

const MODES = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

export default function PeriodNav({ mode, offset, onModeChange, onOffsetChange }) {
  return (
    <div style={S.wrap}>
      <div style={S.left}>
        <button style={S.arrow} onClick={() => onOffsetChange(offset - 1)}>{"\u25C0"}</button>
        <span style={S.label}>{periodLabel(mode, offset)}</span>
        <button style={S.arrow} onClick={() => onOffsetChange(offset + 1)}>{"\u25B6"}</button>
        {offset !== 0 && <button style={S.today} onClick={() => onOffsetChange(0)}>Today</button>}
      </div>
      <div style={S.modes}>
        {MODES.map((m) => (
          <button key={m.id} style={{ ...S.mode, ...(mode === m.id ? S.modeActive : {}) }}
            onClick={() => onModeChange(m.id)}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}

const S = {
  wrap: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  left: { display: "flex", alignItems: "center", gap: 8 },
  arrow: { background: C.dark, color: C.pop, border: "none", borderRadius: 6, width: 28, height: 28, fontSize: 11, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  label: { fontFamily: F.display, fontSize: 16, fontWeight: 700, color: C.textHead, minWidth: 160, textAlign: "center" },
  today: { background: C.linenDeep, border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 12px", fontSize: 10, fontWeight: 700, fontFamily: F.display, color: C.textMuted, cursor: "pointer", letterSpacing: "0.04em" },
  modes: { display: "flex", gap: 4 },
  mode: { background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 6, padding: "4px 12px", fontSize: 10, fontWeight: 700, fontFamily: F.display, color: C.textMuted, cursor: "pointer", letterSpacing: "0.04em" },
  modeActive: { background: C.dark, color: C.pop, borderColor: C.dark },
};
