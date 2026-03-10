import { C, F } from "../lib/tokens";

export default function StatCard({ label, value, sub, accent = C.teal }) {
  return (
    <div style={{
      background: C.linenCard,
      border: `1px solid ${C.borderStrong}`,
      borderRadius: 10,
      padding: "18px 22px",
      borderTop: `3px solid ${accent}`,
      boxShadow: "0 2px 8px rgba(28,24,20,0.08)",
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: C.textLight,
        fontFamily: F.ui,
        marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26,
        fontWeight: 800,
        color: C.textHead,
        letterSpacing: "-0.02em",
        fontFamily: F.display,
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 11.5,
          color: C.textFaint,
          marginTop: 4,
          fontFamily: F.ui,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}