// Data layer for the Home → Follow-Up screen (docs/plans/home-follow-up-screen.md §2.1).
//
// ONE shared snapshot per load, every list derived in memory (kills the K1
// fan-out): one call_log fetch, one proposals fetch, one customers fetch, one
// archive touch-date fetch (archive-lineage jobs only), one outreach_log fetch
// (suppression). Loaders are three-state — data / empty / error — and never
// collapse an error into empty (fetchAll returns [] on error, which would read
// as a false "all clear", so this file pages with its own error-surfacing
// select).
//
// CORRECTIONS vs the frozen plan text (verified against prod 2026-08-11):
//   * Archive last-touch (P4/N1): the plan names `archive_records.record_date`,
//     which does NOT exist. The archive book lives in `archive.legacy_records`,
//     read through the `archiveDb` client (archive schema, caller JWT). Join is
//     call_log.archive_record_id (uuid) = legacy_records.id; date = record_date.
//   * outreach_log.call_log_id is INTEGER (call_log.id is integer) — callers
//     pass the integer call_log id, not a uuid.
//   * Zone 3 cards need customer name + phone, which the call_log/proposals
//     snapshot doesn't carry, so a small customers fetch is part of the snapshot.

import { supabase, archiveDb } from "./supabase";
import { tod } from "./utils";
import { STAGES } from "./mockData";

// ── Thresholds (v1 consts; no admin UI yet — plan §4) ──────────────────────
export const DORMANT_MONTHS = 6;
export const GONE_QUIET_DAYS = 30;

// Per-outcome suppression windows in days (Chris ratified 2026-08-11, §2.4/P2).
// Terminal outcomes suppress longer but never permanently — every window finite,
// so a mis-log self-heals via the supersede rule (latest outcome wins, N8).
export const SUPPRESSION_WINDOWS = {
  "Left message": 14,
  "Reached — interested": 14,
  "Reached — not now": 30,
  "Bad number": 180,
};
export const OUTCOMES = Object.keys(SUPPRESSION_WINDOWS);
const MAX_SUPPRESSION_DAYS = Math.max(...Object.values(SUPPRESSION_WINDOWS)); // 180

// ── Wall-clock date helpers (Postgres `date` cols are wall-clock, never UTC) ──
const ymd = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD
function monthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return ymd(d); }
function daysAgo(n)   { const d = new Date(); d.setDate(d.getDate() - n);   return ymd(d); }
function addDays(dateStr, n) { const d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + n); return ymd(d); }
const day = (v) => (v ? String(v).slice(0, 10) : null); // normalize date | timestamptz → YYYY-MM-DD

// Archive jobs carry their REAL sold date in raw_data['job/soldDate'], but in
// mixed formats — ISO 8601 ("2025-02-13T00:01:06.302Z") AND a US locale string
// ("2/2/2026, 12:00:00 AM"). Return wall-clock YYYY-MM-DD (ISO: take the date
// part directly to avoid a UTC→local month shift; locale: parse via Date).
export function parseArchiveSoldDate(v) {
  if (!v) return null;
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : ymd(d);
}

// The month (YYYY-MM) a Sold proposal is credited to — the ONE basis every
// "sold this month" surface must share (B70). Archive-lineage jobs (pulled live
// from the History Locker) credit to their REAL sold date
// (raw_data['job/soldDate']); normal jobs to proposal.created_at. Unknown
// archive sold date → null (not counted this month), so an old sale imported
// this month is never miscounted as new. `archiveIdByJob` maps call_log_id →
// archive_record_id; `archiveSoldDateById` maps archive id → YYYY-MM-DD (both
// from loadSnapshot, or an equivalent archive fetch — see CallLog "Your Pipeline").
export function creditedSoldMonth(proposal, { archiveIdByJob, archiveSoldDateById } = {}) {
  const arc = archiveIdByJob?.get(proposal.call_log_id);
  if (arc) { const d = archiveSoldDateById?.get(arc); return d ? d.slice(0, 7) : null; }
  return day(proposal.created_at)?.slice(0, 7) || null;
}

// ── Error-surfacing paginated select (fetchAll swallows the error; P5/N7) ────
async function pagedSelect(client, table, select, { order, filters = [], pageSize = 1000 } = {}) {
  let all = [], from = 0;
  for (;;) {
    let q = client.from(table).select(select);
    if (order) {
      const col = typeof order === "string" ? order : order.column;
      const asc = typeof order === "string" ? true : order.ascending;
      q = q.order(col, { ascending: asc !== false });
    }
    for (const [method, ...args] of filters) q = q[method](...args);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

function emptySnap(status, error) {
  return { status, error: error || null, callLog: [], proposals: [], customers: [], archiveDateById: new Map(), archiveSoldDateById: new Map(), outreach: [], teamMembers: [] };
}

// ── The one shared snapshot ─────────────────────────────────────────────────
export async function loadSnapshot() {
  // 1. call_log — the pipeline spine (footer + all three zones derive from it).
  //    `follow_up` (self-set follow-up date) surfaces on the Home "What You Owe"
  //    box (engagement redesign Box 5) — the column already exists, so this is a
  //    read-only select add, zero DB.
  const cl = await pagedSelect(supabase, "call_log",
    "id, stage, sales_name, customer_id, bid_due, follow_up, created_at, updated_at, archive_record_id, display_job_number, customer_name, job_name",
    { order: "id" });
  if (cl.error) return emptySnap("error", cl.error);

  // 2. proposals — union select so the footer's billings % has total + end_date.
  //    `proposal_recipients(sent_at, viewed_at)` is an EMBEDDED array (a shape
  //    change, not a flat column) — used by the "Almost Yes" hunt angle to find
  //    bids a customer opened but never signed. Never a flattening join (that
  //    double-counts $ across recipients — audit L3). Columns already exist.
  const pr = await pagedSelect(supabase, "proposals",
    "id, call_log_id, customer_id, status, created_at, total, proposal_wtc(end_date), proposal_recipients(sent_at, viewed_at)",
    { order: "id", filters: [["is", "deleted_at", null]] });
  if (pr.error) return emptySnap("error", pr.error);

  // 3. customers — names + phones for the Zone 3 outbound cards.
  const cx = await pagedSelect(supabase, "customers", "id, name, phone, contact_phone", { order: "id" });
  if (cx.error) return emptySnap("error", cx.error);

  // 4. archive touch dates — ONLY the archive-lineage jobs (a few dozen). An
  //    archived job's call_log.created_at is the IMPORT date, not a real touch
  //    (N1) — without this the whole historical book reads "touched today" and
  //    Zone 3 ships empty. Real touch = legacy_records.record_date.
  //    raw_data['job/soldDate'] is the job's REAL sold date — used to credit an
  //    archived Sold job to the month it was ACTUALLY sold, not the import month
  //    (otherwise pulling an old job live counts it as a brand-new sale).
  const archiveIds = [...new Set(cl.data.map(r => r.archive_record_id).filter(Boolean))];
  const archiveDateById = new Map();
  const archiveSoldDateById = new Map();
  if (archiveIds.length) {
    const { data: legacy, error } = await archiveDb.from("legacy_records").select("id, record_date, raw_data").in("id", archiveIds);
    if (error) return emptySnap("error", error);
    for (const r of legacy || []) {
      archiveDateById.set(r.id, r.record_date);
      const sold = parseArchiveSoldDate(r.raw_data?.["job/soldDate"]);
      if (sold) archiveSoldDateById.set(r.id, sold);
    }
  }

  // 5. outreach_log — last MAX_SUPPRESSION_DAYS, for the suppression rule. The
  //    wide window (=180d, not 14d) so the supersede rule sees older Bad-number
  //    rows before filtering (the N8↔N11 trap). A missing relation (42P01,
  //    preview-before-migration) is "not provisioned yet", not an error.
  //    `logged_by` (free-text displayName of who logged the call) is added for
  //    the Home hero's calls-this-month effort metric — it can diverge from
  //    `sales_name` on a null-name rep, so per-rep counts key on the same
  //    identity the rest of the rep-scoping uses (see homeEngagement).
  const ol = await pagedSelect(supabase, "outreach_log",
    "id, customer_id, call_log_id, outcome, logged_by, created_at",
    { order: "id", filters: [["gte", "created_at", daysAgo(MAX_SUPPRESSION_DAYS)]] });
  let outreach = [];
  if (ol.error) {
    if (ol.error.code !== "42P01") return emptySnap("error", ol.error);
  } else {
    outreach = ol.data || [];
  }

  // 6. team_members — for the goal-split divisor (count of active SALES people).
  //    A plain read; if it fails we fall back to an empty list (divisor guard).
  const tm = await pagedSelect(supabase, "team_members", "id, name, role, active", { order: "id" });
  const teamMembers = tm.error ? [] : (tm.data || []);

  return { status: "data", error: null, callLog: cl.data, proposals: pr.data, customers: cx.data, archiveDateById, archiveSoldDateById, outreach, teamMembers };
}

// ── Suppression: latest outcome per customer wins (supersede, N8) ───────────
function suppressedCustomerIds(outreach) {
  const latest = new Map(); // customer_id -> newest row
  for (const r of outreach) {
    if (!r.customer_id) continue;
    const prev = latest.get(r.customer_id);
    if (!prev || (r.created_at || "") > (prev.created_at || "")) latest.set(r.customer_id, r);
  }
  const suppressed = new Set();
  const today = tod();
  for (const [cid, row] of latest) {
    const win = SUPPRESSION_WINDOWS[row.outcome];
    if (!win) continue;
    if (today < addDays(day(row.created_at), win)) suppressed.add(cid);
  }
  return suppressed;
}

// touch date per customer: real activity, archive-aware (N1/N6/P4)
function buildTouchMap(snap) {
  const touch = new Map();
  const bump = (cid, dateStr) => {
    const d = day(dateStr);
    if (!cid || !d) return;
    const cur = touch.get(cid);
    if (!cur || d > cur) touch.set(cid, d);
  };
  for (const cl of snap.callLog) {
    const d = cl.archive_record_id
      ? snap.archiveDateById.get(cl.archive_record_id) || null // import date is not a touch
      : cl.updated_at || cl.created_at;
    bump(cl.customer_id, d);
  }
  const jobCustomer = new Map(snap.callLog.map(c => [c.id, c.customer_id]));
  for (const p of snap.proposals) {
    bump(p.customer_id || jobCustomer.get(p.call_log_id), p.created_at); // effective customer (N6)
  }
  return touch;
}

// ── Selectors (pure, over the snapshot) ─────────────────────────────────────

// Zone 1: bid-due reached. Order bid_due DESC, id DESC (RG2/N10) — due-today
// pins above older stale. Caller caps at 10 + expander (§2.2).
export function bidDueAlerts(snap, { displayName, isRep } = {}) {
  const today = tod();
  let rows = snap.callLog.filter(r => r.stage === "Wants Bid" && r.bid_due && r.bid_due <= today);
  if (isRep && displayName) rows = rows.filter(r => r.sales_name === displayName);
  rows.sort((a, b) => (a.bid_due !== b.bid_due ? (a.bid_due < b.bid_due ? 1 : -1) : (a.id < b.id ? 1 : -1)));
  return rows.map(r => ({ id: r.id, jobNumber: r.display_job_number, customer: r.customer_name, jobName: r.job_name, bidDue: r.bid_due }));
}

export function alertCount(snap, opts) { return bidDueAlerts(snap, opts).length; }

// Zone 3a: dormant customers — historically sold, no real touch in DORMANT_MONTHS.
// `repName` (optional) scopes to customers whose most-recent job this rep carried
// — the Home engagement hunt lists are personal (A1: rep-scoping is new code,
// not a free reuse). `value` = the customer's historical sold $ (the dollar tag
// that makes a call feel like chasing money, Box 6).
export function dormantCustomers(snap, { repName } = {}) {
  const touch = buildTouchMap(snap);
  const cutoff = monthsAgo(DORMANT_MONTHS);
  const suppressed = suppressedCustomerIds(snap.outreach);
  const jobCustomer = new Map(snap.callLog.map(c => [c.id, c.customer_id]));

  const sold = new Set(); // eligibility: historically sold (D1)
  const soldValue = new Map(); // customer_id -> historical sold $
  for (const cl of snap.callLog) if (cl.stage === "Sold" && cl.customer_id) sold.add(cl.customer_id);
  for (const p of snap.proposals) if (p.status === "Sold") {
    const eff = p.customer_id || jobCustomer.get(p.call_log_id);
    if (eff) { sold.add(eff); soldValue.set(eff, (soldValue.get(eff) || 0) + (p.total || 0)); }
  }

  const cxById = new Map(snap.customers.map(c => [c.id, c]));
  const lastJob = new Map(); // most recent call_log per customer, for display + rep attribution
  const jobCount = new Map(); // customer_id -> # of THIS rep's jobs (You're Their Guy ranking)
  for (const cl of snap.callLog) {
    const cur = lastJob.get(cl.customer_id);
    if (!cur || (cl.created_at || "") > (cur.created_at || "")) lastJob.set(cl.customer_id, cl);
    // scope the count to this rep when scoping — "customer this REP has done the most
    // jobs with" must not inflate from other reps' jobs on the same customer.
    if (cl.customer_id && (!repName || cl.sales_name === repName)) jobCount.set(cl.customer_id, (jobCount.get(cl.customer_id) || 0) + 1);
  }

  const out = [];
  for (const cid of sold) {
    if (suppressed.has(cid)) continue;
    const last = touch.get(cid) || null;
    if (last && last >= cutoff) continue; // touched recently → not dormant
    const cx = cxById.get(cid);
    if (!cx) continue;
    const job = lastJob.get(cid);
    if (repName && job?.sales_name !== repName) continue; // personal scope
    out.push({
      source: "dormant", customerId: cid, callLogId: job?.id || null,
      name: cx.name, phone: cx.phone || cx.contact_phone || null,
      lastTouch: last, lastJob: job?.job_name || job?.display_job_number || null,
      value: soldValue.get(cid) || 0, jobCount: jobCount.get(cid) || 0,
    });
  }
  out.sort((a, b) => ((a.lastTouch || "") < (b.lastTouch || "") ? -1 : 1)); // most-dormant first
  return out;
}

// Zone 3b: gone-quiet bids — Has Bid, no Sold proposal, stale by last bid activity.
// `repName` (optional) scopes to this rep's own jobs. `value` = the bid $ (sum of
// the job's proposal totals) and `opened` = a recipient opened but never signed
// (the "Almost Yes" hunt angle, via embedded proposal_recipients.viewed_at).
export function goneQuietBids(snap, { repName } = {}) {
  const cutoff = daysAgo(GONE_QUIET_DAYS);
  const suppressed = suppressedCustomerIds(snap.outreach);

  const soldJobs = new Set();
  const propsByJob = new Map();
  for (const p of snap.proposals) {
    if (p.status === "Sold") soldJobs.add(p.call_log_id);
    if (!propsByJob.has(p.call_log_id)) propsByJob.set(p.call_log_id, []);
    propsByJob.get(p.call_log_id).push(p);
  }
  const cxById = new Map(snap.customers.map(c => [c.id, c]));

  const out = [];
  for (const cl of snap.callLog) {
    if (cl.stage !== "Has Bid" || soldJobs.has(cl.id)) continue;
    if (repName && cl.sales_name !== repName) continue; // personal scope
    const jobProps = propsByJob.get(cl.id) || [];
    // last bid activity: newest non-deleted proposal created_at, fallback bid_due, fallback call_log.created_at (N5)
    const newestProp = jobProps.map(p => day(p.created_at)).filter(Boolean).sort().pop();
    const signal = newestProp || cl.bid_due || day(cl.created_at);
    if (signal && signal >= cutoff) continue; // recent → not gone quiet
    if (cl.customer_id && suppressed.has(cl.customer_id)) continue;
    const cx = cxById.get(cl.customer_id);
    const value = jobProps.reduce((s, p) => s + (p.total || 0), 0);
    // opened-but-never-signed: any recipient with a viewed_at (embedded array, never flattened)
    const opened = jobProps.some(p => (p.proposal_recipients || []).some(r => r.viewed_at));
    out.push({
      source: "gone_quiet", customerId: cl.customer_id || null, callLogId: cl.id,
      name: cl.customer_name || cx?.name || "—", phone: cx?.phone || cx?.contact_phone || null,
      lastTouch: signal || null, lastJob: cl.job_name || cl.display_job_number || null, jobNumber: cl.display_job_number || null,
      value, opened,
    });
  }
  out.sort((a, b) => ((a.lastTouch || "") < (b.lastTouch || "") ? -1 : 1));
  return out;
}

// Footer: pipeline stage counts + monthly-billings % (all-roles line, K2).
export function footerStats(snap, { monthlyGoal } = {}) {
  const month = tod().slice(0, 7);
  const stageCounts = Object.fromEntries(STAGES.map(s => [s, 0]));
  for (const r of snap.callLog) {
    if (!STAGES.includes(r.stage)) continue;
    const monthScoped = !["Has Bid", "Sold"].includes(r.stage); // matches Home `sc` semantics
    if (monthScoped && !day(r.created_at)?.startsWith(month)) continue;
    stageCounts[r.stage]++;
  }
  const endDate = p => { const ds = (p.proposal_wtc || []).map(w => w.end_date).filter(Boolean).sort(); return ds[ds.length - 1] || null; };
  const monthBill = snap.proposals.filter(p => p.status === "Sold" && endDate(p)?.startsWith(month)).reduce((s, p) => s + (p.total || 0), 0);
  const billingsPct = monthlyGoal ? Math.round((monthBill / monthlyGoal) * 100) : 0;
  return { stageCounts, monthBill, billingsPct };
}

// ── Home engagement redesign selectors (home-engagement-redesign.md part 5) ──
//
// The single "sold this month" basis is `proposals.created_at` (part 5 §C),
// used identically by the hero, the money bar, the donut, and the company
// thermometer. `footerStats` above keys the month on WTC `end_date` because it
// is a DIFFERENT metric (billings %, not bookings-sold) — the two are kept
// distinct and never cross-compared.

export const MEDIUM_JOB = 10000; // donut size buckets: Small <10K · Medium 10–50K · Large ≥50K
export const LARGE_JOB = 50000;
const SCOREBOARD_STAGES = ["Wants Bid", "Has Bid", "Sold"]; // Box 4, in order

// Roles that carry a share of the company sales goal. Admins/Managers who show
// up as a sales_name on the odd job do NOT (that was the 4-vs-2 divisor bug).
export const SELLING_ROLES = ["Sales Rep"];

// Divisor N for the goal split: count of ACTIVE SALESPEOPLE (team_members with a
// selling role). Supersedes the plan's "distinct sales_name" model — that counted
// the owner + an admin who each carried a few jobs, splitting the goal 4 ways
// instead of 2 (found in HDSP smoke 2026-08-20). Sales Rep only, so it also
// avoids the original REG-2 bug (which wrongly included Admin/Manager).
export function activeRepCount(snap) {
  return (snap.teamMembers || []).filter(t => t.active && SELLING_ROLES.includes(t.role)).length;
}

// All personal + company figures for the six Home boxes, for ONE rep (repName).
// Orphan Sold proposals (null call_log_id → no rep) are EXCLUDED from every
// per-rep figure but KEPT in the company thermometer (REG-1 / G1).
export function homeEngagement(snap, { repName = "", monthlyGoal = 0 } = {}) {
  const month = tod().slice(0, 7);
  const clById = new Map(snap.callLog.map(c => [c.id, c]));
  const jobSalesName = new Map(snap.callLog.map(c => [c.id, c.sales_name]));
  const jobArchiveId = new Map(snap.callLog.map(c => [c.id, c.archive_record_id]));

  // The month a Sold proposal is credited to — shared with every other
  // "sold this month" surface via creditedSoldMonth (B70). Normal jobs credit to
  // proposal.created_at; archive-lineage jobs to their REAL sold date, so an old
  // sale imported this month is NOT miscounted as new.
  const soldMonthOf = (p) => creditedSoldMonth(p, { archiveIdByJob: jobArchiveId, archiveSoldDateById: snap.archiveSoldDateById });

  // proposal totals grouped by job (for the Wants Bid / Has Bid $ tiles)
  const propsByJob = new Map();
  for (const p of snap.proposals) {
    if (!propsByJob.has(p.call_log_id)) propsByJob.set(p.call_log_id, []);
    propsByJob.get(p.call_log_id).push(p);
  }

  // ── Sold this month (credited by real sold-month; archive-aware) ──
  const soldThisMonth = snap.proposals.filter(p => p.status === "Sold" && soldMonthOf(p) === month);
  const companySold = soldThisMonth.reduce((s, p) => s + (p.total || 0), 0); // incl. orphans → thermometer

  // rep's sold-this-month proposals (orphans excluded — no call_log_id → no rep)
  const repSoldProps = soldThisMonth.filter(p => jobSalesName.get(p.call_log_id) === repName && repName);
  const repSold = repSoldProps.reduce((s, p) => s + (p.total || 0), 0);
  const repSoldCount = repSoldProps.length;

  // ── Best-month badge: ≥1 non-zero prior month AND strictly greater (C6/L1) ──
  const byMonth = new Map();
  for (const p of snap.proposals) {
    if (p.status !== "Sold" || jobSalesName.get(p.call_log_id) !== repName || !repName) continue;
    const m = soldMonthOf(p);
    if (m) byMonth.set(m, (byMonth.get(m) || 0) + (p.total || 0));
  }
  const priors = [...byMonth].filter(([m]) => m < month).map(([, v]) => v);
  const bestMonth = priors.some(v => v > 0) && repSold > Math.max(0, ...priors);

  // ── Effort metrics (calls logged + bids currently out, this rep) ──
  const callsThisMonth = snap.outreach.filter(o => o.logged_by === repName && repName && day(o.created_at)?.startsWith(month)).length;
  const bidsOut = snap.callLog.filter(c => c.sales_name === repName && repName && c.stage === "Has Bid").length;

  // hero state switch: any sale → results; else effort; else fresh-month
  const heroState = repSold > 0 ? "results" : (callsThisMonth > 0 || bidsOut > 0) ? "effort" : "fresh";

  // ── Goal split → personal target ──
  const N = activeRepCount(snap);
  const target = monthlyGoal / Math.max(N, 1); // E2 divide-by-zero guard

  // ── Pace marker: where they should be by today, straight-line ──
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthFrac = now.getDate() / daysInMonth;
  const behind = repSold < target * monthFrac;
  const gap = Math.max(0, target - repSold);

  // ── Scoreboard (Box 4): rep's pipeline as money, per stage ──
  const scoreboard = {};
  for (const stage of SCOREBOARD_STAGES) {
    if (stage === "Sold") { scoreboard.Sold = { amount: repSold, count: repSoldCount }; continue; }
    const jobs = snap.callLog.filter(c => c.sales_name === repName && repName && c.stage === stage);
    const amount = jobs.reduce((s, j) => s + (propsByJob.get(j.id) || []).reduce((t, p) => t + (p.total || 0), 0), 0);
    scoreboard[stage] = { amount, count: jobs.length };
  }

  // ── Donut data (2 views: booked-vs-left → by job size) ──
  let small = 0, medium = 0, large = 0;
  for (const p of repSoldProps) {
    const t = p.total || 0;
    if (t >= LARGE_JOB) large += t;
    else if (t >= MEDIUM_JOB) medium += t;
    else small += t;
  }

  // The exact jobs behind the Sold tile — so tapping it drills into THESE, not the
  // all-time Sold stage list (tile is month + archive-scoped; a stage filter isn't).
  const soldList = repSoldProps.map(p => {
    const cl = clById.get(p.call_log_id);
    return { callLogId: p.call_log_id, customerId: p.customer_id || cl?.customer_id || null,
      name: cl?.customer_name || "—", sub: cl?.display_job_number || cl?.job_name || "", value: p.total || 0 };
  }).sort((a, b) => (b.value || 0) - (a.value || 0));

  return {
    repName, target, goalDivisor: N,
    hero: { state: heroState, sold: repSold, bestMonth, callsThisMonth, bidsOut, soldCount: repSoldCount },
    bar: { sold: repSold, target, pacePct: Math.round(monthFrac * 100), behind, gap },
    donut: { booked: repSold, left: Math.max(0, target - repSold), over: repSold > target, large, medium, small },
    scoreboard,
    soldList,
    thermometer: { sold: companySold, goal: monthlyGoal, pct: monthlyGoal ? Math.round((companySold / monthlyGoal) * 100) : 0 },
  };
}

// Stages where a self-set follow-up is still "owed" — the active sales pipeline.
// A follow-up on a Sold/Scheduled/Lost job is moot (the deal's closed), and reps
// set follow-up dates at intake that never get cleared, so without this guard a
// won job keeps surfacing here forever. Allowlist (not a Sold/Lost blocklist) so
// future post-sale stages can't leak back in.
const OWED_STAGES = new Set(["New Inquiry", "Wants Bid", "Has Bid"]);

// Box 5 "Where To Dig": bids due + self-set follow-up dates, this rep, one list.
// Oldest / most-overdue first. A job that is both a due bid and has a follow-up
// shows once (the bid wins).
export function owedItems(snap, { repName } = {}) {
  const today = tod();
  const bids = bidDueAlerts(snap, { displayName: repName, isRep: !!repName }).map(b => ({
    kind: "bid", id: b.id, title: b.jobNumber || "—", sub: b.customer || "", date: b.bidDue,
  }));
  const seen = new Set(bids.map(b => b.id));
  let fu = snap.callLog.filter(r => r.follow_up && r.follow_up <= today && !seen.has(r.id) && OWED_STAGES.has(r.stage));
  if (repName) fu = fu.filter(r => r.sales_name === repName);
  const followups = fu.map(r => ({
    kind: "followup", id: r.id, title: r.display_job_number || r.job_name || "—",
    sub: r.customer_name || "", date: r.follow_up,
  }));
  return [...bids, ...followups].sort((a, b) => ((a.date || "") < (b.date || "") ? -1 : 1));
}

// Box 6 results companion — the payoff of working the call list, this rep, last
// 7 days (home-engagement-redesign.md Box 6 / F51 results panel v1):
//   Activity = calls logged this week (effort made visible).
//   Impact   = $ of stalled bids RE-ENGAGED this week (sum of the bid value of
//              the distinct Has-Bid jobs this rep logged a call on). This is
//              "money you put back in motion by working it" — NOT "revived/won"
//              (that needs outcome-over-time tracking, deferred to F51).
export function huntResults(snap, { repName } = {}) {
  if (!repName) return { callsThisWeek: 0, reengaged: 0, calls: [], jobs: [] };
  const weekAgo = daysAgo(7);
  const clById = new Map(snap.callLog.map(c => [c.id, c]));
  const cxById = new Map(snap.customers.map(c => [c.id, c]));
  const jobBidValue = new Map(); // call_log_id -> summed non-deleted proposal total
  for (const p of snap.proposals) {
    jobBidValue.set(p.call_log_id, (jobBidValue.get(p.call_log_id) || 0) + (p.total || 0));
  }
  const calls = [];      // every logged call this week (Activity drill-in)
  const jobs = [];       // distinct bids re-engaged this week (Impact drill-in)
  const seenJobs = new Set();
  let reengaged = 0;
  for (const o of snap.outreach) {
    if (o.logged_by !== repName || day(o.created_at) < weekAgo) continue;
    const cl = o.call_log_id ? clById.get(o.call_log_id) : null;
    const name = cl?.customer_name || cxById.get(o.customer_id)?.name || "—";
    calls.push({ callLogId: o.call_log_id || null, customerId: o.customer_id || null, name, outcome: o.outcome, date: day(o.created_at) });
    // "Back in motion" $ = re-engaged STALLED BIDS only (Has Bid). A call logged
    // on a Sold/dormant customer must NOT credit that customer's past sale here.
    if (o.call_log_id && cl?.stage === "Has Bid" && !seenJobs.has(o.call_log_id)) {
      seenJobs.add(o.call_log_id);
      const value = jobBidValue.get(o.call_log_id) || 0;
      reengaged += value;
      jobs.push({ callLogId: o.call_log_id, name: cl?.job_name || cl?.customer_name || name, value });
    }
  }
  jobs.sort((a, b) => (b.value || 0) - (a.value || 0)); // biggest money first
  return { callsThisWeek: calls.length, reengaged, calls, jobs };
}

// ── Write: log an outbound outcome ──────────────────────────────────────────
// App-side "at least one FK" invariant (RG1 — deliberately NO DB CHECK, which
// would re-break customer delete). Verify a row came back (RLS silent no-op).
export async function logOutcome({ source, outcome, note, customerId, callLogId, loggedBy }) {
  if (!customerId && !callLogId) throw new Error("logOutcome needs customerId or callLogId");
  const { data, error } = await supabase.from("outreach_log")
    .insert({ source, outcome, note: note || null, customer_id: customerId || null, call_log_id: callLogId || null, logged_by: loggedBy || null })
    .select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Outcome not saved — no row returned");
  return data[0];
}
