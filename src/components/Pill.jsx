import { C, F } from "../lib/tokens";

export default function Pill({ label, cm }) {
  const c = cm[label] || { bg: C.linenCard, text: C.textMuted };
  return (
    <span style={{
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11.5,
      fontWeight: 700,
      letterSpacing: "0.03em",
      background: c.bg,
      color: c.text,
      border: `1px solid ${c.border || c.bg}`,
      fontFamily: F.ui,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}