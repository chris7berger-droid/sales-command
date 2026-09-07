import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { loadJobs, loadMobilizationsByJobId, wkDates } from '../lib/queries'
import { getMonday } from '../lib/weeks'
import { pickAllocField } from '../lib/allocations'
import { getJobStatus } from '../lib/jobStatus'
import { jobBlocks, buildCalendarBars } from '../lib/calendarBars'
import CalendarBar from '../components/CalendarBar'
import CalendarDayPane from '../components/CalendarDayPane'
import CalendarJobPane from '../components/CalendarJobPane'

/* ---------- helpers ---------- */

// Readability palette for NON-PW jobs. Purple is deliberately absent — reserved
// for prevailing-wage jobs (PW_COLOR), mirroring the crew scheduler so purple
// always means PW across the app. 11 hues with NO two in the same family (one
// blue only) and ordered to alternate across the wheel, so consecutive jobs — and
// any two co-visible in a week — read as clearly different. A job keeps ONE color
// across all its spanning days (color is assigned per job, by sorted job order).
const JOB_COLORS = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#ea580c', // orange
  '#db2777', // pink
  '#ca8a04', // gold
  '#0d9488', // teal
  '#b45309', // brown
  '#4d7c0f', // olive
  '#be185d', // magenta
  '#475569', // slate
]
// Prevailing-wage color — same token the crew scheduler uses (--pw / #6d28d9).
const PW_COLOR = '#6d28d9'

function jCol(idx) {
  return JOB_COLORS[idx % JOB_COLORS.length]
}

function isPW(job) {
  return job.prevailing_wage === 'Yes' || job.prevailing_wage === 'true' || job.prevailing_wage === true
}

function fmtD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(s) {
  return new Date(s + 'T00:00:00')
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const STATUS_FILTER_OPTIONS = ['Scheduled', 'In Progress', 'On Hold', 'Complete', 'Ongoing']

/* Build the 6-row (42-cell) month grid, Sun–Sat. */
function buildGrid(year, month) {
  const first = new Date(year, month, 1)
  const startDay = first.getDay() // 0=Sun
  const gridStart = new Date(year, month, 1 - startDay)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push(d)
  }
  return cells
}

/* ---------- layout constants ---------- */
const CELL_HEADER = 20   // day-number strip at the top of each cell
const LANE_H = 18        // one bar lane
const MONTH_MAX_LANES = 4
const WEEK_MAX_LANES = 10
// Light grid lines — the token --border is near-black (#1c1814), intentionally
// heavy for buttons/filters, but too heavy as calendar gridlines. Scope a soft
// line color to this grid only.
const LINE = 'rgba(28,24,20,0.12)'
const LINE_OUTER = 'rgba(28,24,20,0.18)'

/* ---------- styles (schedule module CSS-variable convention) ---------- */

const styles = {
  // Gap under the capacity band is closed by trimming .app-main's top padding for
  // this screen (see App.css .app-main:has(.cal-wrapper)) — NOT a negative margin,
  // which sheared the toolbar tops against .app-main's overflow:hidden.
  wrapper: { padding: '0 24px 16px' },
  // D3 three-column: calendar | day pane | job pane. Flex lives on THIS row only —
  // never on wrapper (that would sweep the toolbar + legend into the flex too).
  layoutRow: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  calendarColumn: { flex: 1, minWidth: 0 },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
    fontFamily: 'var(--font-heading)', flexWrap: 'wrap',
  },
  navBtn: {
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 13px',
    border: `1px solid ${LINE_OUTER}`, borderRadius: 4,
    background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer',
  },
  monthLabel: {
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 22,
    textTransform: 'uppercase', letterSpacing: 1, marginLeft: 8, marginRight: 8,
    color: 'var(--text-secondary)',
  },
  toggleWrap: {
    display: 'inline-flex', border: `1px solid ${LINE_OUTER}`, borderRadius: 4, overflow: 'hidden',
  },
  toggleBtn: (active) => ({
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.5, padding: '6px 15px',
    border: 'none', cursor: 'pointer',
    background: active ? 'var(--header-dark)' : 'var(--bg-card)',
    color: active ? 'var(--white)' : 'var(--text-secondary)',
  }),
  spacer: { flex: 1 },
  filter: {
    fontFamily: 'var(--font-body)', fontSize: 12, padding: '6px 9px',
    border: `1px solid ${LINE_OUTER}`, borderRadius: 4,
    background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer',
  },
  filterDisabled: {
    fontFamily: 'var(--font-body)', fontSize: 12, padding: '6px 9px',
    border: `1px solid ${LINE_OUTER}`, borderRadius: 4,
    background: 'var(--bg-muted, var(--bg-card))', color: 'var(--text-light)', cursor: 'not-allowed',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    border: `1px solid ${LINE_OUTER}`, borderRadius: 4, overflow: 'hidden',
    background: LINE, gap: 1,
  },
  dayHeader: {
    background: 'var(--bg)', color: 'var(--text-light)',
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', padding: '7px 0',
  },
  weekRow: { position: 'relative', display: 'grid', gap: 1, background: LINE },
  cell: {
    background: 'var(--bg-card)', padding: 4, position: 'relative',
    display: 'flex', flexDirection: 'column',
  },
  cellOutside: { opacity: 0.4 },
  cellToday: { background: 'rgba(48,207,172,0.10)' },
  cellSelected: { boxShadow: 'inset 0 0 0 2px #30cfac' },
  // Top strip of each cell: the "+N more" overflow chip (left) + day number
  // (right). Keeping the chip up here means it never gets clipped and frees a
  // full bar lane below.
  dayHead: { display: 'flex', alignItems: 'center', gap: 6, height: CELL_HEADER - 4 },
  dayNum: {
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
    color: 'var(--text-secondary)', marginLeft: 'auto',
  },
  moreChip: {
    fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
    color: '#30cfac', background: 'var(--header-dark)', borderRadius: 4,
    padding: '1px 6px', cursor: 'pointer', whiteSpace: 'nowrap', pointerEvents: 'auto',
  },
  barsLayer: {
    position: 'absolute', top: CELL_HEADER, left: 0, right: 0, bottom: 2,
    display: 'grid', gridAutoRows: LANE_H, columnGap: 1, rowGap: 1,
    pointerEvents: 'none',
  },
  emptyNote: {
    marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 12,
    fontStyle: 'italic', color: 'var(--text-light)',
  },
  loading: {
    textAlign: 'center', padding: 40, fontFamily: 'var(--font-heading)', fontSize: 14,
    color: 'var(--text-light)', textTransform: 'uppercase', letterSpacing: 1,
  },
}

/* ---------- component ---------- */

export default function Calendar() {
  const today = new Date()

  // --- state (all useState BEFORE any useEffect — TDZ) ---
  const [view, setView] = useState('month')          // 'month' | 'week'
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [weekStart, setWeekStart] = useState(fmtD(getMonday(today)))  // ymd of a Monday
  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [allocsByJobId, setAllocsByJobId] = useState({})  // live allocations per job (B87)
  const [loading, setLoading] = useState(true)
  const [filterCrew, setFilterCrew] = useState('')       // '' = All Crews
  const [filterStatus, setFilterStatus] = useState('')   // '' = All Statuses
  const [selectedDate, setSelectedDate] = useState(null)   // ymd — day pane hook (Chunk B)
  const [selectedJobId, setSelectedJobId] = useState(null) // job pane hook (Chunk C)
  // Available height for the week-rows grid so it fills the viewport exactly —
  // populated weeks grow to absorb slack (no dead space at the bottom) and the
  // page stops overflowing into a stray scroll. Measured from the grid's top.
  const weeksRef = useRef(null)
  const [gridH, setGridH] = useState(null)
  // "Show all": lift the per-day bar cap so every job renders; weeks then grow to
  // their full job count and the calendar scrolls vertically (vs the default
  // compact mode, which fills the viewport and caps overflow into "+N more").
  const [showAll, setShowAll] = useState(false)

  // Assignments fetch range = union of the month grid and the focused week
  // (B1). Keyed on YYYY-MM-DD strings, never a Date object.
  const range = useMemo(() => {
    const cells = buildGrid(year, month)
    const gStart = fmtD(cells[0])
    const gEnd = fmtD(cells[cells.length - 1])
    const monday = parseYmd(weekStart)
    const sun = new Date(monday); sun.setDate(monday.getDate() - 1)
    const sat = new Date(monday); sat.setDate(monday.getDate() + 5)
    const wStart = fmtD(sun)   // include Sunday so the weekend rule can see it
    const wEnd = fmtD(sat)
    return {
      start: gStart < wStart ? gStart : wStart,
      end: gEnd > wEnd ? gEnd : wEnd,
    }
  }, [year, month, weekStart])

  // --- data load (the only effect; after the useState block) ---
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: allJobs, error: jobErr } = await loadJobs()
      if (jobErr) console.error('jobs fetch error', jobErr)
      const jobData = (allJobs || []).filter(j => j.scheduled_start || j.start_date)

      // B1: fetch over the union of the month grid + focused week (range memo).
      // Ordering/pagination of this query is B92 — deliberately out of scope here
      // (window stays ~monthly; bar aggregation is order-independent).
      const { data: assignData, error: assignErr } = await supabase
        .from('assignments')
        .select('job_id, crew_name, date')
        .gte('date', range.start)
        .lte('date', range.end)
      if (assignErr) console.error('assignments fetch error', assignErr)

      // Live allocations so a job also lands on its go-back block's dates (B87).
      const allocs = await loadMobilizationsByJobId(jobData || [], { liveOnly: true })

      if (!cancelled) {
        setJobs(jobData || [])
        setAssignments(assignData || [])
        setAllocsByJobId(allocs || {})
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [range.start, range.end])

  // Size the week-rows grid to the space left under the toolbar, down to the
  // bottom of the viewport. Recomputes on view/period change and window resize.
  useEffect(() => {
    function measure() {
      const el = weeksRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      setGridH(Math.max(240, Math.round(window.innerHeight - top - 16)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [view, loading, month, year, weekStart])

  // --- derived data ---

  // jobId -> alternating color index (stable order by job_num)
  const jobColorMap = useMemo(() => {
    const sorted = [...jobs].sort((a, b) =>
      String(a.job_num || '').localeCompare(String(b.job_num || ''), undefined, { numeric: true }))
    const map = {}
    sorted.forEach((j, i) => { map[j.job_id] = i })
    return map
  }, [jobs])

  // "jobId|YYYY-MM-DD" -> crew count
  const crewCountMap = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      const key = `${a.job_id}|${a.date}`
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [assignments])

  // jobId -> Set of YYYY-MM-DD it has any crew assigned (weekend-exception input)
  const assignedDaysByJob = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      (map[String(a.job_id)] ||= new Set()).add(a.date)
    }
    return map
  }, [assignments])

  // jobId -> dated allocation blocks (own block + go-backs, alloc preserved)
  const blocksByJobId = useMemo(() => {
    const m = {}
    for (const j of jobs) m[String(j.job_id)] = jobBlocks(j, allocsByJobId[j.job_id])
    return m
  }, [jobs, allocsByJobId])

  // jobId -> Set of crew names on it (for the All Crews filter)
  const crewNamesByJob = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!a.crew_name) continue
      (map[String(a.job_id)] ||= new Set()).add(a.crew_name)
    }
    return map
  }, [assignments])

  // Crew filter options = crews on the board + job leads, sorted
  const crewOptions = useMemo(() => {
    const set = new Set()
    for (const a of assignments) if (a.crew_name) set.add(a.crew_name)
    for (const j of jobs) if (j.lead) set.add(j.lead)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [assignments, jobs])

  function getCrewCountByYmd(jobId, ds) {
    return crewCountMap[`${jobId}|${ds}`] || 0
  }

  // Apply crew + status filters
  const filteredJobs = useMemo(() => {
    return jobs.filter(j => {
      if (filterStatus && getJobStatus(j) !== filterStatus) return false
      if (filterCrew) {
        const names = crewNamesByJob[String(j.job_id)]
        const hit = (names && names.has(filterCrew)) || j.lead === filterCrew
        if (!hit) return false
      }
      return true
    })
  }, [jobs, filterStatus, filterCrew, crewNamesByJob])

  // Month rows (6×7) — memoized independent of week nav
  const monthRows = useMemo(() => {
    const cells = buildGrid(year, month)
    const rows = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [year, month])

  // Week columns: Mon–Sat, plus a Sunday column only when that week has Sunday
  // work (Month/Week Sunday consistency — finding D).
  const weekCols = useMemo(() => {
    const monday = parseYmd(weekStart)
    const cols = []
    // Sunday column only when this week has Sunday work (Month/Week consistency).
    const sunday = new Date(monday); sunday.setDate(monday.getDate() - 1)
    const sundayWorked = filteredJobs.some(j => getCrewCountByYmd(j.job_id, fmtD(sunday)) > 0)
    if (sundayWorked) cols.push(sunday)
    // Mon–Sat via the canonical wkDates (queries.js) — no re-derived week math.
    for (const ds of wkDates(monday)) cols.push(parseYmd(ds))
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, filteredJobs, crewCountMap])

  const rows = useMemo(() => (view === 'month' ? monthRows : [weekCols]), [view, monthRows, weekCols])
  const maxLanes = showAll ? 999 : (view === 'month' ? MONTH_MAX_LANES : WEEK_MAX_LANES)
  const nCols = view === 'month' ? 7 : weekCols.length
  // Week has one full-width row and lots of vertical room, so its bars run taller
  // with bigger text; month bars are more compact.
  const laneH = view === 'week' ? 36 : 30
  const barH = laneH - 6
  const barFont = view === 'week' ? 14 : 12

  const bars = useMemo(
    () => buildCalendarBars({ rows, jobs: filteredJobs, blocksByJobId, assignedDaysByJob, maxLanes }),
    [rows, filteredJobs, blocksByJobId, assignedDaysByJob, maxLanes])

  function getJobColor(job) {
    if (isPW(job)) return PW_COLOR   // PW always purple (reserved), reads first
    if (job.color) return job.color
    const idx = jobColorMap[job.job_id]
    return idx !== undefined ? jCol(idx) : '#7f8c8d'
  }

  // Resolve the label pieces for a bar segment (crew via crew_needed else the
  // block start-day assignment count; lead via the block-then-job fallback).
  function barMeta(seg) {
    const crewNeeded = pickAllocField(seg.alloc, seg.job, 'crew_needed')
    let crewCount = (crewNeeded != null && crewNeeded !== '' && !isNaN(crewNeeded)) ? Number(crewNeeded) : 0
    if (!crewCount) {
      const blockStart = seg.alloc
        ? String(seg.alloc.start_date || '').slice(0, 10)
        : String(seg.job.scheduled_start || seg.job.start_date || '').slice(0, 10)
      crewCount = getCrewCountByYmd(seg.jobId, blockStart)
    }
    const lead = pickAllocField(seg.alloc, seg.job, 'lead') || ''
    return { crewCount, lead }
  }

  // --- selection reset (E1 + finding K): any nav / toggle / filter change
  // clears an open selection so a filtered-out job can't leave a stale pane. ---
  function resetSelection() {
    setSelectedDate(null)
    setSelectedJobId(null)
  }

  function changeView(v) {
    if (v === view) return
    if (v === 'week') {
      // Align the week to the month being viewed (today's week if it's in view).
      const base = (today.getFullYear() === year && today.getMonth() === month)
        ? today : new Date(year, month, 1)
      setWeekStart(fmtD(getMonday(base)))
    }
    resetSelection()
    setView(v)
  }

  function goPrev() {
    resetSelection()
    if (view === 'month') {
      if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1)
    } else {
      const d = parseYmd(weekStart); d.setDate(d.getDate() - 7); setWeekStart(fmtD(d))
    }
  }

  function goNext() {
    resetSelection()
    if (view === 'month') {
      if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1)
    } else {
      const d = parseYmd(weekStart); d.setDate(d.getDate() + 7); setWeekStart(fmtD(d))
    }
  }

  function goToday() {
    resetSelection()
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setWeekStart(fmtD(getMonday(today)))
  }

  function onFilterCrew(v) { resetSelection(); setFilterCrew(v) }
  function onFilterStatus(v) { resetSelection(); setFilterStatus(v) }

  function selectDay(ds, e) {
    if (e) e.stopPropagation()
    setSelectedDate(cur => (cur === ds ? null : ds))
  }
  // "+N more" must FORCE-OPEN the day pane (round-3 E) — never toggle it shut when
  // clicked on the already-selected day.
  function openDay(ds, e) {
    if (e) e.stopPropagation()
    setSelectedDate(ds)
  }
  function selectJob(jobId) {
    setSelectedJobId(cur => (cur === jobId ? null : jobId))
  }

  const periodLabel = view === 'month'
    ? `${MONTH_NAMES[month]} ${year}`
    : (() => {
        const first = weekCols[0], last = weekCols[weekCols.length - 1]
        const sameMonth = first.getMonth() === last.getMonth()
        return sameMonth
          ? `${MONTH_ABBR[first.getMonth()]} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
          : `${MONTH_ABBR[first.getMonth()]} ${first.getDate()} – ${MONTH_ABBR[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`
      })()

  if (loading) {
    return <div style={styles.loading}>Loading calendar...</div>
  }

  const gridTemplate = `repeat(${nCols}, 1fr)`
  const hasAnyBar = bars.segmentsByRow.some(r => r.length > 0)

  return (
    <div className="cal-wrapper" style={styles.wrapper}>
      {/* Toolbar */}
      <div className="cal-toolbar" style={styles.toolbar}>
        <button style={styles.navBtn} onClick={goPrev}>Prev</button>
        <button style={styles.navBtn} onClick={goToday}>Today</button>
        <button style={styles.navBtn} onClick={goNext}>Next</button>
        <span style={styles.monthLabel}>{periodLabel}</span>

        <div style={styles.toggleWrap}>
          <button style={styles.toggleBtn(view === 'month')} onClick={() => changeView('month')}>Month</button>
          <button style={styles.toggleBtn(view === 'week')} onClick={() => changeView('week')}>Week</button>
        </div>

        <button
          style={{ ...styles.navBtn, ...(showAll ? { background: 'var(--header-dark)', color: 'var(--white)', borderColor: 'var(--header-dark)' } : {}) }}
          onClick={() => setShowAll(s => !s)}
          title={showAll ? 'Cap busy days and fit to screen' : 'Show every job; the calendar scrolls'}
        >
          Show all
        </button>

        <span style={styles.spacer} />

        <select
          style={styles.filter}
          value={filterCrew}
          onChange={e => onFilterCrew(e.target.value)}
          onClick={e => e.stopPropagation()}
        >
          <option value="">All Crews</option>
          {crewOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Work-type filter needs per-job WTC data not loaded this build (Chunk C). */}
        <select style={styles.filterDisabled} disabled value="" title="Coming soon">
          <option value="">All Work Types — Coming soon</option>
        </select>

        <select
          style={styles.filter}
          value={filterStatus}
          onChange={e => onFilterStatus(e.target.value)}
          onClick={e => e.stopPropagation()}
        >
          <option value="">All Statuses</option>
          {STATUS_FILTER_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Three-column row: calendar | day pane | job pane */}
      <div style={styles.layoutRow}>
        {/* Calendar column wraps the day-name header + week rows together so the
            two sibling grids share gridTemplate and the panes sit beside them. */}
        <div style={styles.calendarColumn}>
      {/* Day-name header — pinned while scrolling in Show-all mode so the columns
          stay labeled as tall weeks scroll past. */}
      <div style={{ ...styles.grid, gridTemplateColumns: gridTemplate, marginBottom: 1, ...(showAll ? { position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)' } : {}) }}>
        {(view === 'month' ? DAY_NAMES : weekCols.map(d => `${DAY_NAMES[d.getDay()]} ${d.getDate()}`)).map((dn, i) => (
          <div key={i} style={styles.dayHeader}>{dn}</div>
        ))}
      </div>

      {/* Week rows. Compact: flex column sized to the viewport; rows grow by lane
          count so busy weeks get the space and empty weeks collapse (no bottom
          gap, no page overflow). Show-all: rows take their full content height and
          the page scrolls through them. */}
      <div ref={weeksRef} style={{ ...styles.grid, display: 'flex', flexDirection: 'column', gap: 1,
        height: showAll ? 'auto' : (gridH || 'auto'),
        overflowY: showAll ? 'visible' : 'auto', overflowX: 'hidden' }}>
        {rows.map((week, r) => {
          const rowSegs = bars.segmentsByRow[r] || []
          const lanesUsed = rowSegs.reduce((m, s) => Math.max(m, s.lane + 1), 0)
          const minH = CELL_HEADER + (lanesUsed ? lanesUsed * laneH + 6 : 8)
          const rowFlex = (!showAll && lanesUsed) ? { flex: `${lanesUsed} 1 0` } : { flex: '0 0 auto' }
          return (
            <div key={r} style={{ ...styles.weekRow, gridTemplateColumns: gridTemplate, minHeight: minH, ...rowFlex }}>
              {/* Day cells */}
              {week.map((d, c) => {
                const ds = fmtD(d)
                const overflow = bars.overflowByYmd[ds] || 0
                const isOutside = view === 'month' && d.getMonth() !== month
                const isToday = sameDay(d, today)
                const isSel = selectedDate === ds
                const cellStyle = {
                  ...styles.cell,
                  ...(isOutside ? styles.cellOutside : {}),
                  ...(isToday ? styles.cellToday : {}),
                  ...(isSel ? styles.cellSelected : {}),
                }
                return (
                  <div key={c} style={cellStyle} onClick={() => selectDay(ds)}>
                    <div style={styles.dayHead}>
                      {overflow > 0 && (
                        <span style={styles.moreChip} onClick={e => openDay(ds, e)}>+{overflow} more</span>
                      )}
                      <span style={styles.dayNum}>{d.getDate()}</span>
                    </div>
                  </div>
                )
              })}

              {/* Spanning-bar overlay */}
              <div style={{ ...styles.barsLayer, gridTemplateColumns: gridTemplate, gridAutoRows: laneH }}>
                {rowSegs.map((seg, i) => {
                  const { crewCount, lead } = barMeta(seg)
                  return (
                    <CalendarBar
                      key={`${seg.jobId}-${seg.alloc?.seq ?? 'own'}-${seg.startYmd}-${i}`}
                      gridColumn={`${seg.startCol + 1} / ${seg.endCol + 2}`}
                      gridRow={seg.lane + 1}
                      color={getJobColor(seg.job)}
                      jobNum={seg.job.job_num}
                      jobName={seg.job.job_name}
                      crewCount={crewCount}
                      lead={lead}
                      isPW={isPW(seg.job)}
                      selected={selectedJobId === seg.jobId}
                      onSelect={() => selectJob(seg.jobId)}
                      height={barH}
                      fontSize={barFont}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
        </div>{/* /calendarColumn */}

        {/* Day pane (Chunk B) — renders off selectedDate; derives nothing */}
        {selectedDate && (
          <CalendarDayPane
            date={selectedDate}
            members={bars.membersByYmd[selectedDate] || []}
            selectedJobId={selectedJobId}
            getJobColor={getJobColor}
            getJobStatus={getJobStatus}
            barMeta={barMeta}
            onSelectJob={selectJob}
            onClose={() => setSelectedDate(null)}
          />
        )}

        {/* Job pane (Chunk C) — renders off selectedJobId. Render-guard on the grid
            index (round-3 ADJ-2): a job no longer in the drawn set null-renders,
            rather than adding a second reset path. */}
        {selectedJobId && bars.workedDaysByJob[String(selectedJobId)] && (
          <CalendarJobPane
            job={jobs.find(j => String(j.job_id) === String(selectedJobId)) || null}
            workedDaySet={bars.workedDaysByJob[String(selectedJobId)]}
            getJobStatus={getJobStatus}
            onClose={() => setSelectedJobId(null)}
          />
        )}
      </div>{/* /layoutRow */}

      {!hasAnyBar && (
        <div style={styles.emptyNote}>
          No crew scheduled this {view === 'week' ? 'week' : 'month'}
          {(filterCrew || filterStatus) ? ' for the current filters' : ''}.
        </div>
      )}
    </div>
  )
}
