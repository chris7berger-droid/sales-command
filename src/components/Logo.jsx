import { C, F } from "../lib/tokens";

export function SalesCommandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="17" stroke={C.teal} strokeWidth="1.5" fill="none"/>
      <circle cx="20" cy="20" r="11" stroke={C.teal} strokeWidth="1" fill="rgba(48,207,172,0.06)"/>
      <line x1="20" y1="3"  x2="20" y2="8"  stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="20" y1="32" x2="20" y2="37" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="3"  y1="20" x2="8"  y2="20" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="32" y1="20" x2="37" y2="20" stroke={C.teal} strokeWidth="1.5" strokeLinecap="round"/>
      <text x="20" y="24" textAnchor="middle" fontFamily="Barlow Condensed, sans-serif" fontWeight="800" fontSize="11" fill="#ffffff" letterSpacing="0.5">SC</text>
    </svg>
  );
}

// Umbrella wordmark for the Subcon Command shell (Phase 1). SUBCON white /
// COMMAND teal. In-app sidebar only — the login/marketing wordmark is Phase 5.
// [J4] "Command Suite" subline dropped: SUBCON COMMAND now names the umbrella
// itself, so the subline was redundant.
export function AppWordmark({ size = 13 }) {
  return (
    <div style={{ lineHeight: 1 }}>
      <div style={{
        fontFamily: F.display,
        fontWeight: 800,
        fontSize: size + 1,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#fff",
      }}>
        Subcon <span style={{ color: C.teal }}>Command</span>
      </div>
    </div>
  );
}