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
  return { status, error: error || null, callLog: [], proposals: [], customers: [], archiveDateById: new Map(), outreach: [] };
}

// ── The one shared snapshot ─────────────────────────────────────────────────
export async function loadSnapshot() {
  // 1. call_log — the pipeline spine (footer + all three zones derive from it).
  const cl = await pagedSelect(supabase, "call_log",
    "id, stage, sales_name, customer_id, bid_due, created_at, updated_at, archive_record_id, display_job_number, customer_name, job_name",
    { order: "id" });
  if (cl.error) return emptySnap("error", cl.error);

  // 2. proposals — union select so the footer's billings % has total + end_date.
  const pr = await pagedSelect(supabase, "proposals",
    "id, call_log_id, customer_id, status, created_at, total, proposal_wtc(end_date)",
    { order: "id", filters: [["is", "deleted_at", null]] });
  if (pr.error) return emptySnap("error", pr.error);

  // 3. customers — names + phones for the Zone 3 outbound cards.
  const cx = await pagedSelect(supabase, "customers", "id, name, phone, contact_phone", { order: "id" });
  if (cx.error) return emptySnap("error", cx.error);

  // 4. archive touch dates — ONLY the archive-lineage jobs (a few dozen). An
  //    archived job's call_log.created_at is the IMPORT date, not a real touch
  //    (N1) — without this the whole historical book reads "touched today" and
  //    Zone 3 ships empty. Real touch = legacy_records.record_date.
  const archiveIds = [...new Set(cl.data.map(r => r.archive_record_id).filter(Boolean))];
  const archiveDateById = new Map();
  if (archiveIds.length) {
    const { data: legacy, error } = await archiveDb.from("legacy_records").select("id, record_date").in("id", archiveIds);
    if (error) return emptySnap("error", error);
    for (const r of legacy || []) archiveDateById.set(r.id, r.record_date);
  }

  // 5. outreach_log — last MAX_SUPPRESSION_DAYS, for the suppression rule. The
  //    wide window (=180d, not 14d) so the supersede rule sees older Bad-number
  //    rows before filtering (the N8↔N11 trap). A missing relation (42P01,
  //    preview-before-migration) is "not provisioned yet", not an error.
  const ol = await pagedSelect(supabase, "outreach_log",
    "id, customer_id, call_log_id, outcome, created_at",
    { order: "id", filters: [["gte", "created_at", daysAgo(MAX_SUPPRESSION_DAYS)]] });
  let outreach = [];
  if (ol.error) {
    if (ol.error.code !== "42P01") return emptySnap("error", ol.error);
  } else {
    outreach = ol.data || [];
  }

  return { status: "data", error: null, callLog: cl.data, proposals: pr.data, customers: cx.data, archiveDateById, outreach };
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
export function dormantCustomers(snap) {
  const touch = buildTouchMap(snap);
  const cutoff = monthsAgo(DORMANT_MONTHS);
  const suppressed = suppressedCustomerIds(snap.outreach);
  const jobCustomer = new Map(snap.callLog.map(c => [c.id, c.customer_id]));

  const sold = new Set(); // eligibility: historically sold (D1)
  for (const cl of snap.callLog) if (cl.stage === "Sold" && cl.customer_id) sold.add(cl.customer_id);
  for (const p of snap.proposals) if (p.status === "Sold") { const eff = p.customer_id || jobCustomer.get(p.call_log_id); if (eff) sold.add(eff); }

  const cxById = new Map(snap.customers.map(c => [c.id, c]));
  const lastJob = new Map(); // most recent call_log per customer, for display
  for (const cl of snap.callLog) {
    const cur = lastJob.get(cl.customer_id);
    if (!cur || (cl.created_at || "") > (cur.created_at || "")) lastJob.set(cl.customer_id, cl);
  }

  const out = [];
  for (const cid of sold) {
    if (suppressed.has(cid)) continue;
    const last = touch.get(cid) || null;
    if (last && last >= cutoff) continue; // touched recently → not dormant
    const cx = cxById.get(cid);
    if (!cx) continue;
    const job = lastJob.get(cid);
    out.push({
      source: "dormant", customerId: cid, callLogId: job?.id || null,
      name: cx.name, phone: cx.phone || cx.contact_phone || null,
      lastTouch: last, lastJob: job?.job_name || job?.display_job_number || null,
    });
  }
  out.sort((a, b) => ((a.lastTouch || "") < (b.lastTouch || "") ? -1 : 1)); // most-dormant first
  return out;
}

// Zone 3b: gone-quiet bids — Has Bid, no Sold proposal, stale by last bid activity.
export function goneQuietBids(snap) {
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
    // last bid activity: newest non-deleted proposal created_at, fallback bid_due, fallback call_log.created_at (N5)
    const newestProp = (propsByJob.get(cl.id) || []).map(p => day(p.created_at)).filter(Boolean).sort().pop();
    const signal = newestProp || cl.bid_due || day(cl.created_at);
    if (signal && signal >= cutoff) continue; // recent → not gone quiet
    if (cl.customer_id && suppressed.has(cl.customer_id)) continue;
    const cx = cxById.get(cl.customer_id);
    out.push({
      source: "gone_quiet", customerId: cl.customer_id || null, callLogId: cl.id,
      name: cl.customer_name || cx?.name || "—", phone: cx?.phone || cx?.contact_phone || null,
      lastTouch: signal || null, lastJob: cl.job_name || cl.display_job_number || null, jobNumber: cl.display_job_number || null,
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
