// AR data store — localStorage for now, will migrate to Supabase in Phase 2
// Centralized read/write so the swap is one-file change

const KEYS = {
  report: "ar7-report",
  notes: "ar7-notes",
  ret: "ar7-ret",
  coll: "ar7-coll",
  goback: "ar7-goback",
  acct: "ar7-acct",
  emails: "ar7-emails",
  expDates: "ar7-expdates",
  triage: "ar7-triage",
  decisions: "ar7-decisions",
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function loadReportData() {
  const d = load(KEYS.report, null);
  if (!d) return null;
  return { customers: d.customers || [], invoices: d.invoices || [], reportDate: d.reportDate || "" };
}
export function saveReportData(customers, invoices, reportDate) {
  save(KEYS.report, { customers, invoices, reportDate });
}

export function loadNotes()       { return load(KEYS.notes, {}); }
export function saveNotes(v)      { save(KEYS.notes, v); }

export function loadRetFlags()    { return load(KEYS.ret, {}); }
export function saveRetFlags(v)   { save(KEYS.ret, v); }

export function loadCollFlags()   { return load(KEYS.coll, {}); }
export function saveCollFlags(v)  { save(KEYS.coll, v); }

export function loadGobackFlags() { return load(KEYS.goback, {}); }
export function saveGobackFlags(v){ save(KEYS.goback, v); }

export function loadAcctFlags()   { return load(KEYS.acct, {}); }
export function saveAcctFlags(v)  { save(KEYS.acct, v); }

export function loadEmails()      { return load(KEYS.emails, {}); }
export function saveEmails(v)     { save(KEYS.emails, v); }

export function loadExpDates()    { return load(KEYS.expDates, {}); }
export function saveExpDates(v)   { save(KEYS.expDates, v); }

// Triage statuses: keyed by invKey → "good" | "unsure" | "problem"
export function loadTriage()      { return load(KEYS.triage, {}); }
export function saveTriage(v)     { save(KEYS.triage, v); }

// Decision data: keyed by invKey → { reason, action, confirmedAt, overrideAction? }
export function loadDecisions()   { return load(KEYS.decisions, {}); }
export function saveDecisions(v)  { save(KEYS.decisions, v); }
