import { fetchAll } from "../../lib/supabaseHelpers";
import { supabase } from "../../lib/supabase";
import { tod } from "../../lib/utils";
import { jobFormStatus } from "./lateForm";

// Field-web reads. All child tables (time_punches, job_crew, daily_log_entries,
// daily_production_reports, job_material_checks) anchor job_id on CALL_LOG.id
// (verified against prod 2026-09-02 — NOT jobs.job_id). `jobs` is the schedule
// spine and links to call_log via jobs.call_log_id. Tenant scoping is handled by
// RLS on the authenticated host client; no manual tenant filter here.

const ACTIVE_FIELD_STAGES = ["Scheduled", "In Progress", "mobilized", "in_progress"];

// Does a scheduled window overlap [from, to]? scheduled_end may be null
// ("dates TBD") — then the job counts only on its start day. PostgREST can't
// COALESCE a null end in a filter, so all date windowing is done client-side.
function spansDay(job, day) {
  return overlapsWindow(job, day, day);
}
function overlapsWindow(job, from, to) {
  if (!job.scheduled_start) return false;
  const start = job.scheduled_start;
  const end = job.scheduled_end || job.scheduled_start;
  return start <= to && end >= from;
}

// Active field-stage jobs (deleted-safe). `jobs` soft-deletes two ways — a
// deleted_at stamp AND a deleted='Yes' flag (Schedule's canonical loadJobs
// filters both); we exclude both. call_log stage embed drives the active-stage
// filter so Today/Load-Outs match the phone's job list (JobListScreen).
async function fetchActiveFieldJobs(extraSelect = "") {
  const sel =
    "job_id, job_name, job_num, call_log_id, scheduled_start, scheduled_end, deleted, call_log:call_log_id(stage, display_job_number)" +
    (extraSelect ? ", " + extraSelect : "");
  const jobs = await fetchAll("jobs", sel, {
    filters: [["is", "deleted_at", null], ["not", "scheduled_start", "is", null]],
    order: "scheduled_start",
  });
  return jobs.filter(
    (j) =>
      j.call_log_id != null &&
      j.deleted !== "Yes" &&
      ACTIVE_FIELD_STAGES.includes(j.call_log?.stage)
  );
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
  for (const c of checks) {
    const cur = checkedBy.get(c.job_id) || 0;
    checkedBy.set(c.job_id, cur + (c.checked ? 1 : 0));
  }

  return {
    jobs: inWindow.map((j) => ({
      jobPk: j.job_id, // jobs PK — feed to loadJobWithWTCs
      callLogId: j.call_log_id,
      jobName: j.job_name || j.call_log?.display_job_number || `Job ${j.job_num || j.call_log_id}`,
      jobNum: j.call_log?.display_job_number || j.job_num,
      scheduledStart: j.scheduled_start,
      loaded: checkedBy.get(j.call_log_id) || 0,
    })),
    today,
  };
}

// ── Plain reads for the four "later UI session" screens ─────────────────────
// Real data, minimal shape — polished layouts come in Chris's later UI sessions.

// Jobs: every active field-stage job (the office's full field job list).
export async function fetchFieldJobs() {
  const active = await fetchActiveFieldJobs();
  return active
    .map((j) => ({
      jobPk: j.job_id,
      callLogId: j.call_log_id,
      jobName: j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`,
      jobNum: j.call_log?.display_job_number || j.job_num,
      stage: j.call_log?.stage || null,
      scheduledStart: j.scheduled_start,
      scheduledEnd: j.scheduled_end,
    }))
    .sort((a, b) => (a.scheduledStart || "").localeCompare(b.scheduledStart || ""));
}

// Crews: crew assignments across active field jobs.
export async function fetchFieldCrews() {
  const active = await fetchActiveFieldJobs();
  const clIds = [...new Set(active.map((j) => j.call_log_id))];
  if (clIds.length === 0) return [];
  const nameByCl = new Map(
    active.map((j) => [j.call_log_id, j.job_name || j.call_log?.display_job_number || `Job ${j.call_log_id}`])
  );
  const crew = await fetchAll("job_crew", "job_id, role, team_members(name)", {
    filters: [["in", "job_id", clIds]],
  });
  return crew
    .map((c) => ({
      member: c.team_members?.name || "—",
      role: c.role || "",
      job: nameByCl.get(c.job_id) || `Job ${c.job_id}`,
    }))
    .sort((a, b) => a.member.localeCompare(b.member));
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
