import { C, F } from "../lib/tokens";

export default function Btn({ children, onClick, v = "primary", sz = "md", disabled }) {
  const style = {
    primary:   { background: C.dark,        color: C.teal,         border: "none" },
    secondary: { background: "transparent", color: C.tealDark,  border: `1.5px solid ${C.teal}` },
    ghost:     { background: "transparent", color: C.textMuted, border: `1.5px solid ${C.borderStrong}` },
    dark:      { background: C.dark,        color: C.teal,      border: "none" },
  }[v];

  const size = {
    sm: { padding: "5px 12px",  fontSize: 11.5, borderRadius: 6 },
    md: { padding: "8px 18px",  fontSize: 13,   borderRadius: 8 },
    lg: { padding: "11px 26px", fontSize: 14.5, borderRadius: 9 },
  }[sz];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...style, ...size,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity 0.13s",
        fontFamily: F.display,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity = "0.8"; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}