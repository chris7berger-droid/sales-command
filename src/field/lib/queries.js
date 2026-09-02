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

// Does a scheduled window span `day`? scheduled_end may be null ("dates TBD") —
// then the job counts only on its start day.
function spansDay(job, day) {
  if (!job.scheduled_start) return false;
  if (job.scheduled_start > day) return false;
  const end = job.scheduled_end || job.scheduled_start;
  return end >= day;
}

// One row per job scheduled to run today, with today's punch/log/PRT/load-out
// rollup and the ported late-form flags.
export async function fetchTodayRows({ today = tod(), thresholds, now = new Date() } = {}) {
  // 1) Jobs scheduled to span today (small set — fetch active, filter client-side
  //    because PostgREST can't COALESCE a null scheduled_end in a filter).
  const jobs = await fetchAll(
    "jobs",
    "job_id, job_name, job_num, call_log_id, scheduled_start, scheduled_end, status, lead",
    { filters: [["is", "deleted_at", null], ["not", "scheduled_start", "is", null]], order: "job_name" }
  );
  const todayJobs = jobs.filter((j) => spansDay(j, today) && j.call_log_id != null);
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

    const hours = jp.reduce((s, p) => s + (Number(p.hours_regular) || 0) + (Number(p.hours_ot) || 0), 0);
    const crewNames = jcrew
      .map((c) => c.team_members?.name)
      .filter(Boolean)
      .sort();
    const checkedCount = jchecks.filter((c) => c.checked).length;

    return {
      jobId: id,
      jobName: j.job_name || `Job ${j.job_num || id}`,
      jobNum: j.job_num,
      lead: j.lead || null,
      crew: crewNames,
      hours,
      loadout: { total: jchecks.length, checked: checkedCount },
      ...forms,
    };
  });

  return { rows, today };
}
