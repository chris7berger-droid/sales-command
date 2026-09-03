// Export/Print utilities — generates clean printable HTML windows
import { C, F, COL } from "./tokens";
import { fmt, fmtShort, daysOverdue, invKey, parseDate, toDateStr } from "./utils";
import { REASON_MAP, ACTIONS } from "./decisionEngine";

function rptFmt(n) {
  if (n === 0) return "$0";
  const neg = n < 0; const a = Math.abs(n);
  if (a >= 1000) return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (neg ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function printStyles() {
  return `*{margin:0;padding:0;box-sizing:border-box}body{font-family:Barlow,sans-serif;background:#f5f3f0;color:#1c1814;padding:40px}
.container{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden}
.header{background:#1c1814;padding:24px 40px;color:#fff;display:flex;justify-content:space-between;align-items:center}
.header h1{font-family:Barlow Condensed,sans-serif;font-size:24px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#5BBD3F}
.header .sub{color:rgba(255,255,255,0.5);font-size:12px}
.header .total{font-family:Barlow Condensed,sans-serif;font-size:28px;font-weight:800;color:#5BBD3F}
.summary{display:flex;gap:16px;padding:20px 40px;border-bottom:1px solid #e5e2dd;flex-wrap:wrap}
.scard{flex:1;min-width:80px;text-align:center;padding:8px;border-radius:8px;border:1px solid #e5e2dd}
.scard-l{font-family:Barlow Condensed,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#887c6e;margin-bottom:2px}
.scard-v{font-family:Barlow Condensed,sans-serif;font-size:20px;font-weight:800;color:#1c1814}
table{width:100%;border-collapse:collapse}
th{font-family:Barlow Condensed,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#887c6e;text-align:left;padding:10px 12px;border-bottom:2px solid #e5e2dd}
td{padding:8px 12px;border-bottom:1px solid #f0ede8;font-size:11px;color:#352e26;vertical-align:top}
tr:nth-child(even){background:#faf8f5}
.amt{font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:13px;color:#1c1814;text-align:right;white-space:nowrap}
.age-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;font-family:Barlow Condensed,sans-serif}
.section-hdr{padding:12px 40px;font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #e5e2dd;background:#faf8f5}
.inv-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 40px;border-bottom:1px solid #f0ede8;gap:16px}
.inv-row:nth-child(even){background:#faf8f5}
.inv-main{flex:1;min-width:0}
.inv-num{font-weight:700;font-size:12px}.inv-job{font-size:10px;color:#6b7280;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px}
.inv-meta{font-size:10px;color:#887c6e;margin-top:2px}
.inv-overdue{color:#dc2626;font-weight:700;font-size:10px}
.inv-amt{font-family:Barlow Condensed,sans-serif;font-weight:800;font-size:14px;white-space:nowrap}
.footer{padding:16px 40px;background:#f5f3f0;font-size:10px;color:#887c6e;text-align:center}
.print-bar{padding:12px 40px;text-align:right;background:#faf8f5;border-bottom:1px solid #e5e2dd;display:flex;gap:8px;justify-content:flex-end}
.print-btn{font-family:Barlow Condensed,sans-serif;padding:8px 24px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.04em;text-transform:uppercase}
.print-btn:hover{background:#0d47a1}
.csv-btn{font-family:Barlow Condensed,sans-serif;padding:8px 24px;background:#059669;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.04em;text-transform:uppercase}
.csv-btn:hover{background:#047857}
@media print{.print-bar{display:none}body{background:#fff;padding:0}.container{box-shadow:none;border-radius:0}}`;
}

function openPrintWindow(title, bodyHtml, csvData) {
  const w = window.open("", "_blank");
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)} - AR Command</title>`;
  h += `<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap" rel="stylesheet">`;
  h += `<style>${printStyles()}</style></head><body><div class="container">`;
  h += `<div class="header"><div><h1>${esc(title)}</h1><p class="sub">Generated ${today}</p></div></div>`;
  h += `<div class="print-bar"><button class="print-btn" onclick="window.print()">Print / Save PDF</button>`;
  if (csvData) h += `<button class="csv-btn" onclick="downloadCSV()">Export CSV</button>`;
  h += `</div>`;
  h += bodyHtml;
  h += `<div class="footer">AR Command &mdash; ${esc(title)} &mdash; ${today}</div></div>`;
  if (csvData) {
    h += `<script>function downloadCSV(){var csv=${JSON.stringify(csvData)};var blob=new Blob([csv],{type:"text/csv"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="${title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/ /g, "_")}.csv";a.click();}<\/script>`;
  }
  h += `</body></html>`;
  w.document.write(h);
  w.document.close();
}

function ageBadgeHtml(bucket) {
  const m = { over90: { l: "91+", bg: "#fecaca", c: "#7c2d12" }, days90: { l: "61-90", bg: "#fee2e2", c: "#dc2626" }, days60: { l: "31-60", bg: "#ffedd5", c: "#ea580c" }, days30: { l: "1-30", bg: "#fef3c7", c: "#d97706" }, current: { l: "Current", bg: "#d1fae5", c: "#059669" } }[bucket] || { l: "?", bg: "#f3f4f6", c: "#6b7280" };
  return `<span class="age-badge" style="background:${m.bg};color:${m.c}">${m.l}</span>`;
}

// ─── Aging Table ───
export function exportAgingView(ar, currentFilter, searchTerm, sortBy, sortDir) {
  const filtered = ar.getFiltered(currentFilter, searchTerm, sortBy, sortDir);
  const filterLabels = { all: "All Outstanding", current: "Current", days30: "1-30 Days", days60: "31-60 Days", days90: "61-90 Days", over90: "91+ Days", retention: "Retention", collections: "In Collections", goback: "Go Back Issues", acctreview: "Acct Review" };
  let title = "AR Aging - " + (filterLabels[currentFilter] || "All");
  if (searchTerm) title += ` - "${searchTerm}"`;
  const totalAmt = filtered.reduce((s, c) => s + c.total, 0);

  let h = `<div class="summary"><div class="scard"><div class="scard-l">Customers</div><div class="scard-v">${filtered.length}</div></div><div class="scard"><div class="scard-l">Total</div><div class="scard-v">${rptFmt(totalAmt)}</div></div></div>`;
  h += `<table><thead><tr><th>Customer</th><th style="text-align:right">Current</th><th style="text-align:right">1-30</th><th style="text-align:right">31-60</th><th style="text-align:right">61-90</th><th style="text-align:right">91+</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
  let csv = "Customer,Current,1-30,31-60,61-90,91+,Total\n";
  const sums = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  filtered.forEach((c) => {
    const b = ar.getCustBuckets(c, false);
    h += `<tr><td style="font-weight:600">${esc(c.name)}</td>`;
    ["current", "days30", "days60", "days90", "over90"].forEach((k) => { h += `<td class="amt">${b[k] ? fmt(b[k]) : ""}</td>`; sums[k] += b[k]; });
    h += `<td class="amt" style="font-weight:800">${fmt(c.total)}</td></tr>`;
    csv += `"${c.name}",${b.current},${b.days30},${b.days60},${b.days90},${b.over90},${c.total}\n`;
  });
  h += `<tr style="border-top:2px solid #1c1814;font-weight:800"><td>TOTAL (${filtered.length} accounts)</td>`;
  ["current", "days30", "days60", "days90", "over90"].forEach((k) => { h += `<td class="amt">${fmt(sums[k])}</td>`; });
  h += `<td class="amt">${fmt(totalAmt)}</td></tr></tbody></table>`;
  openPrintWindow(title, h, csv);
}

// ─── Customer Detail ───
export function exportDetailView(ar, customer, bucketFilter) {
  const c = customer;
  let title = c.name + " - AR Detail";
  const filterLabels = { current: "Current", days30: "1-30", days60: "31-60", days90: "61-90", over90: "91+", retention: "Retention", collections: "In Collections", goback: "Go Back" };
  if (bucketFilter) title += ` (${filterLabels[bucketFilter] || bucketFilter})`;

  const bkts = [
    { l: "Current", v: c.current, c: "#059669" }, { l: "1-30", v: c.days30, c: "#d97706" },
    { l: "31-60", v: c.days60, c: "#ea580c" }, { l: "61-90", v: c.days90, c: "#dc2626" },
    { l: "91+", v: c.over90, c: "#7c2d12" },
  ];

  let h = `<div class="summary">`;
  bkts.forEach((b) => { if (b.v) h += `<div class="scard" style="border-color:${b.c}22"><div class="scard-l" style="color:${b.c}">${b.l}</div><div class="scard-v" style="color:${b.c}">${fmt(b.v)}</div></div>`; });
  h += `<div class="scard" style="background:#1c1814;border-color:#1c1814"><div class="scard-l" style="color:rgba(255,255,255,0.6)">Total Open</div><div class="scard-v" style="color:#5BBD3F">${fmt(c.total)}</div></div></div>`;

  const bOrder = { over90: 0, days90: 1, days60: 2, days30: 3, current: 4 };
  const sorted = c.invoices.slice().sort((a, b) => (bOrder[a.bucket] || 4) - (bOrder[b.bucket] || 4) || (a.date || "").localeCompare(b.date || ""));

  function matchFilter(inv) {
    if (!bucketFilter) return true;
    if (bucketFilter === "retention") return ar.isRetention(inv, c.name);
    if (bucketFilter === "collections") return ar.isCollections(inv, c.name);
    if (bucketFilter === "goback") return ar.isGoback(inv, c.name);
    return inv.bucket === bucketFilter;
  }

  const visible = sorted.filter(matchFilter);
  let csv = "Invoice,Type,Job,Date,Due,Days Overdue,Amount,Open Balance,Bucket\n";
  h += `<div class="section-hdr">Invoices (${visible.length})</div>`;

  visible.forEach((inv) => {
    const od = daysOverdue(inv.dueDate);
    h += `<div class="inv-row"><div class="inv-main"><span class="inv-num">#${esc(inv.num || "\u2014")}</span> ${ageBadgeHtml(inv.bucket)}`;
    if (ar.isRetention(inv, c.name)) h += ` <span class="age-badge" style="background:#ede9fe;color:#7c3aed">Retention</span>`;
    if (ar.isCollections(inv, c.name)) h += ` <span class="age-badge" style="background:#f1f5f9;color:#475569">Collections</span>`;
    h += `<div class="inv-job">${esc(inv.job || inv.fullName || "")}</div>`;
    h += `<div class="inv-meta">Date: ${esc(inv.date)} &bull; Due: ${esc(inv.dueDate)}`;
    if (od > 0) h += ` &bull; <span class="inv-overdue">${od}d overdue</span>`;
    if (Math.abs(inv.amount - inv.openBalance) > 0.01) h += ` &bull; Orig: ${fmt(inv.amount)}`;
    h += `</div></div><div class="inv-amt">${fmt(inv.openBalance)}</div></div>`;
    csv += `"${inv.num}","${inv.type}","${(inv.job || "").replace(/"/g, '""')}","${inv.date}","${inv.dueDate}",${od},${inv.amount},${inv.openBalance},"${inv.bucket}"\n`;
  });

  const visTotal = visible.reduce((s, inv) => s + inv.openBalance, 0);
  h += `<div style="padding:12px 40px;text-align:right;font-family:Barlow Condensed,sans-serif;font-size:16px;font-weight:800;border-top:2px solid #1c1814">Total: ${fmt(visTotal)}</div>`;
  openPrintWindow(title, h, csv);
}

// ─── Invoices Tab ───
export function exportInvoicesView(allInvoices) {
  const items = allInvoices.filter((inv) => inv.type === "Invoice" && inv.openBalance > 0).sort((a, b) => b.openBalance - a.openBalance);
  const totalAmt = items.reduce((s, inv) => s + inv.openBalance, 0);
  let h = `<div class="summary"><div class="scard"><div class="scard-l">Open Invoices</div><div class="scard-v">${items.length}</div></div><div class="scard"><div class="scard-l">Total</div><div class="scard-v">${rptFmt(totalAmt)}</div></div></div>`;
  h += `<table><thead><tr><th>Invoice</th><th>Customer</th><th>Job</th><th>Date</th><th>Due</th><th>Age</th><th style="text-align:right">Amount</th></tr></thead><tbody>`;
  let csv = "Invoice,Customer,Job,Date,Due,Days Overdue,Open Balance\n";
  items.forEach((inv) => {
    const od = daysOverdue(inv.dueDate);
    h += `<tr><td style="font-weight:700">#${esc(inv.num)}</td><td>${esc(inv.customer)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(inv.job || "")}</td><td>${esc(inv.date)}</td><td>${esc(inv.dueDate)}</td><td>${od > 0 ? `<span class="inv-overdue">${od}d</span>` : "Current"}</td><td class="amt">${fmt(inv.openBalance)}</td></tr>`;
    csv += `"${inv.num}","${inv.customer}","${(inv.job || "").replace(/"/g, '""')}","${inv.date}","${inv.dueDate}",${od},${inv.openBalance}\n`;
  });
  h += `</tbody></table>`;
  openPrintWindow("AR Invoices", h, csv);
}

// ─── Health Check ───
export function exportHealthView(ar) {
  const t = ar.getTotals();
  let h = `<div class="summary">`;
  h += `<div class="scard"><div class="scard-l">Total Outstanding</div><div class="scard-v">${rptFmt(t.total)}</div></div>`;
  h += `<div class="scard"><div class="scard-l">Accounts</div><div class="scard-v">${ar.customers.length}</div></div>`;
  h += `<div class="scard" style="border-color:#dc262644"><div class="scard-l" style="color:#dc2626">91+ Days</div><div class="scard-v" style="color:#dc2626">${rptFmt(t.over90)}</div></div>`;
  h += `<div class="scard" style="border-color:#7c3aed44"><div class="scard-l" style="color:#7c3aed">Retention</div><div class="scard-v" style="color:#7c3aed">${rptFmt(t.retention)}</div></div></div>`;
  h += `<div class="section-hdr">Top 15 Customers by Outstanding Balance</div>`;
  h += `<table><thead><tr><th>Customer</th><th style="text-align:right">Current</th><th style="text-align:right">1-30</th><th style="text-align:right">31-60</th><th style="text-align:right">61-90</th><th style="text-align:right">91+</th><th style="text-align:right">Total</th></tr></thead><tbody>`;
  ar.customers.slice().sort((a, b) => b.total - a.total).slice(0, 15).forEach((c) => {
    const b = ar.getCustBuckets(c, false);
    h += `<tr><td style="font-weight:600">${esc(c.name)}</td><td class="amt">${b.current ? fmt(b.current) : ""}</td><td class="amt">${b.days30 ? fmt(b.days30) : ""}</td><td class="amt">${b.days60 ? fmt(b.days60) : ""}</td><td class="amt">${b.days90 ? fmt(b.days90) : ""}</td><td class="amt">${b.over90 ? fmt(b.over90) : ""}</td><td class="amt" style="font-weight:800">${fmt(c.total)}</td></tr>`;
  });
  h += `</tbody></table>`;
  openPrintWindow("AR Health Check", h, null);
}

// ─── Action Plan ───
export function exportActionView(ar) {
  const chase = [];
  const today = new Date();
  ar.customers.forEach((c) => { c.invoices.forEach((inv) => {
    if (inv.type !== "Invoice" || inv.openBalance <= 0) return;
    if (ar.isRetention(inv, c.name) || ar.isCollections(inv, c.name) || ar.isGoback(inv, c.name)) return;
    const d = parseDate(inv.dueDate || inv.date); if (!d) return;
    const od = Math.floor((today - d) / 86400000);
    if (od > 30) chase.push({ customer: c.name, num: inv.num, amount: inv.openBalance, days: od });
  }); });
  chase.sort((a, b) => b.amount - a.amount);

  let h = `<div class="section-hdr">Chase Cash (${chase.length} invoices 30+ days overdue)</div>`;
  if (chase.length) {
    h += `<table><thead><tr><th>Customer</th><th>Invoice</th><th>Days Overdue</th><th style="text-align:right">Amount</th></tr></thead><tbody>`;
    chase.slice(0, 30).forEach((it) => { h += `<tr><td>${esc(it.customer)}</td><td>#${esc(it.num)}</td><td class="inv-overdue">${it.days}d</td><td class="amt">${fmt(it.amount)}</td></tr>`; });
    if (chase.length > 30) h += `<tr><td colspan="4" style="color:#887c6e;font-style:italic">...and ${chase.length - 30} more</td></tr>`;
    h += `</tbody></table>`;
  }
  openPrintWindow("AR Action Plan", h, null);
}

// ─── Cash Flow Forecast ───
export function exportCFFView(ar) {
  const scheduled = [], unscheduled = [];
  ar.allInvoices.forEach((inv) => {
    if (inv.openBalance <= 0) return;
    const k = invKey(inv.customer, inv.num, inv.date);
    if (ar.expectedDates[k]) scheduled.push({ inv, expDate: ar.expectedDates[k] });
    else unscheduled.push(inv);
  });
  scheduled.sort((a, b) => { const da = parseDate(a.expDate), db = parseDate(b.expDate); return (da || 0) - (db || 0); });
  unscheduled.sort((a, b) => b.openBalance - a.openBalance);
  const schedTotal = scheduled.reduce((s, it) => s + it.inv.openBalance, 0);
  const unschedTotal = unscheduled.reduce((s, inv) => s + inv.openBalance, 0);

  let h = `<div class="summary"><div class="scard" style="border-color:#05966944"><div class="scard-l" style="color:#059669">Scheduled</div><div class="scard-v" style="color:#059669">${rptFmt(schedTotal)}</div></div><div class="scard" style="border-color:#d9770644"><div class="scard-l" style="color:#d97706">Unscheduled</div><div class="scard-v" style="color:#d97706">${rptFmt(unschedTotal)}</div></div></div>`;
  if (scheduled.length) {
    h += `<div class="section-hdr">Scheduled Payments (${scheduled.length})</div>`;
    h += `<table><thead><tr><th>Expected Date</th><th>Customer</th><th>Invoice</th><th>Job</th><th style="text-align:right">Amount</th></tr></thead><tbody>`;
    scheduled.forEach((it) => { h += `<tr><td style="font-weight:600;color:#059669">${esc(it.expDate)}</td><td>${esc(it.inv.customer)}</td><td>#${esc(it.inv.num)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.inv.job || "")}</td><td class="amt">${fmt(it.inv.openBalance)}</td></tr>`; });
    h += `</tbody></table>`;
  }
  if (unscheduled.length) {
    h += `<div class="section-hdr">Unscheduled (${unscheduled.length})</div>`;
    h += `<table><thead><tr><th>Customer</th><th>Invoice</th><th>Due</th><th style="text-align:right">Amount</th></tr></thead><tbody>`;
    unscheduled.slice(0, 30).forEach((inv) => { h += `<tr><td>${esc(inv.customer)}</td><td>#${esc(inv.num)}</td><td>${esc(inv.dueDate)}</td><td class="amt">${fmt(inv.openBalance)}</td></tr>`; });
    if (unscheduled.length > 30) h += `<tr><td colspan="4" style="color:#887c6e;font-style:italic">...and ${unscheduled.length - 30} more</td></tr>`;
    h += `</tbody></table>`;
  }
  openPrintWindow("Cash Flow Forecast", h, null);
}

// ─── Accountant Review ───
// Bundles all invoices flagged for accountant review OR with "unknown" decision reason
export function exportAcctReviewView(ar) {
  const items = [];
  ar.customers.forEach((c) => {
    c.invoices.forEach((inv) => {
      const k = invKey(c.name, inv.num, inv.date);
      const isAcct = ar.isAccountantReview(inv, c.name);
      const decision = ar.decisions?.[k];
      const isUnknown = decision?.reason === "unknown";
      const isUnsure = ar.triageFlags[k] === "unsure" && !decision?.reason;
      if (!isAcct && !isUnknown && !isUnsure) return;
      const od = daysOverdue(inv.dueDate);
      const notes = (ar.notes[k] || []).slice().sort((a, b) => b.ts - a.ts);
      items.push({ inv, custName: c.name, od, reason: decision?.reason, action: decision?.overrideAction || decision?.action, notes, isAcct, isUnknown, isUnsure });
    });
  });
  items.sort((a, b) => Math.abs(b.inv.openBalance) - Math.abs(a.inv.openBalance));

  const totalAmt = items.reduce((s, it) => s + it.inv.openBalance, 0);

  let h = `<div class="summary">`;
  h += `<div class="scard"><div class="scard-l">Items for Review</div><div class="scard-v">${items.length}</div></div>`;
  h += `<div class="scard"><div class="scard-l">Total Amount</div><div class="scard-v">${rptFmt(totalAmt)}</div></div>`;
  h += `<div class="scard" style="border-color:#6366f144"><div class="scard-l" style="color:#6366f1">Accounting Method</div><div class="scard-v" style="color:#6366f1;font-size:16px">Cash Basis</div></div>`;
  h += `</div>`;

  h += `<div style="padding:16px 40px;background:#f0f0ff;border-bottom:1px solid #e5e2dd;font-size:12px;line-height:1.6;color:#352e26">`;
  h += `<strong>For the accountant:</strong> These are invoices I need guidance on. For each item, I need to know: what's the correct QuickBooks action (write off, credit memo, journal entry, or leave as-is), and are there any tax implications I should be aware of? We are on <strong>cash basis</strong>.`;
  h += `</div>`;

  items.forEach((it, idx) => {
    const reasonLabel = it.reason ? (REASON_MAP[it.reason]?.label || it.reason) : "Not classified";
    const actionLabel = it.action ? (ACTIONS[it.action]?.label || it.action) : "No recommendation yet";
    const flags = [];
    if (it.isAcct) flags.push("Flagged for Accountant Review");
    if (it.isUnknown) flags.push("Reason: Don't Know");
    if (it.isUnsure) flags.push("Triage: Unsure");

    h += `<div style="padding:16px 40px;border-bottom:1px solid #e5e2dd;${idx % 2 ? "background:#faf8f5" : ""}">`;
    h += `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">`;
    h += `<div><span style="font-weight:700;font-size:14px">#${esc(it.inv.num || "\u2014")}</span> ${ageBadgeHtml(it.inv.bucket)}`;
    flags.forEach((f) => { h += ` <span class="age-badge" style="background:#ede9fe;color:#6366f1">${esc(f)}</span>`; });
    h += `</div><div class="inv-amt">${fmt(it.inv.openBalance)}</div></div>`;

    h += `<div style="font-weight:600;font-size:12px;color:#352e26">${esc(it.custName)}</div>`;
    if (it.inv.job) h += `<div style="font-size:10px;color:#6b7280;margin-top:2px">${esc(it.inv.job)}</div>`;
    h += `<div style="font-size:10px;color:#887c6e;margin-top:4px">Date: ${esc(it.inv.date)} &bull; Due: ${esc(it.inv.dueDate)}`;
    if (it.od > 0) h += ` &bull; <span style="color:#dc2626;font-weight:700">${it.od}d overdue</span>`;
    if (Math.abs(it.inv.amount - it.inv.openBalance) > 0.01) h += ` &bull; Original: ${fmt(it.inv.amount)}`;
    h += `</div>`;

    h += `<div style="margin-top:8px;padding:8px 12px;background:rgba(99,102,241,0.06);border-radius:6px;border:1px solid rgba(99,102,241,0.15)">`;
    h += `<div style="font-size:10px;font-weight:700;color:#6366f1;margin-bottom:4px;letter-spacing:0.06em">MY ASSESSMENT</div>`;
    h += `<div style="font-size:11px;color:#352e26"><strong>Issue:</strong> ${esc(reasonLabel)}</div>`;
    h += `<div style="font-size:11px;color:#352e26"><strong>Possible action:</strong> ${esc(actionLabel)}</div>`;
    h += `<div style="font-size:11px;color:#352e26;margin-top:2px"><strong>Need from you:</strong> Confirm this is the right approach, or recommend an alternative.</div>`;
    h += `</div>`;

    if (it.notes.length) {
      h += `<div style="margin-top:8px"><div style="font-size:9px;font-weight:700;color:#887c6e;letter-spacing:0.08em;margin-bottom:4px">NOTES</div>`;
      it.notes.slice(0, 3).forEach((n) => {
        const ts = new Date(n.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        h += `<div style="font-size:10px;color:#6b7280;margin-bottom:2px">${ts}: ${esc(n.text)}</div>`;
      });
      if (it.notes.length > 3) h += `<div style="font-size:10px;color:#9ca3af;font-style:italic">+${it.notes.length - 3} more notes</div>`;
      h += `</div>`;
    }
    h += `</div>`;
  });

  if (!items.length) {
    h += `<div style="padding:40px;text-align:center;color:#887c6e">No items flagged for accountant review. Flag invoices as "Accountant Review" or choose "Don't know" in the decision engine to add them here.</div>`;
  }

  let csv = "Invoice,Customer,Job,Date,Due,Days Overdue,Amount,Open Balance,Issue,Suggested Action,Notes\n";
  items.forEach((it) => {
    const reasonLabel = it.reason ? (REASON_MAP[it.reason]?.label || it.reason) : "";
    const actionLabel = it.action ? (ACTIONS[it.action]?.label || it.action) : "";
    const noteText = it.notes.map((n) => n.text).join("; ").replace(/"/g, '""');
    csv += `"${it.inv.num}","${it.custName}","${(it.inv.job || "").replace(/"/g, '""')}","${it.inv.date}","${it.inv.dueDate}",${it.od},${it.inv.amount},${it.inv.openBalance},"${reasonLabel}","${actionLabel}","${noteText}"\n`;
  });

  openPrintWindow("Accountant Review", h, csv);
}
