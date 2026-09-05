import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  loadJobs, loadAllRows, loadPRTsForCallLogIds, loadMobilizationsByJobId,
  loadBillingSurfaceData, computeHomeDashboard, fmtD, getMonday, wkDates,
} from '../lib/queries'
import { buildBillingSurface, num } from '../lib/billingForecast'
import { getJobStatus } from '../lib/jobStatus'
import { AtAGlance } from '../components/HomePanels'

// New Home (reskin chunk 1) — a pure operations dashboard. NO working job rows
// (those live on Jobs now). Answers "how are operations doing": KPI hero cards,
// a scheduled-vs-completed workload chart, At-a-Glance, where-management-needs-
// to-look, recent activity, upcoming milestones, and a chunk-2 margin slot. Every
// number reads already-loaded data — including the two money cards, which reuse
// the canonical billing-surface loader [R1:B1, Option A].

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const dayDiff = (dstr, todayStr) => dstr ? Math.round((new Date(dstr + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000) : null

export default function Home() {
  const navigate = useNavigate()
  const monday = useMemo(() => getMonday(new Date()), [])
  const dates = useMemo(() => wkDates(monday), [monday])
  const todayStr = fmtD(new Date())
  const loadIdRef = useRef(0)

  const [jobs, setJobs] = useState([])
  const [crew, setCrew] = useState([])
  const [weekAssignments, setWeekAssignments] = useState([])
  const [allAssignments, setAllAssignments] = useState([])
  const [crewStatusMap, setCrewStatusMap] = useState({})
  const [materials, setMaterials] = useState([])
  const [mobsByJobId, setMobsByJobId] = useState({})
  const [prtMap, setPrtMap] = useState(new Map())
  const [surface, setSurface] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadData = useCallback(async ({ background = false } = {}) => {
    const thisLoad = ++loadIdRef.current
    if (!background) setLoading(true)
    const wsStr = dates[0]
    const weStr = dates[dates.length - 1]
    const [jobsRes, allAsgnRes, weekAsgnRes, crewRes, csRes, matsRes, billRes, actRes] = await Promise.all([
      loadJobs({ withWTCs: true }),
      // Paginated: assignments is >1000 rows; a plain select('*') caps at 1000
      // and under-counts crewByAll (drives the "not ready" check). The week query
      // below is date-scoped so it stays under the cap.
      loadAllRows('assignments', '*', { orderBy: 'id' }),
      supabase.from('assignments').select('*').gte('date', wsStr).lte('date', weStr),
      supabase.from('crew').select('*'),
      supabase.from('crew_status').select('*').gte('date', wsStr).lte('date', weStr),
      loadAllRows('job_material_lines', 'id, job_id, status', { orderBy: 'id' }),
      loadBillingSurfaceData(),
      supabase.from('job_changes').select('*').order('created_at', { ascending: false }).limit(15),
    ])
    if (thisLoad !== loadIdRef.current) return
    if (jobsRes.error) { setError(jobsRes.error.message); setLoading(false); return }
    const loadedJobs = jobsRes.data || []
    setJobs(loadedJobs)
    setAllAssignments(allAsgnRes.data || [])
    setWeekAssignments(weekAsgnRes.data || [])
    setCrew((crewRes.data || []).filter(c => !c.archived))
    setMaterials(matsRes.data || [])
    setSurface(billRes || null)
    setActivity(actRes.data || [])
    const csMap = {}
    for (const c of (csRes.data || [])) csMap[c.crew_name + '|' + c.date] = c.status
    setCrewStatusMap(csMap)

    // Go-back count + production % lean on these — keep loading them.
    if (loadedJobs.length > 0) {
      const mobs = await loadMobilizationsByJobId(loadedJobs)
      if (thisLoad !== loadIdRef.current) return
      setMobsByJobId(mobs)
    } else { setMobsByJobId({}) }

    const activeCallLogIds = loadedJobs
      .filter(j => j.status === 'In Progress' || j.status === 'Ongoing')
      .map(j => j.call_log_id).filter(Boolean)
    if (activeCallLogIds.length > 0) {
      const prtRes = await loadPRTsForCallLogIds(activeCallLogIds)
      if (thisLoad !== loadIdRef.current) return
      setPrtMap(prtRes.data)
    } else { setPrtMap(new Map()) }

    setLoading(false)
  }, [dates])

  useEffect(() => { loadData() }, [loadData])

  // Realtime: reload on jobs / assignments changes. The pure dashboard drops the
  // job_material_lines channel — no surviving card reads materials directly
  // (readiness reads matsByJobId on the next debounced reload) [R1:E1 / R2:C].
  useEffect(() => {
    let timer = null
    const debounced = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => loadData({ background: true }), 300) }
    const channels = [
      supabase.channel('schedule-home-jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debounced).subscribe(),
      supabase.channel('schedule-home-assignments').on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, debounced).subscribe(),
    ]
    return () => { if (timer) clearTimeout(timer); channels.forEach(c => supabase.removeChannel(c)) }
  }, [loadData])

  const matsByJobId = useMemo(() => materials.reduce((m, r) => { (m[r.job_id] ||= []).push(r); return m }, {}), [materials])

  const dash = useMemo(() => computeHomeDashboard({
    jobs, crew, crewStatusMap, weekAssignments, allAssignments, matsByJobId, dates, todayStr,
    prtMap, mobsByJobId,
  }), [jobs, crew, crewStatusMap, weekAssignments, allAssignments, matsByJobId, dates, todayStr, prtMap, mobsByJobId])

  const built = useMemo(() => {
    if (!surface) return null
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return buildBillingSurface(jobs, surface, t, getMonday)
  }, [jobs, surface])

  const jobById = useMemo(() => new Map(jobs.map(j => [j.job_id, j])), [jobs])

  // Money card 1 — Scheduled Work $: contract value of jobs starting in the next
  // 30 days, summed from the billing surface's authoritative totals.
  const scheduledWork = useMemo(() => {
    if (!built) return 0
    return built.rows.reduce((s, r) => {
      if (!r.authoritativeResolved) return s
      const j = jobById.get(r.jobId)
      const start = j && (j.scheduled_start || j.start_date)
      const diff = dayDiff(start, todayStr)
      if (diff == null || diff < 0 || diff > 30) return s
      return s + (r.authoritative || 0)
    }, 0)
  }, [built, jobById, todayStr])

  // Money card 2 — Ready to Bill $: canonical total remaining to bill.
  const readyToBill = built?.toBill ?? 0

  // Capacity % (this week) — average of the per-day capacity percentages.
  const capacityPct = useMemo(() => {
    const days = dash.capacityDays || []
    if (days.length === 0) return null
    return Math.round(days.reduce((s, d) => s + (d.pct || 0), 0) / days.length)
  }, [dash])

  // Job Readiness % — ready ÷ all scheduled-stage jobs.
  const readinessPct = useMemo(() => {
    const denom = dash.readyCount + dash.notReadyCount
    return denom === 0 ? null : Math.round((dash.readyCount / denom) * 100)
  }, [dash])

  // Scheduled Workload chart — Scheduled vs Completed $ per week, current + 5.
  // Completed = getJobStatus(j)==='Complete' bucketed by effectiveEnd; a
  // null-end completed job goes to a "no date" tally, never silently dropped
  // [R1:C3 / R2:B].
  const workload = useMemo(() => {
    const weeks = []
    for (let i = 0; i < 6; i++) { const m = new Date(monday); m.setDate(m.getDate() + i * 7); weeks.push({ monday: fmtD(m), scheduled: 0, completed: 0 }) }
    const idxFor = (dstr) => {
      if (!dstr) return -1
      const wk = fmtD(getMonday(new Date(dstr + 'T00:00:00')))
      return weeks.findIndex(w => w.monday === wk)
    }
    let completedNoDate = 0
    for (const j of jobs) {
      const status = getJobStatus(j)
      const val = num(j.amount)
      if (status === 'Complete') {
        const end = j.scheduled_end || j.end_date
        const i = idxFor(end)
        if (i >= 0) weeks[i].completed += val
        else if (!end) completedNoDate += val
      } else if (status === 'Scheduled' || status === 'In Progress' || status === 'Ongoing') {
        const i = idxFor(j.scheduled_start || j.start_date)
        if (i >= 0) weeks[i].scheduled += val
      }
    }
    const max = Math.max(1, ...weeks.map(w => Math.max(w.scheduled, w.completed)))
    return { weeks, completedNoDate, max }
  }, [jobs, monday])

  // Upcoming Milestones — starts + completions within the next 14 days.
  const milestones = useMemo(() => {
    const out = []
    for (const j of jobs) {
      const start = j.scheduled_start || j.start_date
      const end = j.scheduled_end || j.end_date
      const ds = dayDiff(start, todayStr)
      const de = dayDiff(end, todayStr)
      if (ds != null && ds >= 0 && ds <= 14) out.push({ job: j, date: start, kind: 'Start', diff: ds })
      if (de != null && de >= 0 && de <= 14) out.push({ job: j, date: end, kind: 'Completion', diff: de })
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8)
  }, [jobs, todayStr])

  const weekLabel = useMemo(() => {
    const a = new Date(dates[0] + 'T00:00:00'), b = new Date(dates[dates.length - 1] + 'T00:00:00')
    return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`
  }, [dates])

  if (loading) return <div className="home-screen"><div className="jh-empty">Loading…</div></div>
  if (error) return <div className="home-screen"><div className="jh-empty">Error: {error}</div></div>

  const heroCards = [
    { label: 'Scheduled Work', value: money(scheduledWork), sub: 'Contract value · next 30 days' },
    { label: 'Ready to Bill', value: money(readyToBill), sub: 'Remaining balance owed' },
    { label: 'Crew Capacity', value: capacityPct == null ? '—' : `${capacityPct}%`, sub: `This week · ${weekLabel}` },
    { label: 'Job Readiness', value: readinessPct == null ? '—' : `${readinessPct}%`, sub: `${dash.readyCount} ready · ${dash.notReadyCount} need prep` },
    { label: 'Production vs Target', value: dash.productionPct == null ? '—' : `${dash.productionPct}%`, sub: `${dash.productionReporting} job${dash.productionReporting === 1 ? '' : 's'} reporting` },
  ]

  const heroStyle = {
    background: 'var(--panel-dark)', color: '#fff', borderRadius: 14, padding: '16px 18px',
    display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
  }
  const heroNum = { fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 26, color: 'var(--teal)', lineHeight: 1.1 }
  const heroLbl = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }
  const heroSub = { fontSize: 11, color: 'rgba(255,255,255,0.55)' }
  const lightCard = { background: 'var(--bg-card)', border: '1px solid rgba(28,24,20,0.10)', borderRadius: 14, padding: '16px 18px' }
  const cardLbl = { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-light)', marginBottom: 12 }

  return (
    <div className="home-screen">
      {/* KPI hero cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 20 }}>
        {heroCards.map(c => (
          <div key={c.label} style={heroStyle}>
            <span style={heroLbl}>{c.label}</span>
            <span style={heroNum}>{c.value}</span>
            <span style={heroSub}>{c.sub}</span>
          </div>
        ))}
      </div>

      {/* Scheduled Workload chart + At a Glance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 20, alignItems: 'stretch' }}>
        <div style={lightCard}>
          <div style={cardLbl}>Scheduled Workload · Scheduled vs Completed $</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 150 }}>
            {workload.weeks.map(w => {
              const [, mm, dd] = w.monday.split('-')
              return (
                <div key={w.monday} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110 }}>
                    <div title={`Scheduled ${money(w.scheduled)}`} style={{ width: 12, height: `${Math.round((w.scheduled / workload.max) * 100)}%`, background: 'var(--teal)', borderRadius: '3px 3px 0 0' }} />
                    <div title={`Completed ${money(w.completed)}`} style={{ width: 12, height: `${Math.round((w.completed / workload.max) * 100)}%`, background: 'var(--sig-purple)', borderRadius: '3px 3px 0 0' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}>{parseInt(mm, 10)}/{parseInt(dd, 10)}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-light)' }}>
            <span><span style={{ display: 'inline-block', width: 9, height: 9, background: 'var(--teal)', borderRadius: 2, marginRight: 5 }} />Scheduled</span>
            <span><span style={{ display: 'inline-block', width: 9, height: 9, background: 'var(--sig-purple)', borderRadius: 2, marginRight: 5 }} />Completed</span>
            {workload.completedNoDate > 0 && <span style={{ marginLeft: 'auto' }}>+ {money(workload.completedNoDate)} completed, no end date</span>}
          </div>
        </div>

        <AtAGlance data={dash} />
      </div>

      {/* Where management needs to look + Recent Activity + Upcoming Milestones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div style={lightCard}>
          <div style={cardLbl}>Where Management Needs to Look</div>
          {[
            { label: 'Jobs short on crew this week', n: dash.needCrews },
            { label: 'Schedule conflicts (double-booked)', n: dash.conflicts },
            { label: 'Jobs not ready (starting ≤10 days)', n: dash.notReady },
            { label: 'Go-backs open', n: dash.goBacksCount },
          ].map(r => (
            <button key={r.label} onClick={() => navigate('/schedule/jobs?tab=all')}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(28,24,20,0.08)', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
              <span>{r.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.n > 0 ? 'var(--sig-red)' : 'var(--text-light)' }}>{r.n}</span>
            </button>
          ))}
        </div>

        <div style={lightCard}>
          <div style={cardLbl}>Recent Activity</div>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-light)' }}>No recent changes logged.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {activity.slice(0, 8).map(a => (
                <div key={a.id} style={{ fontSize: 12.5, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{a.field || 'change'}</b>{a.new_value ? ` → ${a.new_value}` : ''} {a.job_id ? `· job ${a.job_id}` : ''}
                  </span>
                  <span style={{ color: 'var(--text-light)', flexShrink: 0 }}>{a.created_at ? String(a.created_at).slice(5, 10) : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={lightCard}>
          <div style={cardLbl}>Upcoming Milestones · 14 days</div>
          {milestones.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Nothing starting or completing in the next 14 days.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {milestones.map((m, i) => (
                <button key={`${m.job.job_id}-${m.kind}-${i}`} onClick={() => navigate(`/schedule/jobs/${m.job.job_id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: m.kind === 'Start' ? 'var(--sig-green)' : 'var(--sig-purple)', fontWeight: 700 }}>{m.kind}</span> · {m.job.job_name || m.job.job_num || 'Job'}
                  </span>
                  <span style={{ color: 'var(--text-light)', flexShrink: 0 }}>{m.diff === 0 ? 'today' : `${m.diff}d`}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Margin overview — chunk-2 placeholder slot */}
      <div style={{ ...lightCard, opacity: 0.75 }}>
        <div style={cardLbl}>Margin Overview</div>
        <div style={{ fontSize: 13, color: 'var(--text-light)' }}>
          Live per-job margin (contract vs. crew-logged cost) + highest / lowest margin jobs
          land with chunk 2, once Field Command DPRs are flowing.
        </div>
      </div>
    </div>
  )
}
