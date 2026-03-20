import { useState } from "react";
import { C, F } from "../lib/tokens";

const STEPS = [
  "Sign In",
  "Create Customer",
  "Log Call",
  "Create Proposal",
  "Build WTC",
  "Generate PDF",
  "Send to Customer",
  "Customer Signs",
  "Status = Sold",
  "Download Signed PDF",
];

export default function RegressionTest() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(() => STEPS.map(() => false));

  function toggle(i) {
    setChecked(prev => prev.map((v, j) => (j === i ? !v : v)));
  }

  const done = checked.filter(Boolean).length;
  const pct = Math.round((done / STEPS.length) * 100);

  return (
    <div style={{ position: "fixed", bottom: 18, right: 18, zIndex: 9999 }}>
      {open && (
        <div style={{
          width: 280, marginBottom: 10, background: C.dark, border: `1px solid ${C.tealBorder}`,
          borderRadius: 12, padding: 18, boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Regression Test
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: pct === 100 ? C.green : C.amber, fontFamily: F.display }}>
              {pct}%
            </div>
          </div>

          <div style={{ height: 4, background: C.darkBorder, borderRadius: 4, marginBottom: 14 }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.teal, borderRadius: 4, transition: "width 0.2s" }} />
          </div>

          {STEPS.map((step, i) => (
            <label
              key={step}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                borderBottom: i < STEPS.length - 1 ? `1px solid ${C.darkBorder}` : "none",
                cursor: "pointer",
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                background: checked[i] ? C.teal : "transparent",
                border: `1.5px solid ${checked[i] ? C.teal : "rgba(255,255,255,0.18)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.12s",
              }}>
                {checked[i] && <span style={{ fontSize: 10, color: C.dark, fontWeight: 900 }}>&#10003;</span>}
              </div>
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} style={{ display: "none" }} />
              <span style={{
                fontSize: 12.5, fontFamily: F.ui, fontWeight: checked[i] ? 600 : 400,
                color: checked[i] ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)",
                textDecoration: checked[i] ? "line-through" : "none",
              }}>
                {i + 1}. {step}
              </span>
            </label>
          ))}
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: 42, height: 42, borderRadius: "50%", border: `1.5px solid ${C.tealBorder}`,
          background: C.dark, color: C.teal, fontSize: 16, fontWeight: 900,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)", fontFamily: F.display,
        }}
        title="Regression Test Tracker"
      >
        {open ? "X" : done === STEPS.length ? "\u2713" : `${done}`}
      </button>
    </div>
  );
}
