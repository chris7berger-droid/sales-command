export const STAGES = ["New Inquiry", "Wants Bid", "Has Bid", "Sold", "Lost"];

export const STAGE_C = {
  "New Inquiry": { bg:"rgba(48,207,172,0.10)", text:"#0d5c4d", border:"rgba(48,207,172,0.3)" },
  "Wants Bid":   { bg:"rgba(249,168,37,0.13)", text:"#7a5000", border:"rgba(249,168,37,0.35)" },
  "Has Bid":     { bg:"rgba(142,68,173,0.10)", text:"#5b2d7a", border:"rgba(142,68,173,0.3)" },
  "Sold":        { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22", border:"rgba(67,160,71,0.3)" },
  "Lost":        { bg:"rgba(229,57,53,0.10)",  text:"#8b1a18", border:"rgba(229,57,53,0.3)" },
};

export const INV_C = {
  "New":                 { bg:"rgba(48,207,172,0.10)", text:"#0d5c4d" },
  "Sent":                { bg:"rgba(142,68,173,0.10)", text:"#5b2d7a" },
  "Waiting for Payment": { bg:"rgba(249,168,37,0.13)", text:"#7a5000" },
  "Past Due":            { bg:"rgba(229,57,53,0.10)",  text:"#8b1a18" },
  "Paid":                { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22" },
};

export const PROP_C = {
  "Draft":               { bg:"rgba(28,24,20,0.08)",   text:"#4a4238" },
  "New":                 { bg:"rgba(48,207,172,0.10)", text:"#0d5c4d" },
  "In Progress":         { bg:"rgba(249,168,37,0.13)", text:"#7a5000" },
  "Sent":                { bg:"rgba(142,68,173,0.10)", text:"#5b2d7a" },
  "Viewed":              { bg:"rgba(48,207,172,0.15)", text:"#1a8a72" },
  "Approved Internally": { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22" },
  "Sold":                { bg:"rgba(67,160,71,0.15)",  text:"#1e5e22" },
  "Lost":                { bg:"rgba(229,57,53,0.10)",  text:"#8b1a18" },
};

export const ROLE_C = {
  Admin:          { bg:"rgba(142,68,173,0.10)", text:"#5b2d7a" },
  Manager:        { bg:"rgba(48,207,172,0.10)", text:"#0d5c4d" },
  Sales:          { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22" },
  "Sales Rep":    { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22" },
  "Office Staff": { bg:"rgba(249,168,37,0.13)", text:"#7a5000" },
  Crew:           { bg:"rgba(249,168,37,0.13)", text:"#7a5000" },
};
