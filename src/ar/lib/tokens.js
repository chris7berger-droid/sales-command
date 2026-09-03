// AR Command design tokens — matches Sales Command parchment palette
// with AR-specific aging colors

export const C = {
  linen:        "#b5a896",
  linenLight:   "#bfb3a1",
  linenCard:    "#c8bcaa",
  linenDeep:    "#a89b88",
  textHead:     "#1c1814",
  textBody:     "#2d2720",
  textMuted:    "#4a4238",
  textLight:    "#6b6358",
  textFaint:    "#887c6e",
  border:       "rgba(28,24,20,0.14)",
  borderStrong: "rgba(28,24,20,0.22)",
  teal:         "#30cfac",
  tealDark:     "#1a8a72",
  tealDeep:     "#0d5c4d",
  tealGlow:     "rgba(48,207,172,0.12)",
  tealBorder:   "rgba(48,207,172,0.3)",
  dark:         "#1c1814",
  darkRaised:   "#28231d",
  darkBorder:   "rgba(255,255,255,0.10)",
  red:          "#e53935",
  green:        "#43a047",
  amber:        "#f9a825",
  purple:       "#8e44ad",
  pop:          "#30cfac",
  popDim:       "rgba(48,207,172,0.12)",
  popDark:      "#1a8a72",
  popDeep:      "#0d5c4d",
};

// AR aging bucket colors
export const COL = {
  cur:    { bg: "#059669", lt: "#d1fae5", tx: "#065f46" },
  d30:    { bg: "#d97706", lt: "#fef3c7", tx: "#92400e" },
  d60:    { bg: "#ea580c", lt: "#ffedd5", tx: "#9a3412" },
  d90:    { bg: "#dc2626", lt: "#fee2e2", tx: "#991b1b" },
  o90:    { bg: "#7c2d12", lt: "#fecaca", tx: "#7f1d1d" },
  ret:    { bg: "#7c3aed", lt: "#ede9fe", tx: "#5b21b6" },
  coll:   { bg: "#475569", lt: "#f1f5f9", tx: "#334155" },
  goback: { bg: "#b45309", lt: "#fef3c7", tx: "#78350f" },
  // Triage statuses
  tGood:     { bg: "#059669", lt: "#d1fae5", tx: "#065f46" },
  tUnsure:   { bg: "#d97706", lt: "#fef3c7", tx: "#92400e" },
  tProblem:  { bg: "#dc2626", lt: "#fee2e2", tx: "#991b1b" },
};

export const F = {
  display: "'Barlow Condensed', sans-serif",
  body:    "'Barlow', sans-serif",
};

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700;800&family=Barlow:wght@300;400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Barlow',sans-serif;background:${C.linen};color:${C.textBody};-webkit-font-smoothing:antialiased}
  body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
    background:
      repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(60,50,35,0.04) 2px,rgba(60,50,35,0.04) 3px),
      repeating-linear-gradient(90deg,transparent,transparent 2px,rgba(60,50,35,0.04) 2px,rgba(60,50,35,0.04) 3px),
      radial-gradient(ellipse at 25% 15%,rgba(200,188,170,0.4) 0%,transparent 50%),
      radial-gradient(ellipse at 75% 85%,rgba(158,145,126,0.3) 0%,transparent 50%)}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:${C.linenDeep}}
  ::-webkit-scrollbar-thumb{background:${C.tealDark};border-radius:3px}
  input:not([type="checkbox"]):not([type="file"]),button,select,textarea{font-family:inherit;-webkit-appearance:none}
  input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{-webkit-box-shadow:0 0 0 1000px ${C.linenDeep} inset !important;-webkit-text-fill-color:${C.textBody} !important;background-color:${C.linenDeep} !important;transition:background-color 5000s ease-in-out 0s}
  h1,h2,h3,h4{font-family:${F.display};color:${C.textHead};font-weight:700}
`;
