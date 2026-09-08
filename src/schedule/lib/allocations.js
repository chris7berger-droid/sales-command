// Allocation-aware date ranges for the schedule board (B87).
//
// The model: a job sits on the crew board across one or more ALLOCATIONS — dated
// blocks of days a crew is on it. Block #1 is the job's OWN start/end (no
// job_mobilizations row required); every added block (a go-back / return trip)
// is a live job_mobilizations row carrying its own dates. Before this, the board
// picked jobs by the job's own start/end only, so an added block never rendered.
//
// These helpers replace the old per-view effStart/effEnd + jobOverlapsWeek +
// jobInRange, which each assumed a single range. Give them the job plus its live
// allocations and they consider every block. With NO allocations the behavior is
// identical to the old single-range logic, so existing jobs render unchanged.

// A YYYY-MM-DD string, tolerant of a timestamp suffix; '' when absent.
function dstr(v) { return v ? String(v).split('T')[0] : '' }

// The job's own first block (scheduled_* wins over plain start/end, matching the
// prior effStart/effEnd). Returns null when the job carries no dates of its own.
export function jobOwnRange(j) {
  const s = dstr(j.scheduled_start || j.start_date)
  const e = dstr(j.scheduled_end || j.end_date)
  if (!s && !e) return null
  return { start: s || null, end: e || null }
}

// Every dated block for a job = its own first block + each live allocation
// (job_mobilizations row) that carries a start or end. `allocsForJob` is the
// per-job value from loadMobilizationsByJobId(..., { liveOnly: true }) — a
// { [seq]: {start_date, end_date, ...} } map, an array of those, or null.
export function jobRanges(j, allocsForJob) {
  const ranges = []
  const own = jobOwnRange(j)
  if (own) ranges.push(own)
  const list = Array.isArray(allocsForJob)
    ? allocsForJob
    : (allocsForJob ? Object.values(allocsForJob) : [])
  for (const a of list) {
    if (!a) continue
    const s = dstr(a.start_date)
    const e = dstr(a.end_date)
    if (!s && !e) continue          // an undated block schedules nothing
    ranges.push({ start: s || null, end: e || null })
  }
  return ranges
}

// Does any of the job's blocks overlap the week [wsStr, weStr]?
// A job with NO dated block at all stays visible (shown as unscheduled), exactly
// as the old jobOverlapsWeek returned true when both dates were absent.
export function overlapsWeek(ranges, wsStr, weStr) {
  if (!ranges.length) return true
  return ranges.some(r => {
    const start = r.start || '0000-01-01'
    const end = r.end || '9999-12-31'
    return start <= weStr && end >= wsStr
  })
}

// Is the job active on day `ds` in any of its blocks? A job with no dated block
// is active on no specific day (old jobInRange returned false with no dates).
export function inRange(ranges, ds) {
  if (!ranges.length) return false
  return ranges.some(r => {
    if (r.start && ds < r.start) return false
    if (r.end && ds > r.end) return false
    return true
  })
}

// Legacy first-match lookup (B87), retained for compatibility. Staffing views and
// the weekly printout now use staffingForDay: one week can contain several trips.
// `allocsForJob` is the per-job value from loadMobilizationsByJobId — a
// { [seq]: {...} } map, an array of those, or null.
export function allocForWeek(allocsForJob, wsStr, weStr) {
  const list = Array.isArray(allocsForJob)
    ? allocsForJob
    : (allocsForJob ? Object.values(allocsForJob) : [])
  return list.find(a => {
    if (!a) return false
    const s = a.start_date ? String(a.start_date).split('T')[0] : ''
    const e = a.end_date ? String(a.end_date).split('T')[0] : ''
    if (!s && !e) return false
    return (s || '0000-01-01') <= weStr && (e || '9999-12-31') >= wsStr
  }) || null
}

// Effective value of an operational field (crew_needed/lead/vehicle/…) for the
// week in view: the allocation's own value when it's meaningfully set, else the
// job's own. One consistent merge rule for all surfaces — replaces the three
// slightly different inline checks (null-vs-falsy) the copies had drifted into.
export function pickAllocField(alloc, job, field) {
  const v = alloc ? alloc[field] : undefined
  if (v !== null && v !== undefined && v !== '') return v
  return job ? job[field] : undefined
}

// Null means unknown; zero is an explicit instruction that no crew is needed.
export function crewRequirement(value) {
  if (value == null || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

// Staffing belongs to a DATE, not the first allocation found in its week.
// Multiple overlapping trips may share people: do not invent a summed target or
// silently borrow the first trip's requirement. Ask the scheduler to check it.
export function staffingForDay(job, allocsForJob, date) {
  const list = Array.isArray(allocsForJob) ? allocsForJob : Object.values(allocsForJob || {})
  const allocations = list.filter(a => a && (a.start_date || a.end_date) &&
    (!a.start_date || dstr(a.start_date) <= date) && (!a.end_date || dstr(a.end_date) >= date))
  const ranges = jobRanges(job, allocsForJob)
  const active = !ranges.length || inRange(ranges, date)
  const ambiguous = allocations.length > 1
  const sources = allocations.length ? allocations : [null]
  const values = field => [...new Set(sources.map(a => pickAllocField(a, job, field)).filter(v => v != null && v !== ''))]
  return {
    date, active, ambiguous,
    allocation: allocations.length === 1 ? allocations[0] : null,
    needed: ambiguous ? null : crewRequirement(pickAllocField(allocations[0], job, 'crew_needed')),
    leads: active ? values('lead') : [],
    vehicles: active ? values('vehicle') : [],
  }
}

export function staffingSummary(days) {
  const active = days.filter(day => day.active)
  const requirements = [...new Set(active.map(day => day.needed))]
  const label = requirements.length > 1 ? 'varies' : String(requirements[0] ?? '?')
  const leads = [...new Set(active.flatMap(day => day.leads))]
  const vehicles = [...new Set(active.flatMap(day => day.vehicles))]
  const detailsVary = new Set(active.map(day => JSON.stringify([day.needed, day.leads, day.vehicles]))).size > 1
  return { label, leads, vehicles, detailsVary }
}
