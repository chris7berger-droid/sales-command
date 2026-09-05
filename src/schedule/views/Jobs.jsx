import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  loadJobs, loadAllRows, loadPRTsForCallLogIds, isReady, loadBillingWorklist,
  loadMobilizationsByJobId, computeHomeDashboard, wkDates, getJobMultiWeekAlert, hasFieldSow,
} from '../lib/queries'
import HomeCapacityStrip from '../components/HomeCapacityStrip'
import { NeedsAttention, NextUp, AtAGlance } from '../components/HomePanels'
import JobsToPrepare from '../components/JobsToPrepare'
import { getJobStatus } from '../lib/jobStatus'

// New Jobs (reskin chunk 1) — the old Home working surface, repainted. The plan:
// old Home (capacity strip + panels + the "Jobs to Prepare" list) MOVES here and
// becomes Jobs; the fresh dashboard is the new Home. So the job list IS the
// JobsToPrepare component (its compact rows that expand to the full StageJobCard),
// not the old Jobs stage-tab drill-in. Jobs also carries every old-Jobs function:
// the Go-Backs + prep-readiness signals strip (ported JobsPicker math), an Actions
// menu (cross-screen jumps), the Recovery Bin, the ?tab= redirect map, realtime.

// Old/removed tab slugs redirect to their canonical destination — legacy
// bookmarks only. MUST stay verbatim [R1:F1 / R2:REG-1]: `ready`/`schedule`
// redirect OUT to the crew board, NOT to a Ready stage.
const TAB_REDIRECTS = {
  pipeline: '/schedule/jobs?tab=scheduled',
  ready: '/schedule/schedule',
  schedule: '/schedule/schedule',
  billing: '/schedule/billing?tab=worklist',
  'ready-to-bill': '/schedule/billing?tab=worklist',
}

// Legacy ?tab= key → JobsToPrepare stage filter (ready/schedule redirect out
// above, so they never reach here). Unknown/absent → All (hard default).
const STAGE_FROM_TAB = { scheduled: 'ready', staged: 'staged', active: 'active', 'on-hold': 'on-hold', complete: 'complete', all: 'all' }

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

function isThisWeek(dateStr, today) {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  const mon = getMonday(today)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  return d >= mon && d <= sun
}

/* ── shell ───────────────────────────────────────────────────────── */

export default function Jobs() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tabParam = searchParams.get('tab')
  const redirectTo = tabParam && TAB_REDIRECTS[tabParam]
  const initialStage = redirectTo ? 'all' : (STAGE_FROM_TAB[tabParam] || 'all')

  useEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true })
  }, [redirectTo, navigate])

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
  const [actionsOpen, setActionsOpen] = useState(false)
  const [showBin, setShowBin] = useState(false)
  const [deletedJobs, setDeletedJobs] = useState([])

  const today = useMemo(() => new Date(), [])
  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = fmtD(new Date())
  const loadIdRef = useRef(0)

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

  // Dashboard band (capacity strip + panels) — canonical computeHomeDashboard.
  const dash = useMemo(() => computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments: assignments,
    matsByJobId, dates, todayStr,
  }), [jobs, crew, crewStatusMap, weekAssignments, assignments, matsByJobId, dates, todayStr])

  const weekLabel = useMemo(() => {
    const a = new Date(dates[0] + 'T00:00:00'), b = new Date(dates[dates.length - 1] + 'T00:00:00')
    const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${M[a.getMonth()]} ${a.getDate()} – ${M[b.getMonth()]} ${b.getDate()}`
  }, [dates])

  // Go-Backs count — mobsByJobId is a nested [job_id][seq] seq-map [R1:C1].
  const goBacksCount = useMemo(() => {
    let n = 0
    for (const jid in mobsByJobId) {
      n += Object.values(mobsByJobId[jid] || {}).filter(m => m && m.is_go_back).length
    }
    return n
  }, [mobsByJobId])

  // Prep-readiness attention math — ported verbatim from the retired JobsPicker
  // [R1:A2] so the counts survive the picker deletion.
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

      {/* Go-Backs + prep-readiness signals strip (ported JobsPicker math) +
          Recovery Bin + Actions menu */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '4px 0 16px' }}>
        <span style={chip}>↩ {goBacksCount} Go Back{goBacksCount === 1 ? '' : 's'}</span>
        {attn.missingSow > 0 && <span style={chip}>📋 {attn.missingSow} need SOW</span>}
        {attn.missingMats > 0 && <span style={chip}>📦 {attn.missingMats} need materials</span>}
        {attn.missingCrew > 0 && <span style={chip}>👷 {attn.missingCrew} need crew</span>}
        {attn.missingDate > 0 && <span style={chip}>📅 {attn.missingDate} need date</span>}
        {multiWeekAlertCount > 0 && <span style={chip}>🗓 {multiWeekAlertCount} multi-week need crew</span>}
        <span style={chip}>▶ {attn.startingThisWeek} starting this week</span>
        <span style={chip}>💵 {attn.readyToBill} ready to bill</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, position: 'relative' }}>
          <button className="jh-bin-btn" onClick={openBin} title="Recover jobs deleted in the last 24 hours">🗑 Recovery Bin (24 hrs)</button>
          <button
            onClick={() => setActionsOpen(o => !o)}
            style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'var(--font-heading)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              border: '1.5px solid var(--teal)', background: 'var(--panel-dark)', color: 'var(--teal)',
            }}
          >
            Go to ▾
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

      {/* the working list — the old-Home "Jobs to Prepare" rows, repainted. Each
          compact row expands to the full StageJobCard + all its modals; stageOf
          gates delete → Recovery Bin. Its own search + date chips + stage dropdown
          are the filter bar. */}
      <JobsToPrepare
        jobs={jobs}
        crewByCallLog={crewByCallLog}
        matsByJobId={matsByJobId}
        logsByCallLog={logsByCallLog}
        assignmentsByJobId={assignmentsByJobId}
        proposalMaterialsByCallLog={proposalMaterialsByCallLog}
        mobsByJobId={mobsByJobId}
        prtMap={prtMap}
        today={today}
        initialStage={initialStage}
        onJobUpdate={() => loadData({ background: true })}
      />

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
