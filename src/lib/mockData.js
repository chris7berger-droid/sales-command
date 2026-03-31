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
  Admin:   { bg:"rgba(142,68,173,0.10)", text:"#5b2d7a" },
  Manager: { bg:"rgba(48,207,172,0.10)", text:"#0d5c4d" },
  Sales:   { bg:"rgba(67,160,71,0.12)",  text:"#1e5e22" },
  Crew:    { bg:"rgba(249,168,37,0.13)", text:"#7a5000" },
};

export const callLog = [
  { id:7413, jobName:"TMCC – Red Mountain – Demo & Polish",       date:"2026-03-07", stage:"Wants Bid",   salesName:"Marcus Webb", bidDue:"2026-03-14", followUp:"2026-03-10" },
  { id:7412, jobName:"Reno Aces Stadium – Concourse Flatwork",    date:"2026-03-06", stage:"Has Bid",     salesName:"Sarah Tran",  bidDue:"2026-03-12", followUp:"2026-03-11" },
  { id:7411, jobName:"Sparks YMCA – Gym Floor Polish",            date:"2026-03-05", stage:"Sold",        salesName:"Marcus Webb", bidDue:"2026-03-08", followUp:null },
  { id:7410, jobName:"I-80 Logistics Hub – Warehouse Demo",       date:"2026-03-04", stage:"New Inquiry", salesName:"Dani Rojas",  bidDue:"2026-03-18", followUp:"2026-03-12" },
  { id:7409, jobName:"Sierra Summit Hotel – Lobby Overlay",       date:"2026-03-03", stage:"Lost",        salesName:"Sarah Tran",  bidDue:"2026-03-05", followUp:null },
  { id:7408, jobName:"Carson City Courts – Sealer + Grind",       date:"2026-03-01", stage:"Has Bid",     salesName:"Dani Rojas",  bidDue:"2026-03-09", followUp:"2026-03-09" },
  { id:7407, jobName:"Fernley Fulfillment – Flatwork Repair",     date:"2026-02-28", stage:"Sold",        salesName:"Marcus Webb", bidDue:"2026-03-07", followUp:null },
  { id:7406, jobName:"UNR Mackay Stadium – Concourse Seal",       date:"2026-02-27", stage:"Wants Bid",   salesName:"Sarah Tran",  bidDue:"2026-03-13", followUp:"2026-03-10" },
];

export const proposals = [
  { id:"7413 P1", status:"In Progress",         customer:"TMCC",                total:28450, created:"2026-03-07", approved:null },
  { id:"7412 P1", status:"Sent",                customer:"Reno Aces",           total:54200, created:"2026-03-06", approved:null },
  { id:"7411 P1", status:"Approved Internally", customer:"Sparks YMCA",         total:12800, created:"2026-03-05", approved:"2026-03-07" },
  { id:"7408 P1", status:"Viewed",              customer:"Carson City",         total:33600, created:"2026-03-01", approved:null },
  { id:"7407 P1", status:"Approved Internally", customer:"Fernley Fulfillment", total:19750, created:"2026-02-28", approved:"2026-03-05" },
  { id:"7406 P1", status:"New",                 customer:"UNR Mackay",          total:41300, created:"2026-02-27", approved:null },
];

export const invoices = [
  { id:"09120", jobId:"7411", jobName:"Sparks YMCA – Gym Floor Polish",        status:"Sent",               amount:12800, discount:0,    sent:"2026-03-08", due:"2026-03-22", aging:-14 },
  { id:"09119", jobId:"7407", jobName:"Fernley Fulfillment – Flatwork Repair", status:"Waiting for Payment",amount:19750, discount:500,  sent:"2026-03-05", due:"2026-03-19", aging:-10 },
  { id:"09118", jobId:"7402", jobName:"Northern NV Medical – Parking Deck",   status:"Paid",               amount:67200, discount:0,    sent:"2026-02-20", due:"2026-03-06", aging:3 },
  { id:"09117", jobId:"7399", jobName:"Reno Costco – Warehouse Flatwork",     status:"Past Due",           amount:32100, discount:1000, sent:"2026-02-10", due:"2026-02-24", aging:13 },
  { id:"09116", jobId:"7396", jobName:"Tahoe Casino – Lobby Grind & Seal",    status:"Paid",               amount:88400, discount:0,    sent:"2026-01-28", due:"2026-02-11", aging:26 },
];

export const team = [
  { id:1, name:"Marcus Webb",  role:"Sales",   email:"marcus@hdsp.com", phone:"775-555-0101" },
  { id:2, name:"Sarah Tran",   role:"Sales",   email:"sarah@hdsp.com",  phone:"775-555-0102" },
  { id:3, name:"Dani Rojas",   role:"Sales",   email:"dani@hdsp.com",   phone:"775-555-0103" },
  { id:4, name:"Jordan Kim",   role:"Manager", email:"jordan@hdsp.com", phone:"775-555-0201" },
  { id:5, name:"Casey Torres", role:"Admin",   email:"casey@hdsp.com",  phone:"775-555-0301" },
];

export const customers = [
  { id:1, name:"TMCC",              address:"7000 Dandini Blvd, Reno NV",      phone:"775-673-7000" },
  { id:2, name:"Reno Aces",         address:"250 Evans Ave, Reno NV",          phone:"775-334-4700" },
  { id:3, name:"Sparks YMCA",       address:"1300 E Prater Way, Sparks NV",    phone:"775-331-9622" },
  { id:4, name:"Carson City Parks", address:"201 N Carson St, Carson City NV", phone:"775-887-2262" },
  { id:5, name:"Fernley Industrial",address:"840 Newlands Hwy, Fernley NV",    phone:"775-575-3000" },
];

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export const mgrData = MONTHS.map((m, i) => ({
  month:         m,
  newCalls:      i < 3 ? [5,7,8][i]             : 0,
  propsSent:     i < 3 ? [3,5,4][i]             : 0,
  propsAccepted: i < 3 ? [2,3,2][i]             : 0,
  dollarsBid:    i < 3 ? [82000,140000,96000][i] : 0,
  dollarsAcc:    i < 3 ? [54000,89000,63000][i]  : 0,
  billings:      i < 3 ? [67200,96500,88000][i]  : 0,
}));