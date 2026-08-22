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
};

export const F = {
  display: "'Barlow Condensed', sans-serif",
  body:    "'Barlow', sans-serif",
  ui:      "'Inter', system-ui, sans-serif",
};

// Home Engagement layout scales (plan §D — home-engagement-redesign.md part 5).
// Concrete values so "anchor both edges" + the same-weight effort hero are
// enforceable, not aspirational. NO new brand colors this build (C.critical /
// C.orange are deferred with the %-runway, backlog F49).
//
// Surface map (which surface uses which existing color — no white anywhere):
//   page background      → C.linen
//   every card / box     → C.linenCard
//   inset wells          → C.linenDeep  (bar tracks, donut hole, input fields)
//   dark accents         → C.dark       (dollar badges, dark chips, hero panel)
export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 }; // px spacing
export const R  = { chip: 8, card: 12, hero: 18 };                            // px radius
export const FS = { hero: 56, boxNum: 40, sub: 20, body: 14, label: 11 };     // px font-size

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700;800&family=Barlow:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Barlow',sans-serif;background:${C.linen};color:${C.textBody}}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:${C.linenDeep}}
  ::-webkit-scrollbar-thumb{background:${C.tealDark};border-radius:3px}
  input:not([type="checkbox"]),button,select,textarea{font-family:inherit;-webkit-appearance:none}
  input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active{-webkit-box-shadow:0 0 0 1000px ${C.linenDeep} inset !important;-webkit-text-fill-color:${C.textBody} !important;background-color:${C.linenDeep} !important;transition:background-color 5000s ease-in-out 0s}
  @keyframes reasonPulse{0%,100%{box-shadow:0 0 0 0 rgba(249,168,37,0)}50%{box-shadow:0 0 0 4px rgba(249,168,37,0.45)}}
  .reason-pulse{animation:reasonPulse 1.5s ease-in-out infinite}
  @keyframes softPulse{0%,100%{filter:drop-shadow(0 0 6px rgba(48,207,172,0))}50%{filter:drop-shadow(0 0 9px rgba(48,207,172,0.6))}}
  .soft-pulse{animation:softPulse 3.4s ease-in-out infinite}
`;