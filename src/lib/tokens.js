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

export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;500;600;700;800&family=Barlow:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Barlow',sans-serif;background:${C.linen};color:${C.textBody}}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-track{background:${C.linenDeep}}
  ::-webkit-scrollbar-thumb{background:${C.tealDark};border-radius:3px}
  input:not([type="checkbox"]),button,select,textarea{font-family:inherit;-webkit-appearance:none}
  input:-webkit-autofill,input:-webkit-autofill:focus{-webkit-box-shadow:0 0 0 1000px ${C.linenDeep} inset;-webkit-text-fill-color:${C.textBody}}
`;