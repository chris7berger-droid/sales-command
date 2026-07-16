import { C, F } from "../lib/tokens";

// White-free checkbox. Replaces native <input type="checkbox">, whose unchecked
// fill is ALWAYS browser-white regardless of accentColor. Renders a styled box:
// C.linenCard fill + borderStrong outline when unchecked, `accent` fill + dark
// check when set. No white anywhere (Style Rule #1).
//
// Two shapes:
//  • Interactive (owns its click):  <Checkbox checked={x} onChange={v => ...} label="Remember me" />
//    onChange receives the NEXT boolean value.
//  • Visual-only box (a clickable parent row/card owns the click — omit onChange):
//    <Checkbox checked={x} size={15} />
//
// Pass `accent` to change the checked color (default teal; deposit controls use C.green).
export default function Checkbox({
  checked,
  onChange,
  disabled = false,
  accent = C.teal,
  size = 18,
  label,
  labelStyle,
  style,
}) {
  const interactive = typeof onChange === "function" && !disabled;
  const box = (
    <span style={{ width: size, height: size, borderRadius: 4, border: `2px solid ${checked ? accent : C.borderStrong}`, background: checked ? accent : C.linenCard, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {checked && <span style={{ color: C.dark, fontSize: Math.round(size * 0.6), fontWeight: 900, lineHeight: 1 }}>✓</span>}
    </span>
  );

  // Pure visual box — a clickable parent owns the toggle.
  if (label == null && !interactive) {
    return <span role="checkbox" aria-checked={checked} aria-disabled={disabled || undefined} style={style}>{box}</span>;
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={interactive ? () => onChange(!checked) : undefined}
      style={{ display: "inline-flex", alignItems: "center", gap: label != null ? 10 : 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: disabled ? "not-allowed" : interactive ? "pointer" : "default", ...style }}
    >
      {box}
      {label != null && <span style={{ fontSize: 13, fontWeight: 600, color: C.textBody, fontFamily: F.ui, ...labelStyle }}>{label}</span>}
    </button>
  );
}
