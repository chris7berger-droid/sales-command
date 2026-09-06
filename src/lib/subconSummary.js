// Subcon Command home — executive summary loader.
//
// One entry point, `loadSubconSummary()`, that fans out to every command in
// PARALLEL and REUSES each module's canonical calc instead of re-deriving totals
// from raw rows. Each command bundle is wrapped in its own try/catch so a single
// failing source degrades to a skeleton / "coming soon" slot on Home rather than
// blanking the whole dashboard.
//
//   Sales    → loadSnapshot + pipelineStats/digSummary   (src/lib/followUp.js)
//   Schedule → computeHomeDashboard + buildBillingSurface (src/schedule/lib/*)
//   Field    → derived from loaded schedule job status    (DPRs not flowing yet)
//   AR       → live `invoices` table                      (not the QB-import store)
//   Company  → Billed-YTD / Jobs-YTD / Avg-Margin from the sales snapshot
//
// Business rules honored: JOB ≠ SCHEDULED DAY, MOBILIZATION ≠ ALLOCATION (both
// come baked into computeHomeDashboard's distinct counts), SCHEDULED BILLING ≠ AR
// (Schedule "Scheduled to Bill" is future contract value; AR is the live invoice
// book), MARGIN CLOSED ≠ MARGIN IN PROGRESS (headline avg margin uses Sold jobs).

import { supabase } from "./supabase";
import { loadSnapshot, pipelineStats, digSummary } from "./followUp";
import { calcWtcBreakdown, usesExactPricing } from "./calc";
import {
  loadJobs, loadAllRows, loadPRTsForCallLogIds, loadMobilizationsByJobId,
  loadBillingSurfaceData, computeHomeDashboard, fmtD, getMonday, wkDates,
} from "../schedule/lib/queries";
import { buildBillingSurface, netOfInvoice, isActiveInvoice, isSent, isPaid } from "../schedule/lib/billingForecast";

const yr = () => String(new Date().getFullYear());
const dayDiff = (dstr, todayStr) =>
  dstr ? Math.round((new Date(dstr + "T00:00:00") - new Date(todayStr + "T00:00:00")) / 86400000) : null;

// ── Sales + Company (share one snapshot load) ────────────────────────────────
// The sales snapshot already carries proposals-with-WTCs, so the Company Snapshot
// numbers (Billed YTD, Jobs YTD, Avg Margin closed) come free off the same load.
async function loadSalesAndCompany() {
  const snap = await loadSnapshot();
  if (snap.status === "error") throw snap.error || new Error("sales snapshot failed");

  const ps = pipelineStats(snap);
  const dig = digSummary(snap);

  const year = yr();
  const proposals = snap.proposals || [];

  // ONE population for all three company numbers (audit A2): Sold proposals
  // approved this year. soldYTD, jobsYTD, and avg margin all derive from it, so
  // they can't drift from each other.
  const soldProposals = proposals.filter(
    p => p.status === "Sold" && (p.approved_at || "").startsWith(year));

  // Sold YTD — CONTRACT value of jobs won this year (NOT invoiced dollars; true
  // "billed" needs the AR-live invoice work deferred in §4). Labeled "Sold YTD".
  const soldYTDValue = soldProposals.reduce((s, p) => s + (p.total || 0), 0);

  // Jobs YTD — DISTINCT call_log behind the Sold proposals (multi-proposal job
  // counts once).
  const jobsYTD = new Set(soldProposals.map(p => p.call_log_id).filter(Boolean)).size;

  // Avg QUOTED margin — blended (Σprofit / Σprice) across the Sold jobs' WTCs.
  // This is margin quoted AT SALE, not realized margin on finished jobs (which
  // needs field actuals that don't flow yet). Labeled "Avg Quoted Margin (Sold
  // YTD)". Blended, not mean-of-percents, so big jobs weigh more; rate-card /
  // zero-price lines are skipped.
  let profitSum = 0, priceSum = 0;
  for (const p of soldProposals) {
    const exact = usesExactPricing(p);
    for (const wtc of p.proposal_wtc || []) {
      const b = calcWtcBreakdown(wtc, exact);
      if (b && b.price > 0) { profitSum += b.profit || 0; priceSum += b.price || 0; }
    }
  }
  const avgQuotedMargin = priceSum > 0 ? (profitSum / priceSum) * 100 : null;

  return {
    sales: {
      activeLeads: ps.all,
      bidsOut: ps.hasBid.count,   // bids submitted, awaiting decision (no "priority" source exists)
      potentialRevenue: (ps.hasBid.amount || 0) + (ps.wantsBid.amount || 0),
    },
    company: { soldYTD: soldYTDValue, jobsYTD, avgQuotedMargin },
    // overdue bids feed the cross-command Needs Attention list
    overdueBids: dig.overdue?.count || 0,
  };
}

// ── Schedule + Field (one heavy load, mirrors src/schedule/views/Home.jsx) ────
async function loadScheduleAndField() {
  const monday = getMonday(new Date());
  const dates = wkDates(monday);
  const todayStr = fmtD(new Date());
  const wsStr = dates[0];
  const weStr = dates[dates.length - 1];

  const [jobsRes, allAsgnRes, weekAsgnRes, crewRes, csRes, matsRes, billRes] = await Promise.all([
    loadJobs({ withWTCs: true }),
    loadAllRows("assignments", "*", { orderBy: "id" }),
    supabase.from("assignments").select("*").gte("date", wsStr).lte("date", weStr),
    supabase.from("crew").select("*"),
    supabase.from("crew_status").select("*").gte("date", wsStr).lte("date", weStr),
    loadAllRows("job_material_lines", "id, job_id, status", { orderBy: "id" }),
    loadBillingSurfaceData(),
  ]);
  if (jobsRes.error) throw jobsRes.error;

  const jobs = jobsRes.data || [];
  const crew = (crewRes.data || []).filter(c => !c.archived);
  const weekAssignments = weekAsgnRes.data || [];
  const allAssignments = allAsgnRes.data || [];
  const crewStatusMap = {};
  for (const c of (csRes.data || [])) crewStatusMap[c.crew_name + "|" + c.date] = c.status;
  const matsByJobId = (matsRes.data || []).reduce((m, r) => { (m[r.job_id] ||= []).push(r); return m; }, {});

  let mobsByJobId = {};
  if (jobs.length) mobsByJobId = await loadMobilizationsByJobId(jobs);

  const activeCallLogIds = jobs
    .filter(j => j.status === "In Progress" || j.status === "Ongoing")
    .map(j => j.call_log_id).filter(Boolean);
  let prtMap = new Map();
  if (activeCallLogIds.length) {
    const prtRes = await loadPRTsForCallLogIds(activeCallLogIds);
    prtMap = prtRes.data || new Map();
  }

  const dash = computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments, matsByJobId, dates, todayStr,
    prtMap, mobsByJobId,
  });

  const t = new Date(); t.setHours(0, 0, 0, 0);
  const built = billRes ? buildBillingSurface(jobs, billRes, t, getMonday) : null;

  // Scheduled to Bill — contract value of jobs starting in the next 30 days,
  // from the billing surface's authoritative totals (same calc as Schedule Home's
  // "Scheduled Work $"). This is FUTURE EXPECTED BILLING, not AR.
  let scheduledToBill = 0;
  if (built) {
    const jobById = new Map(jobs.map(j => [j.job_id, j]));
    for (const r of built.rows) {
      if (!r.authoritativeResolved) continue;
      const j = jobById.get(r.jobId);
      const diff = dayDiff(j && (j.scheduled_start || j.start_date), todayStr);
      if (diff == null || diff < 0 || diff > 30) continue;
      scheduledToBill += r.authoritative || 0;
    }
  }

  return {
    schedule: {
      crewAvailable: dash.crewAvailable,
      jobsAssigned: dash.jobsScheduled,   // distinct jobs this week (multi-day = 1)
      scheduledToBill,
    },
    field: {
      // Jobs In Progress IS derivable now from schedule job status. On-Track % and
      // Need-Attention wait on Field DPRs → rendered as "Coming soon" on Home.
      jobsInProgress: jobs.filter(j => j.status === "In Progress").length,
    },
    activeCrews: dash.assignedCount,      // current deployed crews → Company Snapshot
    // exception counts for the cross-command Needs Attention list
    attention: {
      needCrews: dash.needCrews || 0,
      conflicts: dash.conflicts || 0,
      notReady: dash.notReady || 0,
      goBacks: dash.goBacksCount || 0,
    },
  };
}

// ── AR (live invoices table — NOT the QB-import ARContext store) ──────────────
async function loadAR() {
  const invRes = await loadAllRows(
    "invoices",
    "id, job_name, amount, discount, retention_amount, retention_release_of, status, sent_at, paid_at, due_date, voided_at, deleted_at",
    { orderBy: "id" });
  if (invRes.error) throw invRes.error;

  const active = (invRes.data || []).filter(isActiveInvoice);
  // Open = actually sent, not yet paid, and NOT a retention-release row (a
  // release re-bills already-counted dollars — audit A1). Canonical predicates.
  const open = active.filter(i => isSent(i) && !isPaid(i) && i.retention_release_of == null);
  // Outstanding = NET collectable: gross − discount − retention held (the money
  // the customer actually owes), via the canonical netOfInvoice. Summing gross
  // `amount` overstated AR by held retention + discounts (audit A1).
  const outstandingAR = open.reduce((s, i) => s + netOfInvoice(i), 0);

  const todayStr = fmtD(new Date());
  const overdue30 = open.filter(i => {
    const d = dayDiff(i.due_date, todayStr);   // days until due; negative = past due
    return d != null && d < -30;
  });

  return {
    ar: { outstandingAR, openInvoices: open.length },   // Expected-this-month = coming soon
    overdueInvoices: overdue30.length,
    // recent invoice events for the What's Happening feed. Link to the LIVE
    // invoice list (/sales/invoices), not /ar/* — the AR module still gates on
    // its QuickBooks-import store (audit B2).
    invoiceEvents: active.flatMap(i => {
      const ev = [];
      if (isPaid(i)) ev.push({ when: i.paid_at, kind: "payment", text: `Payment received — ${i.job_name || "invoice"}`, to: "/sales/invoices" });
      else if (isSent(i)) ev.push({ when: i.sent_at, kind: "invoice", text: `Invoice sent — ${i.job_name || "job"}`, to: "/sales/invoices" });
      return ev;
    }),
  };
}

// ── Activity feed (What's Happening) ─────────────────────────────────────────
// Schedule job_changes + AR invoice events, merged, most-recent first. Field
// events (job started, production completed) wait on DPRs. Default window: THIS
// WEEK (last 7 days).
// Turn a raw job_changes row into a human business event (audit D1 / Beat 3b —
// "meaningful business events only, not every DB change").
function humanizeChange(r) {
  const j = `Job ${r.job_id}`;
  const f = String(r.field || "").toLowerCase();
  const v = r.new_value;
  if (f === "status") return `${j} moved to ${v}`;
  if (f.includes("go_back") || f.includes("mobilization")) return `${j} — go-back added`;
  if (f.includes("date")) return `${j} rescheduled`;        // scheduled_start/end, start_date/end_date
  if (f.includes("crew")) return `${j} — crew updated`;
  return `${j} updated`;
}

async function loadScheduleActivity() {
  const res = await supabase
    .from("job_changes")
    .select("id, field, new_value, job_id, changed_at")
    .order("changed_at", { ascending: false })
    .limit(15);
  if (res.error) throw res.error;
  return (res.data || []).map(r => ({
    when: r.changed_at,
    kind: "schedule",
    text: humanizeChange(r),
    to: `/schedule/jobs/${r.job_id}`,
  }));
}

export async function loadSubconSummary() {
  const [salesR, schedR, arR, actR] = await Promise.allSettled([
    loadSalesAndCompany(),
    loadScheduleAndField(),
    loadAR(),
    loadScheduleActivity(),
  ]);

  const val = r => (r.status === "fulfilled" ? r.value : null);
  const sales = val(salesR);
  const sched = val(schedR);
  const ar = val(arR);
  const activityRows = val(actR) || [];

  // Cross-command Needs Attention — only rows with a real, non-zero count.
  const attention = [];
  if (sched?.attention) {
    const a = sched.attention;
    if (a.needCrews) attention.push({ label: "Jobs short on crew this week", count: a.needCrews, severity: "high", to: "/schedule/jobs" });
    if (a.conflicts) attention.push({ label: "Crew double-booked", count: a.conflicts, severity: "high", to: "/schedule/schedule" });
    if (a.notReady) attention.push({ label: "Jobs not ready to start", count: a.notReady, severity: "med", to: "/schedule/jobs" });
    if (a.goBacks) attention.push({ label: "Go-backs open", count: a.goBacks, severity: "med", to: "/schedule/jobs" });
  }
  if (ar?.overdueInvoices) attention.push({ label: "Invoices past due 30+ days", count: ar.overdueInvoices, severity: "high", to: "/ar/aging" });
  if (sales?.overdueBids) attention.push({ label: "Bids past due", count: sales.overdueBids, severity: "med", to: "/sales/calllog" });

  // Merge activity, keep THIS WEEK, most-recent first, drop consecutive
  // duplicates (a job whose start AND end changed logs two "rescheduled" rows),
  // cap ~6.
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const seenText = new Set();
  const activity = [...activityRows, ...(ar?.invoiceEvents || [])]
    .filter(e => e.when && new Date(e.when) >= weekAgo)
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .filter(e => { if (seenText.has(e.text)) return false; seenText.add(e.text); return true; })
    .slice(0, 6);

  return {
    sales: sales?.sales || null,
    schedule: sched?.schedule || null,
    field: sched?.field || null,
    ar: ar?.ar || null,
    company: sales?.company
      ? { ...sales.company, activeCrews: sched?.activeCrews ?? null }
      : (sched ? { soldYTD: null, jobsYTD: null, avgQuotedMargin: null, activeCrews: sched.activeCrews } : null),
    attention,
    activity,
    // which sources failed → the card renders its own skeleton/"unavailable"
    errors: {
      sales: salesR.status === "rejected",
      schedule: schedR.status === "rejected",
      ar: arR.status === "rejected",
      activity: actR.status === "rejected",
    },
  };
}
