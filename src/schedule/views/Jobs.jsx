import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  loadJobs, loadAllRows, loadPRTsForCallLogIds, isReady, loadBillingWorklist,
  loadMobilizationsByJobId, computeHomeDashboard, wkDates, getJobMultiWeekAlert, hasFieldSow,
} from '../lib/queries'
import StagedCardList from '../components/StagedCardList'
import AllJobsList from '../components/AllJobsList'
import OnHoldCardList from '../components/OnHoldCardList'
import HomeCapacityStrip from '../components/HomeCapacityStrip'
import { NeedsAttention, NextUp, AtAGlance } from '../components/HomePanels'
import { getJobStatus } from '../lib/jobStatus'

// New Jobs (reskin chunk 1) — the working surface. Absorbs today's Home
// working-list band (capacity strip + panels) and every old-Jobs function:
// stage tabs (always visible, no picker drill-in), a Go-Backs + prep-readiness
// signals strip (ported from the retired JobsPicker), an Actions menu with the
// picker's cross-screen jumps, the Recovery Bin, the ?tab= redirect map, and
// realtime. Each row still expands to the full StageJobCard + all its modals.

const VALID_TABS = ['staged', 'scheduled', 'active', 'on-hold', 'complete', 'all']
// Old/removed tab slugs redirect to their canonical destination — legacy
// bookmarks only (internal links emit `all`/`worklist`). MUST stay verbatim
// [R1:F1 / R2:REG-1]: `ready`/`schedule` redirect OUT to the crew board, NOT to
// a Ready stage — so the Ready stage tab is driven by `scheduled`, never `ready`.
const TAB_REDIRECTS = {
  pipeline: '/schedule/jobs?tab=scheduled',
  ready: '/schedule/schedule',
  schedule: '/schedule/schedule',
  billing: '/schedule/billing?tab=worklist',
  'ready-to-bill': '/schedule/billing?tab=worklist',
}

const STAGE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'staged', label: 'Staged' },
  { key: 'scheduled', label: 'Ready' },
  { key: 'active', label: 'Active' },
  { key: 'on-hold', label: 'On Hold' },
  { key: 'complete', label: 'Completed' },
]

// Cross-screen jumps folded out of the retired JobsPicker into the Actions menu
// [R1:A3 / R2:D]. Forecast/Budget now live inside Finance/Billing (?tab=).
const ACTIONS = [
  { label: 'Crew Schedule', to: '/schedule/schedule' },
  { label: 'Finance / Billing', to: '/schedule/billing?tab=worklist' },
  { label: '90-Day Forecast', to: '/schedule/billing?tab=forecast' },
  { label: 'Budget', to: '/schedule/billing?tab=budget' },
  { label: 'Production Rate', to: '/schedule/production-rate' },
  { label: 'Daily Logs', to: '/schedule/daily' },
]

/* ── helpers ─────────────────────────────────────────────────────── */

function fmtD(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function getMonday(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function getQuarterStart(d) {
  const dt = new Date(d)
  const q = Math.floor(dt.getMonth() / 3) * 3
  return new Date(dt.getFullYear(), q, 1)
}

function getQuarterEnd(d) {
  const dt = new Date(d)
  const q = Math.floor(dt.getMonth() / 3) * 3 + 2
  return new Date(dt.getFullYear(), q + 1, 0)
}

function effectiveStart(j) { return j.scheduled_start || j.start_date || null }
function effectiveEnd(j) { return j.scheduled_end || j.end_date || null }

function isThisWeek(dateStr, today) {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  const mon = getMonday(today)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  return d >= mon && d <= sun
}

function daysBetween(dateStr, refDate) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  const r = new Date(refDate)
  r.setHours(0, 0, 0, 0)
  return Math.ceil((d - r) / (1000 * 60 * 60 * 24))
}

function urgencyScore(job, today) {
  const status = getJobStatus(job)
  let score = 0
  const startDate = effectiveStart(job)
  const startDaysFromNow = startDate ? daysBetween(startDate, today) : null
  if (status === 'Scheduled' && (startDaysFromNow === null || startDaysFromNow > 14)) {
    score = -2500
  } else if (status === 'Scheduled' || status === 'In Progress' || status === 'Ongoing') {
    score = 0
  } else if (status === 'On Hold') {
    score = 10000
  } else {
    score = 20000
  }

  const endDate = effectiveEnd(job)
  if (endDate) {
    const daysLeft = daysBetween(endDate, today)
    if (daysLeft !== null) {
      if (daysLeft < 0) score -= 1000 + Math.abs(daysLeft)
      else score += daysLeft
    }
  } else {
    score += 5000
  }

  return score
}

// Date-filter widening order for the drill-down auto-fit (custom is excluded).
const DATE_FILTER_ORDER = ['week', 'month', 'quarter', 'all']

function rangeForKey(key, now) {
  switch (key) {
    case 'week': {
      const mon = getMonday(now)
      const fri = new Date(mon)
      fri.setDate(fri.getDate() + 4)
      return { from: fmtD(mon), to: fmtD(fri) }
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: fmtD(first), to: fmtD(last) }
    }
    case 'quarter':
      return { from: fmtD(getQuarterStart(now)), to: fmtD(getQuarterEnd(now)) }
    default: // 'all' and anything unknown → no bound
      return null
  }
}

function jobInRange(j, range) {
  if (!range) return true
  const start = effectiveStart(j)
  const end = effectiveEnd(j)
  if (!start && !end) return true
  return (start || '1900-01-01') <= range.to && (end || '2999-12-31') >= range.from
}

function matchesSearch(j, q) {
  if (!q) return true
  const num = (j.job_num || '').toLowerCase()
  const name = (j.job_name || '').toLowerCase()
  const wt = (j.work_type || '').toLowerCase()
  return num.includes(q) || name.includes(q) || wt.includes(q)
}

// The status filter each stage tab applies on top of the shell filters.
function stagePredicate(tab, crewByCallLog, matsByJobId) {
  switch (tab) {
    case 'staged':    return j => getJobStatus(j) === 'Scheduled' && !isReady(j, crewByCallLog, matsByJobId)
    case 'scheduled': return j => getJobStatus(j) === 'Scheduled' && isReady(j, crewByCallLog, matsByJobId)
    case 'active':    return j => { const s = getJobStatus(j); return s === 'In Progress' || s === 'Ongoing' }
    case 'on-hold':   return j => getJobStatus(j) === 'On Hold'
    case 'complete':  return j => getJobStatus(j) === 'Complete'
    default:          return () => true // 'all'
  }
}

/* ── shell ───────────────────────────────────────────────────────── */

export default function Jobs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const tabParam = searchParams.get('tab')
  const redirectTo = tabParam && TAB_REDIRECTS[tabParam]
  // Tolerant reader: valid tab → that stage; unknown/absent → All (hard default).
  const activeTab = redirectTo ? null : (VALID_TABS.includes(tabParam) ? tabParam : 'all')

  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true })
  }, [redirectTo, navigate])

  const setActiveTab = useCallback((next) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev)
      if (next === null || next === 'all') params.delete('tab')
      else params.set('tab', next)
      return params
    })
  }, [setSearchParams])

  const [jobs, setJobs] = useState([])
  const [assignments, setAssignments] = useState([])
  const [billingWorklist, setBillingWorklist] = useState([])
  const [materials, setMaterials] = useState([])
  const [dailyLogs, setDailyLogs] = useState([])
  const [prtMap, setPrtMap] = useState(new Map())
  const [proposalMaterialsByCallLog, setProposalMaterialsByCallLog] = useState({})
  const [mobsByJobId, setMobsByJobId] = useState({})
  const [crew, setCrew] = useState([])
  const [crewStatusMap, setCrewStatusMap] = useState({})
  const [syncWarning, setSyncWarning] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Actions menu (cross-screen jumps ported from JobsPicker)
  const [actionsOpen, setActionsOpen] = useState(false)

  // shell-level filters drive the job list
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // restore bin
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  const today = useMemo(() => new Date(), [])
  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = fmtD(new Date())
  const loadIdRef = useRef(0)
  // Tab for which the user manually chose a date range — auto-fit skips it.
  const manualFilterTabRef = useRef(null)

  const pickFilter = useCallback((key) => {
    manualFilterTabRef.current = activeTab
    setDateFilter(key)
  }, [activeTab])

  // "Crew assigned" = office assignments (pre-kickoff signal), keyed by
  // call_log_id with shape [{name}] (matches every card consumer + isReady).
  const crewByCallLog = useMemo(() => {
    const clByJob = Object.fromEntries(jobs.map(j => [j.job_id, j.call_log_id]))
    const sets = {}
    for (const a of assignments) {
      const clId = clByJob[a.job_id]
      if (!clId || !a.crew_name) continue
      ;(sets[clId] ||= new Set()).add(a.crew_name)
    }
    const out = {}
    for (const clId in sets) out[clId] = [...sets[clId]].map(name => ({ name }))
    return out
  }, [assignments, jobs])

  const logsByCallLog = useMemo(() => dailyLogs.reduce((m, r) => {
    m[r.job_id] = (m[r.job_id] || 0) + 1; return m
  }, {}), [dailyLogs])

  // Per-job set of assignment dates — feeds the work-days weekend exception (§4.1)
  const assignmentsByJobId = useMemo(() => assignments.reduce((m, a) => {
    (m[a.job_id] ||= new Set()).add(a.date); return m
  }, {}), [assignments])

  const matsByJobId = useMemo(() => materials.reduce((m, r) => {
    (m[r.job_id] ||= []).push(r); return m
  }, {}), [materials])

  // Week-windowed assignments (Mon–Sat) for the capacity strip — derived from the
  // already-loaded full assignments list, no extra query.
  const weekAssignments = useMemo(() => {
    const ws = dates[0], we = dates[dates.length - 1]
    return assignments.filter(a => a.date >= ws && a.date <= we)
  }, [assignments, dates])

  const loadData = useCallback(async ({ background = false } = {}) => {
    const thisLoad = ++loadIdRef.current
    // Background refresh updates data IN PLACE — no loading-flip, so cards + any
    // open modal don't unmount under the user. Spinner only on the first load.
    if (!background) setLoading(true)
    const wsStr = dates[0]
    const weStr = dates[dates.length - 1]
    const [jobsRes, assignRes, billRes, matsRes, logsRes, crewRes, csRes] = await Promise.all([
      loadJobs({ withWTCs: true }),
      supabase.from('assignments').select('*'),
      loadBillingWorklist(),
      loadAllRows('job_material_lines', 'id, job_id, status', { orderBy: 'id' }),
      loadAllRows('daily_log_entries', 'id, job_id', { orderBy: 'id' }),
      supabase.from('crew').select('*'),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
    ])
    if (thisLoad !== loadIdRef.current) return
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    setJobs(jobsRes.data || [])
    setAssignments(assignRes.data || [])
    setBillingWorklist(billRes.data || [])
    setMaterials(matsRes.data || [])
    setDailyLogs(logsRes.data || [])
    setCrew((crewRes.data || []).filter(c => c.archived !== 'Yes'))
    const csMap = {}
    for (const c of (csRes.data || [])) csMap[c.crew_name + '|' + c.date] = c.status
    setCrewStatusMap(csMap)
    setSyncWarning(matsRes.partial || logsRes.partial ? 'Counts may be stale — partial data loaded' : null)

    const loadedJobs = jobsRes.data || []

    // Batched proposal_wtc materials for the in-card SOW editor's per-WTC picker.
    const pmCallLogIds = [...new Set(loadedJobs.map(j => j.call_log_id).filter(Boolean))]
    if (pmCallLogIds.length > 0) {
      const { data: pwData } = await supabase
        .from('proposal_wtc')
        .select('id, materials, proposals!inner(call_log_id)')
        .in('proposals.call_log_id', pmCallLogIds)
      if (thisLoad !== loadIdRef.current) return
      const pmMap = {}
      ;(pwData || []).forEach(w => {
        const clId = w.proposals?.call_log_id
        if (clId == null) return
        const arr = pmMap[clId] || (pmMap[clId] = [])
        ;(w.materials || []).forEach(m => { if (m && m.id != null) arr.push({ ...m, _wtc_id: w.id }) })
      })
      setProposalMaterialsByCallLog(pmMap)
    } else {
      setProposalMaterialsByCallLog({})
    }

    // Live job mobilizations keyed by JOB_ID (post-send source of truth). Feeds the
    // MOBS card + modal AND the Go-Backs signal (is_go_back).
    if (loadedJobs.length > 0) {
      const mobs = await loadMobilizationsByJobId(loadedJobs)
      if (thisLoad !== loadIdRef.current) return
      setMobsByJobId(mobs)
    } else {
      setMobsByJobId({})
    }

    const activeCallLogIds = loadedJobs
      .filter(j => j.status === 'In Progress' || j.status === 'Ongoing')
      .map(j => j.call_log_id)
      .filter(Boolean)
    if (activeCallLogIds.length > 0) {
      const prtRes = await loadPRTsForCallLogIds(activeCallLogIds)
      if (thisLoad !== loadIdRef.current) return
      setPrtMap(prtRes.data)
    } else {
      setPrtMap(new Map())
    }

    setLoading(false)
  }, [dates])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: reload on jobs, assignments (crew), or materials changes.
  // 300ms debounce so bulk imports don't freeze the tab. [R1:E1 — must survive]
  useEffect(() => {
    let timer = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => loadData({ background: true }), 300)
    }
    const channels = [
      supabase.channel('schedule-jobs-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedLoad)
        .subscribe(),
      supabase.channel('schedule-assignments-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, debouncedLoad)
        .subscribe(),
      supabase.channel('schedule-job-material-lines-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'job_material_lines' }, debouncedLoad)
        .subscribe(),
    ]
    return () => {
      if (timer) clearTimeout(timer)
      channels.forEach(c => supabase.removeChannel(c))
    }
  }, [loadData])

  const dateRange = useMemo(() => {
    if (dateFilter === 'custom') {
      return customFrom && customTo ? { from: customFrom, to: customTo } : null
    }
    return rangeForKey(dateFilter, new Date())
  }, [dateFilter, customFrom, customTo])

  // shell-filtered jobs (date + search) — stage tab applies status filter on top
  const filteredJobs = useMemo(() => {
    const q = search.toLowerCase().trim()
    const list = jobs.filter(j => jobInRange(j, dateRange) && matchesSearch(j, q))
    return [...list].sort((a, b) => urgencyScore(a, today) - urgencyScore(b, today))
  }, [jobs, search, dateRange, today])

  // Dashboard band (capacity strip + panels) — same canonical computeHomeDashboard
  // today's Home uses. allAssignments = the full assignments list.
  const dash = useMemo(() => computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments: assignments,
    matsByJobId, dates, todayStr,
  }), [jobs, crew, crewStatusMap, weekAssignments, assignments, matsByJobId, dates, todayStr])

  const weekLabel = useMemo(() => {
    const a = new Date(dates[0] + 'T00:00:00'), b = new Date(dates[dates.length - 1] + 'T00:00:00')
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${M[a.getMonth()]} ${a.getDate()} – ${M[b.getMonth()]} ${b.getDate()}`
  }, [dates])

  // Go-Backs count — mobsByJobId is a nested [job_id][seq] seq-map, NOT an array
  // [R1:C1]: iterate Object.values() per job.
  const goBacksCount = useMemo(() => {
    let n = 0
    for (const jid in mobsByJobId) {
      n += Object.values(mobsByJobId[jid] || {}).filter(m => m.is_go_back).length
    }
    return n
  }, [mobsByJobId])

  // Prep-readiness attention math — ported verbatim from the retired JobsPicker
  // [R1:A2] so the counts (missing SOW/mats/crew/date, starting this week, ready
  // to bill) survive the picker deletion.
  const attn = useMemo(() => {
    const scheduled = jobs.filter(j => getJobStatus(j) === 'Scheduled')
    let missingSow = 0, missingMats = 0, missingCrew = 0, missingDate = 0
    scheduled.filter(j => !isReady(j, crewByCallLog, matsByJobId)).forEach(j => {
      if (!hasFieldSow(j)) missingSow++
      const mats = matsByJobId[j.job_id] || []
      if (mats.length > 0 && mats.some(m => ['Not Ordered', 'Delayed'].includes(m.status))) missingMats++
      if ((crewByCallLog[j.call_log_id] || []).length === 0) missingCrew++
      if ((j.scheduled_start || j.start_date) == null) missingDate++
    })
    const startingThisWeek = scheduled.filter(j =>
      isReady(j, crewByCallLog, matsByJobId) && isThisWeek(j.scheduled_start || j.start_date, today)
    ).length
    const nothingToBill = new Set(
      (billingWorklist || []).filter(o => o.nothing_to_bill).map(o => String(o.job_id))
    )
    const readyToBill = jobs.filter(j =>
      getJobStatus(j) === 'Complete' && !nothingToBill.has(String(j.job_id))
    ).length
    return { missingSow, missingMats, missingCrew, missingDate, startingThisWeek, readyToBill }
  }, [jobs, billingWorklist, crewByCallLog, matsByJobId, today])

  const multiWeekAlertCount = useMemo(() =>
    jobs.filter(j =>
      getJobStatus(j) === 'Scheduled' &&
      isReady(j, crewByCallLog, matsByJobId) &&
      getJobMultiWeekAlert(j, assignments, today) > 0
    ).length
  , [jobs, assignments, crewByCallLog, matsByJobId, today])

  // Per-stage counts for the stage-tab badges.
  const stageCounts = useMemo(() => {
    const c = { all: jobs.length, staged: 0, scheduled: 0, active: 0, 'on-hold': 0, complete: 0 }
    for (const j of jobs) {
      const s = getJobStatus(j)
      if (s === 'Scheduled') { isReady(j, crewByCallLog, matsByJobId) ? c.scheduled++ : c.staged++ }
      else if (s === 'In Progress' || s === 'Ongoing') c.active++
      else if (s === 'On Hold') c['on-hold']++
      else if (s === 'Complete') c.complete++
    }
    return c
  }, [jobs, crewByCallLog, matsByJobId])

  // Drill-down auto-fit: on entering a stage, widen the date window to the
  // narrowest range that actually has jobs for that stage.
  useEffect(() => {
    if (!activeTab) return
    if (manualFilterTabRef.current === activeTab) return
    const pred = stagePredicate(activeTab, crewByCallLog, matsByJobId)
    const q = search.toLowerCase().trim()
    const stageJobs = jobs.filter(j => pred(j) && matchesSearch(j, q))
    if (stageJobs.length === 0) return
    const now = new Date()
    const best = DATE_FILTER_ORDER.find(key => stageJobs.some(j => jobInRange(j, rangeForKey(key, now)))) || 'all'
    setDateFilter(best)
  }, [activeTab, jobs, search, crewByCallLog, matsByJobId])

  /* ── restore bin ────────────────────────────────────────────── */

  const openBin = useCallback(async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data, error: err } = await supabase
      .from('jobs')
      .select('*')
      .eq('deleted', 'Yes')
      .gte('deleted_at', cutoff)
      .order('deleted_at', { ascending: false })
    if (err) { console.error(err); return }
    setDeletedJobs(data || [])
    setShowBin(true)
  }, [])

  const restoreJob = useCallback(async (jobId) => {
    const { error: err } = await supabase.from('jobs').update({ deleted: 'No', deleted_at: null }).eq('job_id', jobId)
    if (err) { console.error(err); return }
    setDeletedJobs(prev => prev.filter(j => j.job_id !== jobId))
    await loadData()
  }, [loadData])

  /* ── render ─────────────────────────────────────────────────── */

  if (loading) return <div className="jh-empty">Loading jobs...</div>
  if (error) return <div className="jh-empty">Error: {error}</div>

  const FILTER_OPTIONS = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'This Quarter' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ]

  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
    borderRadius: 6, background: 'var(--panel-dark)', color: 'var(--teal)',
    fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.05em', textTransform: 'uppercase',
  }

  return (
    <div className="jh-wrap">
      {/* dashboard band moved from Home: capacity strip + panels */}
      <HomeCapacityStrip data={dash} weekLabel={weekLabel} />

      <div className="home-panels">
        <NeedsAttention data={dash} />
        <NextUp nextUp={dash.nextUp} />
        <AtAGlance data={dash} />
      </div>

      {/* Go-Backs + prep-readiness signals strip (ported JobsPicker math) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 18px' }}>
        <span style={chip}>↩ {goBacksCount} Go Back{goBacksCount === 1 ? '' : 's'}</span>
        {attn.missingSow > 0 && <span style={chip}>📋 {attn.missingSow} need SOW</span>}
        {attn.missingMats > 0 && <span style={chip}>📦 {attn.missingMats} need materials</span>}
        {attn.missingCrew > 0 && <span style={chip}>👷 {attn.missingCrew} need crew</span>}
        {attn.missingDate > 0 && <span style={chip}>📅 {attn.missingDate} need date</span>}
        {multiWeekAlertCount > 0 && <span style={chip}>🗓 {multiWeekAlertCount} multi-week need crew</span>}
        <span style={chip}>▶ {attn.startingThisWeek} starting this week</span>
        <span style={chip}>💵 {attn.readyToBill} ready to bill</span>
      </div>

      {/* stage tabs + Actions menu + Recovery Bin */}
      <div className="jh-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {STAGE_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                border: `1.5px solid ${activeTab === t.key ? 'var(--teal)' : 'var(--brd)'}`,
                background: activeTab === t.key ? 'var(--panel-dark)' : 'transparent',
                color: activeTab === t.key ? 'var(--teal)' : 'var(--text-secondary)',
              }}
            >
              {t.label} <span style={{ opacity: 0.7 }}>{stageCounts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <button className="jh-bin-btn" onClick={openBin} title="Recover jobs deleted in the last 24 hours">🗑 Recovery Bin (24 hrs)</button>
          <button
            onClick={() => setActionsOpen(o => !o)}
            style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'var(--font-heading)', fontSize: 12.5, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              border: '1.5px solid var(--teal)', background: 'var(--panel-dark)', color: 'var(--teal)',
            }}
          >
            Actions ▾
          </button>
          {actionsOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20,
              background: 'var(--bg-card)', border: '1px solid var(--brd)', borderRadius: 10,
              boxShadow: '0 6px 20px rgba(28,24,20,0.18)', minWidth: 180, overflow: 'hidden',
            }}>
              {ACTIONS.map(a => (
                <button
                  key={a.to}
                  onClick={() => { setActionsOpen(false); navigate(a.to) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)',
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {syncWarning && <div className="jh-sync-warning">{syncWarning}</div>}

      {/* filter bar: search + date pills */}
      <div className="jh-toolbar">
        <input
          className="jh-search"
          type="text"
          placeholder="Search jobs by name, number, or work type..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="jh-filter-bar">
        <div className="jh-filter-pills">
          {FILTER_OPTIONS.map(f => (
            <button
              key={f.key}
              className={`jh-filter-pill${dateFilter === f.key ? ' active' : ''}`}
              onClick={() => pickFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {dateFilter === 'custom' && (
          <div className="jh-custom-range">
            <input type="date" className="jh-date-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="jh-range-sep">to</span>
            <input type="date" className="jh-date-input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {/* full job list — each row expands to the full StageJobCard + all modals */}
      {activeTab === 'staged' && (
        <StagedCardList
          jobs={filteredJobs.filter(j => getJobStatus(j) === 'Scheduled' && !isReady(j, crewByCallLog, matsByJobId))}
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          today={today}
          onJobUpdate={() => loadData({ background: true })}
          emptyText="No staged jobs in this date range"
        />
      )}
      {activeTab === 'scheduled' && (
        <StagedCardList
          jobs={filteredJobs.filter(j => getJobStatus(j) === 'Scheduled' && isReady(j, crewByCallLog, matsByJobId))}
          stage="ready"
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          today={today}
          onJobUpdate={() => loadData({ background: true })}
          emptyText="No ready jobs in this date range"
        />
      )}
      {activeTab === 'active' && (
        <StagedCardList
          jobs={filteredJobs.filter(j => {
            const s = getJobStatus(j)
            return s === 'In Progress' || s === 'Ongoing'
          })}
          stage="active"
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          today={today}
          onJobUpdate={() => loadData({ background: true })}
          emptyText="No active jobs in this date range"
        />
      )}
      {activeTab === 'on-hold' && (
        <OnHoldCardList
          filteredJobs={filteredJobs}
          jobs={jobs}
          setJobs={setJobs}
          today={today}
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          onJobUpdate={() => loadData({ background: true })}
        />
      )}
      {activeTab === 'complete' && (
        <StagedCardList
          jobs={filteredJobs.filter(j => getJobStatus(j) === 'Complete')}
          stage="complete"
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          today={today}
          onJobUpdate={() => loadData({ background: true })}
          emptyText="No production-complete jobs in this date range"
        />
      )}
      {activeTab === 'all' && (
        <AllJobsList
          jobs={filteredJobs}
          crewByCallLog={crewByCallLog}
          matsByJobId={matsByJobId}
          logsByCallLog={logsByCallLog}
          assignmentsByJobId={assignmentsByJobId}
          proposalMaterialsByCallLog={proposalMaterialsByCallLog}
          mobsByJobId={mobsByJobId}
          prtMap={prtMap}
          today={today}
          onJobUpdate={() => loadData({ background: true })}
          emptyText="No jobs match the current filters"
        />
      )}

      {/* Restore Bin Modal */}
      {showBin && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) setShowBin(false) }}>
          <div className="mdl">
            <h3>Recovery Bin — Good for 24 Hours</h3>
            <div className="jh-bin-sub">Jobs you delete land here and can be restored for 24 hours. After that they're gone for good.</div>
            {deletedJobs.length === 0 ? (
              <div className="jh-empty">No jobs deleted in the last 24 hours</div>
            ) : (
              <div className="jh-bin-list">
                {deletedJobs.map(j => (
                  <div key={j.job_id} className="jh-bin-row">
                    <span className="jh-bin-name">{j.job_num} - {j.job_name}</span>
                    <button className="jh-bin-restore" onClick={() => restoreJob(j.job_id)}>Restore</button>
                  </div>
                ))}
              </div>
            )}
            <div className="macts">
              <button className="app-act-btn" onClick={() => setShowBin(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
