// AR Command utility functions — ported from legacy

export function fmt(n) {
  if (!n) return "\u2014";
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? `($${s})` : `$${s}`;
}

export function fmtShort(n) {
  if (!n) return "$0";
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

export function fmtTs(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function parseNum(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  let s = String(v).replace(/[$,\s]/g, "");
  if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") s = "-" + s.slice(1, -1);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

export function parseDateCell(v) {
  if (!v) return "";
  if (typeof v === "number") {
    const d = new Date((v - 25569) * 86400000);
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }
  return String(v).trim();
}

export function parseDate(ds) {
  if (!ds) return null;
  const p = ds.split("/");
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
}

export function toDateStr(d) {
  return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
}

export function toISODate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function fromISO(s) {
  if (!s) return null;
  const p = s.split("-");
  return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
}

export function daysOverdue(ds) {
  if (!ds) return 0;
  const d = parseDate(ds);
  if (!d) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now - d) / 86400000);
}

export function invKey(c, num, date) {
  return c + "|" + (num || "_") + "|" + (date || "_");
}

export function custNoteKey(c) {
  return c + "|__gen__";
}

// Period helpers
export function getWeekStart(d) {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0);
  const day = dt.getDay(); const diff = day === 0 ? 6 : day - 1;
  dt.setDate(dt.getDate() - diff); return dt;
}
export function getMonthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function getQuarterStart(d) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
export function getYearStart(d) { return new Date(d.getFullYear(), 0, 1); }

export function addPeriod(d, mode, n) {
  const dt = new Date(d);
  if (mode === "week") dt.setDate(dt.getDate() + n * 7);
  else if (mode === "month") dt.setMonth(dt.getMonth() + n);
  else if (mode === "quarter") dt.setMonth(dt.getMonth() + n * 3);
  else dt.setFullYear(dt.getFullYear() + n);
  return dt;
}

export function getPeriodRange(mode, offset) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let start;
  if (mode === "week") start = getWeekStart(now);
  else if (mode === "month") start = getMonthStart(now);
  else if (mode === "quarter") start = getQuarterStart(now);
  else start = getYearStart(now);
  start = addPeriod(start, mode, offset);
  const end = addPeriod(start, mode, 1);
  return { start, end };
}

export function periodLabel(mode, offset) {
  const r = getPeriodRange(mode, offset);
  const s = r.start;
  if (mode === "week") return "Week of " + s.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (mode === "month") return s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (mode === "quarter") { const q = Math.floor(s.getMonth() / 3) + 1; return "Q" + q + " " + s.getFullYear(); }
  return s.getFullYear().toString();
}

// QB report parsing
export function parseDetailReport(rows) {
  const custs = {};
  let bucket = "current";
  const bMap = {
    "91 or more days past due": "over90",
    "61 - 90 days past due": "days90",
    "31 - 60 days past due": "days60",
    "1 - 30 days past due": "days30",
    "CURRENT": "current",
  };
  let hdr = false;
  const allInvoices = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const c0 = String(row[0] || "").trim();
    if (!hdr) { if (String(row[1] || "").trim() === "Date") hdr = true; continue; }
    if (c0 && bMap[c0] !== undefined) { bucket = bMap[c0]; continue; }
    if (c0.indexOf("Total for") === 0) continue;
    if (String(row[1] || "").trim() === "TOTAL") continue;
    if (!row[1] && !row[2]) continue;
    const date = parseDateCell(row[1]), txnType = String(row[2] || "").trim(), num = String(row[3] || "").trim();
    const fullName = String(row[4] || "").trim(), location = String(row[5] || "").trim(), dueDate = parseDateCell(row[6]);
    const amount = parseNum(row[7]), openBal = parseNum(row[8]);
    let cn, jn;
    const ci = fullName.indexOf(":");
    if (ci > -1) { cn = fullName.substring(0, ci).trim(); jn = fullName.substring(ci + 1).trim(); }
    else { cn = fullName; jn = ""; }
    if (!cn) continue;
    if (!custs[cn]) custs[cn] = { name: cn, invoices: [], current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
    const inv = { date, type: txnType, num, job: jn, fullName, location, dueDate, amount, openBalance: openBal, bucket, customer: cn };
    custs[cn].invoices.push(inv);
    custs[cn][bucket] += openBal;
    custs[cn].total += openBal;
    allInvoices.push(inv);
  }
  return { customers: Object.values(custs), invoices: allInvoices };
}

// Email templates
export function generateEmail(tier, inv, custName) {
  const amt = fmt(inv.openBalance), invNum = inv.num || "N/A", due = inv.dueDate || "N/A";
  const od = daysOverdue(inv.dueDate), job = inv.job || "", co = "High Desert Surface Prep";
  if (tier === 0) return { subject: `Upcoming Invoice #${invNum} - ${amt} Due ${due}`, body: `Hi,\n\nJust a friendly heads up that Invoice #${invNum}${job ? " for " + job : ""} in the amount of ${amt} is coming due on ${due}.\n\nWanted to make sure this is on your radar so we can keep everything running smoothly. If you have any questions about the invoice or need any documentation, just let me know.` };
  if (tier === 1) return { subject: `Invoice #${invNum} - Payment Reminder from ${co}`, body: `Hi,\n\nI hope you are doing well. I wanted to reach out regarding Invoice #${invNum}${job ? " for " + job : ""} in the amount of ${amt}, which was due on ${due}.\n\nIf this has already been taken care of, please disregard this message. Otherwise, could you let me know the status or expected payment date?\n\nHappy to answer any questions.` };
  if (tier === 2) return { subject: `Follow-Up: Invoice #${invNum} - ${amt} Past Due`, body: `Hi,\n\nI am following up on Invoice #${invNum}${job ? " for " + job : ""} in the amount of ${amt}. This invoice was due on ${due} and is now ${od} days past due.\n\nWe would appreciate an update on when we can expect payment. If there are any issues with the invoice or questions about the work, please let us know so we can get this resolved.\n\nPlease reply at your earliest convenience.` };
  return { subject: `Urgent: Invoice #${invNum} - ${amt} Significantly Past Due`, body: `Hi,\n\nThis is regarding Invoice #${invNum}${job ? " for " + job : ""} in the amount of ${amt}, which was due on ${due} and is now ${od} days past due. We have reached out previously regarding this balance without resolution.\n\nWe need to receive payment or a confirmed payment plan within the next 7 business days. Without a response, we will need to evaluate next steps including suspending any current or future work and pursuing additional collection measures.\n\nWe value our working relationship and want to resolve this promptly. Please contact us immediately to discuss.` };
}
