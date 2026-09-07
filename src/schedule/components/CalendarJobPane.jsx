import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadJobWithWTCs, loadMobilizationsByJobId, getJobMobilizations } from '../lib/queries'
import { getStatusBadgeClass } from '../lib/jobStatus'
import { jobBlocks } from '../lib/calendarBars'
import ComingSoon from './ComingSoon'

// Job pane (plan §8.2). Overview renders SYNCHRONOUSLY from the job the calendar
// already loaded; only the mobilization list needs _wtcs, so we lazy-hydrate just
// the selected job (guarded against a stale-race). Material cost is cut to
// counts-only (plan §8.2 allowed option) — the cost helpers degrade silently to $0
// without their catalog/rate args, so we never render a fabricated dollar figure.
// Tabs (ratified 2026-09-06): Overview (wired) · Crew · Daily Logs · Production —
// the last three pull from Field Command (loadDailyLogsForJob / loadPRTsForJob),
// wired in a later pass. Read-only: Open/Edit deep-links to the job's card on the
// Jobs screen (/schedule/jobs?job=<id>) — JobDetail was retired.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(ds) {
  if (!ds) return '—'
  const d = new Date(String(ds).slice(0, 10) + 'T00:00:00')
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
function ymdToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const TEAL = '#30cfac'
const DARK = '#1c1814'

const s = {
  pane: {
    width: 320, flexShrink: 0, alignSelf: 'stretch',
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '12px 14px', borderBottom: '1px solid var(--border)',
  },
  hTitle: { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' },
  hSub: { fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  close: { background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 },
  tabs: { display: 'flex', gap: 4, padding: '8px 10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' },
  tab: (active) => ({
    padding: '5px 9px', border: 'none', cursor: 'pointer', borderRadius: '6px 6px 0 0',
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, marginBottom: -1,
    background: active ? DARK : 'transparent',
    color: active ? TEAL : 'var(--text-light)',
  }),
  body: { padding: 14, overflowY: 'auto', flex: 1 },
  photo: {
    height: 120, borderRadius: 8, marginBottom: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-muted, rgba(0,0,0,0.04))', border: '1px dashed var(--border)',
    fontFamily: 'var(--font-body)', fontSize: 12, fontStyle: 'italic', color: 'var(--text-light)',
  },
  field: { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 },
  icon: { fontSize: 13, lineHeight: '16px', opacity: 0.7, flexShrink: 0, width: 16, textAlign: 'center' },
  fMain: { minWidth: 0, flex: 1 },
  label: { fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-light)' },
  value: { fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', marginTop: 1 },
  progressWrap: { marginTop: 2 },
  progressTrack: { height: 6, borderRadius: 3, background: 'var(--bg-muted, rgba(0,0,0,0.08))', overflow: 'hidden', marginTop: 4 },
  progressFill: (pct) => ({ height: '100%', width: `${pct}%`, background: TEAL, borderRadius: 3 }),
  sectionTitle: {
    fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.5, color: 'var(--text-secondary)', margin: '14px 0 8px',
    borderTop: '1px solid var(--border)', paddingTop: 10,
  },
  mobRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 12,
    fontFamily: 'var(--font-body)', padding: '3px 0', color: 'var(--text-primary)',
  },
  actions: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' },
  actBtn: {
    flex: 1, padding: '9px 8px', cursor: 'pointer', borderRadius: 6,
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12,
    border: `1px solid ${TEAL}`, background: 'var(--bg-card)', color: 'var(--text-primary)',
  },
  actPrimary: { background: TEAL, color: DARK, borderColor: TEAL },
  muted: { fontFamily: 'var(--font-body)', fontSize: 12, fontStyle: 'italic', color: 'var(--text-light)' },
  notFound: { padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--text-light)' },
}

function Field({ icon, label, children }) {
  return (
    <div style={s.field}>
      <span style={s.icon}>{icon}</span>
      <div style={s.fMain}>
        <div style={s.label}>{label}</div>
        <div style={s.value}>{children}</div>
      </div>
    </div>
  )
}

export default function CalendarJobPane({ job, workedDaySet, getJobStatus, onClose }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  // One bundle keyed by jobId so the in-flight state is DERIVED (ready = it's for
  // the current job), never reset synchronously in the effect. loadIdRef still
  // drops an out-of-order response so job-A can't land under job-B (round-3 D).
  const [mobData, setMobData] = useState(null)
  const loadIdRef = useRef(0)

  useEffect(() => {
    if (!job) return
    const myId = ++loadIdRef.current
    const jid = job.job_id
    ;(async () => {
      const [jobRes, mobMap] = await Promise.all([
        loadJobWithWTCs(jid),
        loadMobilizationsByJobId([job], {}),
      ])
      if (loadIdRef.current !== myId) return  // a newer job was selected — drop this
      const hj = jobRes?.data || job
      const mobsBySeq = (mobMap && mobMap[jid]) || {}   // index BY job first (N-2)
      const wts = Array.isArray(hj._wtcs)
        ? [...new Set(hj._wtcs.map(w => w.work_type_name).filter(Boolean))] : []
      setMobData({
        jobId: jid,
        mobs: getJobMobilizations(hj, mobsBySeq),
        allocCount: jobBlocks(hj, mobsBySeq).length,
        subtitle: wts.join(', '),
      })
    })()
  }, [job])

  if (!job) return <div className="cal-job-pane" style={s.pane}><div style={s.notFound}>Job not found</div></div>

  const ready = mobData && mobData.jobId === job.job_id
  const hydrating = !ready
  const mobs = ready ? mobData.mobs : null
  const allocCount = ready ? mobData.allocCount : null
  const subtitle = ready ? mobData.subtitle : ''

  const start = job.scheduled_start || job.start_date
  const end = job.scheduled_end || job.end_date
  const totalWorkDays = workedDaySet ? workedDaySet.size : null
  const loc = [job.jobsite_address, job.jobsite_city, job.jobsite_state].filter(Boolean).join(', ')
  const status = getJobStatus(job)

  // Schedule Progress (Day X of N) — N≤0 guard (round-2 L).
  let progressLabel = null, progressPct = 0
  if (totalWorkDays && totalWorkDays > 0) {
    const elapsed = Math.min([...workedDaySet].filter(d => d <= ymdToday()).length, totalWorkDays)
    progressPct = Math.round((elapsed / totalWorkDays) * 100)
    progressLabel = `Day ${elapsed} of ${totalWorkDays} (${progressPct}%)`
  }

  return (
    <div className="cal-job-pane" style={s.pane}>
      <div style={s.header}>
        <div style={{ minWidth: 0 }}>
          <div style={s.hTitle}>{`${job.job_num || ''} · ${job.job_name || ''}`}</div>
          {subtitle && <div style={s.hSub}>{subtitle}</div>}
          <span className={`jh-status-badge ${getStatusBadgeClass(status)}`} style={{ marginTop: 6, display: 'inline-block' }}>{status}</span>
        </div>
        <button style={s.close} onClick={onClose} title="Close">×</button>
      </div>

      <div style={s.tabs}>
        <button style={s.tab(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
        <button style={s.tab(tab === 'crew')} onClick={() => setTab('crew')}>Crew</button>
        <button style={s.tab(tab === 'daily-logs')} onClick={() => setTab('daily-logs')}>Daily Logs</button>
        <button style={s.tab(tab === 'production')} onClick={() => setTab('production')}>Production</button>
      </div>

      <div style={s.body}>
        {tab === 'overview' && (
          <>
            <div style={s.photo}>Photo — coming soon</div>

            <Field icon="🏢" label="Customer">{job.customer_name || '—'}</Field>
            <Field icon="📍" label="Location">{loc || '—'}</Field>
            <Field icon="🏷️" label="Job Type">{job.is_change_order ? 'Change Order' : 'Job'}</Field>
            <Field icon="📅" label="Start">{fmtDate(start)}</Field>
            <Field icon="🏁" label="End">{fmtDate(end)}</Field>
            <Field icon="🗓️" label="Total Scheduled Work Days">{totalWorkDays != null ? `${totalWorkDays} day${totalWorkDays === 1 ? '' : 's'}` : '—'}</Field>
            <Field icon="👥" label="Crew Needed">{job.crew_needed || '—'}</Field>
            <Field icon="📊" label="Allocations">{hydrating ? '…' : (allocCount != null ? allocCount : '—')}</Field>

            {progressLabel && (
              <Field icon="📈" label="Schedule Progress">
                <div style={s.progressWrap}>
                  {progressLabel}
                  <div style={s.progressTrack}><div style={s.progressFill(progressPct)} /></div>
                </div>
              </Field>
            )}

            <div style={s.sectionTitle}>Mobilizations</div>
            {hydrating
              ? <div style={s.muted}>Loading…</div>
              : (mobs && mobs.length
                  ? mobs.map(m => (
                      <div key={m.seq} style={s.mobRow}>
                        <span>{m.label}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {m.start_date ? `${fmtDate(m.start_date)}${m.end_date && m.end_date !== m.start_date ? ' – ' + fmtDate(m.end_date) : ''}` : 'No dates'}
                        </span>
                      </div>
                    ))
                  : <div style={s.muted}>No mobilizations</div>
                )}

            <Field icon="📝" label="Notes"><span style={{ whiteSpace: 'pre-wrap' }}>{job.notes || '—'}</span></Field>

            <div style={s.sectionTitle}>Production</div>
            <ComingSoon label="Production %, photos & activity — from Field Command (coming soon)" />
          </>
        )}
        {tab === 'crew' && <ComingSoon label="Crew — coming soon" />}
        {tab === 'daily-logs' && <ComingSoon label="Daily Logs — from Field Command (coming soon)" />}
        {tab === 'production' && <ComingSoon label="Production PRT — from Field Command (coming soon)" />}
      </div>

      <div style={s.actions}>
        <button style={s.actBtn} onClick={() => navigate(`/schedule/jobs?job=${job.job_id}`)}>Open Job</button>
        <button style={{ ...s.actBtn, ...s.actPrimary }} onClick={() => navigate(`/schedule/jobs?job=${job.job_id}`)}>Edit Schedule</button>
      </div>
    </div>
  )
}
