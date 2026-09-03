import { memo, useState } from "react";
import { C, F } from "../lib/tokens";
import { REASONS, REASON_MAP, ACTIONS, getPlaybook } from "../lib/decisionEngine";

// ─── Reason Picker ──────────────────────────────────────────────────────────────
// Shown after user marks an invoice as Problem or Unsure
export const ReasonPicker = memo(function ReasonPicker({ currentReason, onSelect }) {
  return (
    <div style={RS.wrap}>
      <div style={RS.header}>
        <span style={RS.headerIcon}>⚡</span>
        <span style={RS.headerText}>WHAT'S THE ISSUE?</span>
      </div>
      <div style={RS.grid}>
        {REASONS.map((r) => {
          const active = currentReason === r.id;
          return (
            <button key={r.id} onClick={() => onSelect(r.id)}
              style={{ ...RS.btn, ...(active ? RS.btnActive : null) }}>
              <span style={RS.btnIcon}>{r.icon}</span>
              <div>
                <div style={{ ...RS.btnLabel, ...(active ? { color: C.teal } : null) }}>{r.label}</div>
                <div style={{ ...RS.btnDesc, ...(active ? { color: "rgba(255,255,255,0.5)" } : null) }}>{r.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

const RS = {
  wrap: { marginTop: 12, marginBottom: 4 },
  header: { display: "flex", alignItems: "center", gap: 6, marginBottom: 10 },
  headerIcon: { fontSize: 14 },
  headerText: { fontSize: 10, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.1em", color: C.textMuted, textTransform: "uppercase" },
  grid: { display: "flex", flexDirection: "column", gap: 6 },
  btn: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenCard, cursor: "pointer", textAlign: "left", transition: "all 0.15s", fontFamily: F.body },
  btnActive: { background: C.dark, borderColor: C.teal, color: "#fff" },
  btnIcon: { fontSize: 18, flexShrink: 0, marginTop: 1 },
  btnLabel: { fontSize: 12, fontWeight: 700, color: C.textHead },
  btnDesc: { fontSize: 10, color: C.textFaint, marginTop: 1 },
};


// ─── Playbook Panel ─────────────────────────────────────────────────────────────
// Shown after reason is selected — displays recommended action + QB steps
export const PlaybookPanel = memo(function PlaybookPanel({ reasonId, inv, custName, decision, onConfirm, onOverride }) {
  const [showAllActions, setShowAllActions] = useState(false);
  const actionId = decision?.overrideAction || decision?.action;
  const action = ACTIONS[actionId];
  const playbook = getPlaybook(actionId, inv, custName);
  const reason = REASON_MAP[reasonId];
  const isConfirmed = !!decision?.confirmedAt;

  return (
    <div style={PS.wrap}>
      {/* Recommended action header */}
      <div style={PS.recHeader}>
        <div style={PS.recLeft}>
          <div style={PS.recLabel}>RECOMMENDED ACTION</div>
          <div style={PS.recTitle}>
            <span style={{ color: action?.color || C.textHead }}>{action?.icon}</span>
            <span>{action?.label || "Unknown"}</span>
          </div>
          <div style={PS.recSummary}>{action?.summary}</div>
        </div>
        {!isConfirmed ? (
          <button style={PS.confirmBtn} onClick={() => onConfirm(actionId)}>
            ✓ Got it — I'll do this
          </button>
        ) : (
          <div style={PS.confirmedBadge}>✓ Confirmed</div>
        )}
      </div>

      {/* Because: reason */}
      <div style={PS.becauseRow}>
        <span style={PS.becauseLabel}>Because:</span>
        <span style={PS.becauseVal}>{reason?.icon} {reason?.label}</span>
        <button style={PS.changeBtn} onClick={() => setShowAllActions(!showAllActions)}>
          {showAllActions ? "Hide alternatives" : "Different action?"}
        </button>
      </div>

      {/* Override action picker */}
      {showAllActions && (
        <div style={PS.overrideGrid}>
          {Object.values(ACTIONS).filter((a) => a.id !== actionId).map((a) => (
            <button key={a.id} style={PS.overrideBtn} onClick={() => { onOverride(a.id); setShowAllActions(false); }}>
              <span>{a.icon}</span>
              <span style={{ fontWeight: 700, color: a.color }}>{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Cash basis tax note */}
      <div style={PS.taxBox}>
        <div style={PS.taxHeader}>
          <span>💰</span>
          <span style={PS.taxLabel}>TAX IMPACT (CASH BASIS)</span>
        </div>
        <div style={PS.taxText}>{playbook.taxNote}</div>
      </div>

      {/* Step by step */}
      <div style={PS.stepsBox}>
        <div style={PS.stepsHeader}>📋 STEP-BY-STEP IN QUICKBOOKS</div>
        <ol style={PS.stepsList}>
          {playbook.steps.map((step, i) => (
            <li key={i} style={PS.step}>{step}</li>
          ))}
        </ol>
      </div>

      {/* Important note */}
      {playbook.important && (
        <div style={PS.importantBox}>
          <span style={PS.importantIcon}>⚠️</span>
          <span style={PS.importantText}>{playbook.important}</span>
        </div>
      )}
    </div>
  );
});

const PS = {
  wrap: { marginTop: 12, border: `2px solid ${C.tealBorder}`, borderRadius: 12, overflow: "hidden", background: C.linenCard },

  recHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 16px 12px", background: `linear-gradient(135deg, ${C.dark} 0%, ${C.darkRaised} 100%)` },
  recLeft: { flex: 1 },
  recLabel: { fontSize: 9, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase" },
  recTitle: { fontFamily: F.display, fontSize: 18, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 8 },
  recSummary: { fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4 },
  confirmBtn: { background: C.tealDark, color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 12, fontWeight: 700, fontFamily: F.display, cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "0.02em", transition: "all 0.15s" },
  confirmedBadge: { background: C.tealDeep, color: C.teal, border: `1px solid ${C.tealBorder}`, borderRadius: 8, padding: "10px 16px", fontSize: 12, fontWeight: 700, fontFamily: F.display, whiteSpace: "nowrap" },

  becauseRow: { display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" },
  becauseLabel: { fontSize: 10, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em" },
  becauseVal: { fontSize: 12, fontWeight: 600, color: C.textBody },
  changeBtn: { fontSize: 10, color: C.tealDark, background: "none", border: `1px solid ${C.tealBorder}`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 600, marginLeft: "auto" },

  overrideGrid: { display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.linenDeep },
  overrideBtn: { display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.linenCard, cursor: "pointer", fontSize: 11, fontFamily: F.body, transition: "all 0.12s" },

  taxBox: { padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: "rgba(48,207,172,0.06)" },
  taxHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 },
  taxLabel: { fontSize: 9, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.1em", color: C.tealDark, textTransform: "uppercase" },
  taxText: { fontSize: 12, lineHeight: 1.5, color: C.textBody },

  stepsBox: { padding: "12px 16px", borderBottom: `1px solid ${C.border}` },
  stepsHeader: { fontSize: 10, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.08em", color: C.textMuted, marginBottom: 10, textTransform: "uppercase" },
  stepsList: { paddingLeft: 18, margin: 0 },
  step: { fontSize: 12, lineHeight: 1.6, color: C.textBody, marginBottom: 6, paddingLeft: 4 },

  importantBox: { display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 16px", background: "rgba(234,88,12,0.06)" },
  importantIcon: { fontSize: 14, flexShrink: 0, marginTop: 1 },
  importantText: { fontSize: 11, lineHeight: 1.5, color: C.textBody, fontWeight: 500 },
};
