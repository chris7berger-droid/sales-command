// Canonical "worked day" rule for the 6-day (Mon–Sat) schedule.
//
// The business runs Mon–Sat; Sunday and Saturday are non-working by default.
// The one exception: a weekend day IS a worked day when a crew is actually
// assigned that day (an `assignments` row exists). This is the single predicate
// that used to be copy-pasted inline in DaysModal.collectScheduledDates and
// StageJobCard.totalWorkDays — extracted here so the calendar's spanning-bar
// segmentation (lib/calendarBars.js) reads the SAME rule, not a 4th copy.
//
// `assignmentDates` = a Set of 'YYYY-MM-DD' strings for the job in question
// (null → no weekend exception applied, i.e. plain Mon–Sat).

export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Is this Date a worked day? Non-weekend always; weekend only if assigned.
export function isWorkedDay(dateObj, assignmentDates = null) {
  const dow = dateObj.getDay()
  const isWeekend = dow === 0 || dow === 6
  if (!isWeekend) return true
  return !!(assignmentDates && assignmentDates.has(ymd(dateObj)))
}

// The set of 'YYYY-MM-DD' worked days across the inclusive range [startStr,endStr].
// Returns an empty Set when either bound is missing. Bounds are sliced to the
// date portion so a timestamp suffix can't malform the Date (plain dates are
// unchanged), matching the prior inline behavior for the date strings in use.
export function workedDaySet(startStr, endStr, assignmentDates = null) {
  const set = new Set()
  if (!startStr || !endStr) return set
  const s = new Date(String(startStr).slice(0, 10) + 'T00:00:00')
  const e = new Date(String(endStr).slice(0, 10) + 'T00:00:00')
  const cur = new Date(s)
  while (cur <= e) {
    if (isWorkedDay(cur, assignmentDates)) set.add(ymd(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return set
}
