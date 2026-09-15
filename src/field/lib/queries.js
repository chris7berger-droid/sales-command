import { fetchAll } from "../../lib/supabaseHelpers";
import { supabase } from "../../lib/supabase";
import { tod } from "../../lib/utils";
import { jobFormStatus } from "./lateForm";

// Field-web reads. All child tables (time_punches, job_crew, daily_log_entries,
// daily_production_reports, job_material_checks) anchor job_id on CALL_LOG.id
// (verified against prod 2026-09-02 — NOT jobs.job_id). `jobs` is the schedule
// spine and links to call_log via jobs.call_log_id. Tenant scoping is handled by
// RLS on the authenticated host client; no manual tenant filter here.

const ACTIVE_FIELD_STAGE_KEYS = new Set([
  "scheduled",
  "in progress",
  "in_progress",
  "mobilized",
  "ongoing",
  "on hold",
  "hold",
]);

function stageKey(stage) {
  return String(stage || "").trim().toLowerCase();
}

function isoDay(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function effectiveStart(job) {
  return job?.scheduled_start || job?.start_date || null;
}

function effectiveEnd(job) {
  return job?.scheduled_end || job?.end_date || null;
}

async function loadLiveMobilizationsByJobId(jobs) {
  const out = {};
  const jobIds = [...new Set((jobs || []).map((j) => j.job_id).filter((id) => id != null))];
  if (jobIds.length === 0) return out;

  const rows = await fetchAll("job_mobilizations", "job_id, seq, start_date, end_date", {
    filters: [["in", "job_id", jobIds]],
  });
  for (const row of rows) {
    if (row.job_id == null || row.seq == null) continue;
    const map = out[row.job_id] || (out[row.job_id] = {});
    map[row.seq] = {
      start_date: row.start_date || null,
      end_date: row.end_date || null,
    };
  }
  return out;
}

function deriveFieldWindows(job, mobsByJobId) {
  const seqMap = mobsByJobId?.[job.job_id] || {};
  const mobWindows = Object.values(seqMap)
    .map((m) => {
      const start = isoDay(m.start_date) || isoDay(m.end_date);
      const end = isoDay(m.end_date) || start;
      if (!start || !end) return null;
      return { start, end };
    })
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  // If a job has live mobilization rows with dates, use those as its operational
  // windows. Otherwise, fall back to Schedule's canonical effective dates.
  const fallbackStart = isoDay(effectiveStart(job)) || isoDay(effectiveEnd(job));
  const fallbackEnd = isoDay(effectiveEnd(job)) || fallbackStart;
  const windows = mobWindows.length
    ? mobWindows
    : fallbackStart
      ? [{ start: fallbackStart, end: fallbackEnd }]
      : [];

  const starts = windows.map((w) => w.start).sort();
  const ends = windows.map((w) => w.end).sort();
  const start = starts[0] || null;
  const end = ends.length ? ends[ends.length - 1] : start;
  return { windows, start, end };
}

// Does any authoritative field window overlap [from, to]? PostgREST can't
// coalesce nullable end dates in-filter, so window checks stay client-side.
function spansDay(job, day) {
  return overlapsWindow(job, day, day);
}
function overlapsWindow(job, from, to) {
  const windows = Array.isArray(job._fieldWindows) ? job._fieldWindows : [];
  return windows.some((w) => w.start <= to && w.end >= from);
}

// Active field-stage jobs (deleted-safe). `jobs` soft-deletes two ways — a
// deleted_at stamp AND a deleted='Yes' flag (Schedule's canonical loadJobs
// filters both); we exclude both. call_log stage embed drives the active-stage
// filter so Today/Load-Outs match the phone's job list (JobListScreen).
async function fetchActiveFieldJobs(extraSelect = "") {
  const sel =
    "job_id, job_name, job_num, call_log_id, scheduled_start, scheduled_end, start_date, end_date, deleted, call_log:call_log_id(stage, display_job_number)" +
    (extraSelect ? ", " + extraSelect : "");
  const jobs = await fetchAll("jobs", sel, {
    filters: [["is", "deleted_at", null]],
    order: "scheduled_start",
  });
  const active = jobs.filter(
    (j) =>
      j.call_log_id != null &&
      j.deleted !== "Yes" &&
      ACTIVE_FIELD_STAGE_KEYS.has(stageKey(j.call_log?.stage))
  );
  if (active.length === 0) return [];

  const mobsByJobId = await loadLiveMobilizationsByJobId(active);
  return active
    .map((j) => {
      const { windows, start, end } = deriveFieldWindows(j, mobsByJobId);
      return {
        ...j,
        _fieldWindows: windows,
        _fieldStart: start,
        _fieldEnd: end,
      };
    })
    .sort((a, b) => (a._fieldStart || "").localeCompare(b._fieldStart || ""));
}

// Read this tenant's field-log thresholds from tenant_config (RLS scopes the
// select to the caller's own tenant row). Returns the lateForm threshold shape,
// or null if the row/cols aren't readable — lateForm then falls back to the
// phone's hardcodes (15min / 4hr / EOD+PRT required). Coerces numeric strings.
export async function fetchFieldThresholds() {
  const { data, error } = await supabase
    .from("tenant_config")
    .select("sod_due_minutes, mod_due_hours, eod_required, prt_required")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const out = {};
  const sod = Number(data.sod_due_minutes);
  const mod = Number(data.mod_due_hours);
  if (Number.isFinite(sod)) out.sodDueMinutes = sod;
  if (Number.isFinite(mod)) out.modDueHours = mod;
  if (typeof data.eod_required === "boolean") out.eodRequired = data.eod_required;
  if (typeof data.prt_required === "boolean") out.prtRequired = data.prt_required;
  return out; // partial ok — lateForm merges over DEFAULT_THRESHOLDS
}

// One row per active job scheduled to run today, with today's punch/log/PRT/
// load-out rollup and the ported late-form flags. If `thresholds` is omitted it
// reads them from tenant_config (phone hardcodes as fallback).
export async function fetchTodayRows({ today = tod(), thresholds, now = new Date() } = {}) {
  if (thresholds === undefined) thresholds = (await fetchFieldThresholds()) || undefined;
  const active = await fetchActiveFieldJobs("lead");
  const todayJobs = active.filter((j) => spansDay(j, today));
  if (todayJobs.length === 0) return { rows: [], today };

  const clIds = [...new Set(todayJobs.map((j) => j.call_log_id))];

  // 2) Today's child data for just those jobs.
  const [punches, logs, prts, crew, checks] = await Promise.all([
    fetchAll("time_punches", "job_id, punch_type, punch_time, punch_date, hours_regular, hours_ot", {
      filters: [["in", "job_id", clIds], ["eq", "punch_date", today]],
    }),
    fetchAll("daily_log_entries", "job_id, entry_type, created_at", {
      filters: [["in", "job_id", clIds], ["gte", "created_at", today + "T00:00:00"]],
    }),
    fetchAll("daily_production_reports", "job_id, report_date, status", {
      filters: [["in", "job_id", clIds], ["eq", "report_date", today]],
    }),
    fetchAll("job_crew", "job_id, team_member_id, team_members(name)", {
      filters: [["in", "job_id", clIds]],
    }),
    fetchAll("job_material_checks", "job_id, checked", {
      filters: [["in", "job_id", clIds]],
    }),
  ]);

  const by = (arr) => {
    const m = new Map();
    for (const r of arr) {
      const k = r.job_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const punchBy = by(punches);
  const logBy = by(logs);
  const prtBy = by(prts);
  const crewBy = by(crew);
  const checkBy = by(checks);

  const rows = todayJobs.map((j) => {
    const id = j.call_log_id;
    const jp = punchBy.get(id) || [];
    const jl = logBy.get(id) || [];
    const jprt = prtBy.get(id) || [];
    const jcrew = crewBy.get(id) || [];
    const jchecks = checkBy.get(id) || [];

    const logTypes = new Set(jl.map((e) => e.entry_type));
    const prtDone = jprt.some((r) => r.status === "submitted" || r.status === "approved");
    const forms = jobFormStatus({ punches: jp, logTypes, prtDone, now, thresholds });

    // hours_regular/hours_ot are stamped only on the clock_out row — sum those to
    // avoid double-counting if intermediate rows ever carry a value.
    const hours = jp
      .filter((p) => p.punch_type === "clock_out")
      .reduce((s, p) => s + (Number(p.hours_regular) || 0) + (Number(p.hours_ot) || 0), 0);
    const crewNames = jcrew
      .map((c) => c.team_members?.name)
      .filter(Boolean)
      .sort();
    const checkedCount = jchecks.filter((c) => c.checked).length;

    return {
      jobId: id,
      jobName: j.job_name || j.call_log?.display_job_number || `Job ${j.job_num || id}`,
      jobNum: j.call_log?.display_job_number || j.job_num,
      lead: j.lead || null,
      crew: crewNames,
      hours,
      loadout: { total: jchecks.length, checked: checkedCount },
      ...forms,
    };
  });

  return { rows, today };
}

// Load-Outs list: active field-stage jobs in the near-term window (today .. +7d),
// each openable in Schedule's LoadOutModal. Returns the jobs PK (job_id) so the
// modal door can call the canonical hydrator loadJobWithWTCs(job_id) — no drifting
// fetch ([[feedback_extend_canonical_not_twin]]).
export async function fetchLoadOutJobs({ today = tod(), windowDays = 7 } = {}) {
  const end = new Date(today + "T00:00:00");
  end.setDate(end.getDate() + windowDays);
  const endStr = end.toLocaleDateString("en-CA");

  const active = await fetchActiveFieldJobs();
  // Window client-side so TBD-end jobs (null scheduled_end) aren't dropped — a
  // server-side gte on a null column silently excludes the row.
  const inWindow = active.filter((j) => overlapsWindow(j, today, endStr));
  if (inWindow.length === 0) return { jobs: [], today };

  const clIds = [...new Set(inWindow.map((j) => j.call_log_id))];
  const checks = await fetchAll("job_material_checks", "job_id, checked", {
    filters: [["in", "job_id", clIds]],
  });
  const checkedBy = new Map();
  const totalBy = new Map();
  for (const c of checks) {
    totalBy.set(c.job_id, (totalBy.get(c.job_id) || 0) + 1);
    const cur = checkedBy.get(c.job_id) || 0;
    checkedBy.set(c.job_id, cur + (c.checked ? 1 : 0));
  }

  return {
    jobs: inWindow.map((j) => ({
      jobPk: j.job_id, // jobs PK — feed to loadJobWithWTCs
      callLogId: j.call_log_id,
      jobName: j.job_name || j.call_log?.display_job_number || `Job ${j.job_num || j.call_log_id}`,
      jobNum: j.call_log?.display_job_number || j.job_num,
      scheduledStart: j._fieldStart,
      loaded: checkedBy.get(j.call_log_id) || 0,
      total: totalBy.get(j.call_log_id) || 0,
    })),
    today,
  };
}

// ── Plain reads for the four "later UI session" screens ─────────────────────
// Real data, minimal shape — polished layouts come in Chris's later UI sessions.

// Count job_crew rows per call_log id (job_crew.job_id → call_log.id).
async function crewCountByCallLog(clIds) {
  const counts = new Map();
  if (clIds.length === 0) return counts;
  const crew = await fetchAll("job_crew", "job_id", {
    filters: [["in", "job_id", clIds]],
  });
  for (const c of crew) counts.set(c.job_id, (counts.get(c.job_id) || 0) + 1);
  return counts;
}

function fieldJobShape(j, crewCount = 0) {
  return {
    jobPk: j.job_id,
    callLogId: j.call_log_id,
    jobName: j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`,
    jobNum: j.call_log?.display_job_number || j.job_num,
    stage: j.call_log?.stage || null,
    scheduledStart: j._fieldStart,
    scheduledEnd: j._fieldEnd,
    crewCount,
  };
}

// Jobs: every active field-stage job (the office's full field job list).
export async function fetchFieldJobs() {
  const active = await fetchActiveFieldJobs();
  const clIds = [...new Set(active.map((j) => j.call_log_id))];
  const counts = await crewCountByCallLog(clIds);
  return active
    .map((j) => fieldJobShape(j, counts.get(j.call_log_id) || 0))
    .sort((a, b) => (a.scheduledStart || "").localeCompare(b.scheduledStart || ""));
}

// Crews: crew assignments across active field jobs.
// Always { assignments, jobs } — jobs[].crewCount so Missing crew is a real list.
export async function fetchFieldCrews() {
  const active = await fetchActiveFieldJobs();
  const clIds = [...new Set(active.map((j) => j.call_log_id))];
  if (clIds.length === 0) return { assignments: [], jobs: [] };
  const nameByCl = new Map(
    active.map((j) => [j.call_log_id, j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`])
  );
  const crew = await fetchAll("job_crew", "job_id, role, team_members(name)", {
    filters: [["in", "job_id", clIds]],
  });
  const counts = new Map();
  for (const c of crew) counts.set(c.job_id, (counts.get(c.job_id) || 0) + 1);
  const assignments = crew
    .map((c) => ({
      member: c.team_members?.name || "—",
      role: c.role || "",
      job: nameByCl.get(c.job_id) || `Job ${c.job_id}`,
    }))
    .sort((a, b) => a.member.localeCompare(b.member));
  const jobs = active.map((j) => fieldJobShape(j, counts.get(j.call_log_id) || 0));
  return { assignments, jobs };
}

// Time Clock: today's punches across active field jobs.
export async function fetchFieldPunches({ today = tod() } = {}) {
  const active = await fetchActiveFieldJobs();
  const clIds = [...new Set(active.map((j) => j.call_log_id))];
  if (clIds.length === 0) return { punches: [], today };
  const nameByCl = new Map(
    active.map((j) => [j.call_log_id, j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`])
  );
  const punches = await fetchAll(
    "time_punches",
    "job_id, punch_type, punch_time, employee_id, team_members:employee_id(name)",
    { filters: [["in", "job_id", clIds], ["eq", "punch_date", today]] }
  );
  return {
    today,
    punches: punches
      .map((p) => ({
        member: p.team_members?.name || "—",
        job: nameByCl.get(p.job_id) || `Job ${p.job_id}`,
        type: p.punch_type,
        time: p.punch_time,
      }))
      .sort((a, b) => (a.time || "").localeCompare(b.time || "")),
  };
}

// Daily Logs: recent SOD/MOD/EOD entries across active field jobs (last `days`).
export async function fetchFieldLogs({ today = tod(), days = 7 } = {}) {
  const from = new Date(today + "T00:00:00");
  from.setDate(from.getDate() - days);
  const fromStr = from.toLocaleDateString("en-CA");

  const active = await fetchActiveFieldJobs();
  const clIds = [...new Set(active.map((j) => j.call_log_id))];
  if (clIds.length === 0) return [];
  const nameByCl = new Map(
    active.map((j) => [j.call_log_id, j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`])
  );
  const logs = await fetchAll("daily_log_entries", "job_id, entry_type, notes, created_at", {
    filters: [["in", "job_id", clIds], ["gte", "created_at", fromStr + "T00:00:00"]],
  });
  return logs
    .map((e) => ({
      job: nameByCl.get(e.job_id) || `Job ${e.job_id}`,
      type: e.entry_type,
      notes: e.notes || "",
      at: e.created_at,
    }))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
