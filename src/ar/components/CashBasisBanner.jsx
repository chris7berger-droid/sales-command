import { useState } from "react";
import { C, F } from "../lib/tokens";

export default function CashBasisBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  return (
    <div style={S.wrap}>
      <div style={S.main} onClick={() => setExpanded(!expanded)}>
        <div style={S.left}>
          <span style={S.icon}>💰</span>
          <div>
            <div style={S.title}>You're on cash basis.</div>
            <div style={S.sub}>Writing off unpaid invoices doesn't change your taxes — you were never taxed on money you didn't receive.</div>
          </div>
        </div>
        <div style={S.right}>
          <button style={S.learnBtn} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? "Less" : "Learn more"}
          </button>
          <button style={S.closeBtn} onClick={(e) => { e.stopPropagation(); setDismissed(true); }} title="Dismiss">✕</button>
        </div>
      </div>
      {expanded && (
        <div style={S.detail}>
          <div style={S.detailGrid}>
            <div style={S.detailCard}>
              <div style={S.detailLabel}>WRITE OFF BAD DEBT</div>
              <div style={S.detailText}>Cleans up your A/R. No tax impact — it's administrative. You were never taxed on the income because you never received the cash.</div>
            </div>
            <div style={S.detailCard}>
              <div style={S.detailLabel}>ISSUE A CREDIT MEMO</div>
              <div style={S.detailText}>Adjusts revenue to match reality. Use when you overbilled or agreed to a discount. Reduces income you haven't collected.</div>
            </div>
            <div style={S.detailCard}>
              <div style={S.detailLabel}>REASSIGN A PAYMENT</div>
              <div style={S.detailText}>Pure housekeeping — moves money between invoices for the same customer. Zero tax impact, just makes your books accurate.</div>
            </div>
            <div style={S.detailCard}>
              <div style={S.detailLabel}>FLAG FOR ACCOUNTANT</div>
              <div style={S.detailText}>When in doubt, flag it and batch items for a 30-minute accountant session. Don't let uncertainty freeze everything.</div>
            </div>
          </div>
          <div style={S.detailFooter}>
            The only QB action with potential tax implications on cash basis is issuing a credit memo that reduces revenue you DID receive. For unpaid invoices, you're in the clear.
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: { background: `linear-gradient(135deg, rgba(48,207,172,0.08) 0%, rgba(48,207,172,0.03) 100%)`, border: `1px solid rgba(48,207,172,0.25)`, borderRadius: 10, marginBottom: 16, overflow: "hidden" },
  main: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", gap: 12 },
  left: { display: "flex", alignItems: "flex-start", gap: 10, flex: 1 },
  icon: { fontSize: 20, flexShrink: 0, marginTop: 1 },
  title: { fontFamily: F.display, fontSize: 13, fontWeight: 800, color: C.tealDark },
  sub: { fontSize: 11, color: C.textBody, marginTop: 2, lineHeight: 1.4 },
  right: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 },
  learnBtn: { background: "none", border: `1px solid rgba(48,207,172,0.4)`, borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 700, fontFamily: F.display, color: C.tealDark, cursor: "pointer", letterSpacing: "0.04em" },
  closeBtn: { background: "none", border: "none", fontSize: 14, color: C.textFaint, cursor: "pointer", padding: "2px 4px", lineHeight: 1 },
  detail: { borderTop: `1px solid rgba(48,207,172,0.2)`, padding: "12px 16px" },
  detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 },
  detailCard: { background: C.linenCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" },
  detailLabel: { fontSize: 9, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.1em", color: C.tealDark, marginBottom: 4, textTransform: "uppercase" },
  detailText: { fontSize: 11, lineHeight: 1.4, color: C.textBody },
  detailFooter: { fontSize: 10, color: C.textLight, lineHeight: 1.4, fontStyle: "italic", paddingTop: 8, borderTop: `1px dashed ${C.border}` },
};
