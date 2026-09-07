import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadJobWithWTCs, loadMobilizationsByJobId, getJobMobilizations } from '../lib/queries'
import { jobBlocks } from '../lib/calendarBars'
import ComingSoon from './ComingSoon'

// Job pane (plan §8.2). Overview renders SYNCHRONOUSLY from the job the calendar
// already loaded; only the mobilization list needs _wtcs, so we lazy-hydrate just
// the selected job (guarded against a stale-race). Material cost is intentionally
// cut to counts-only (plan §8.2 allowed option) — the cost helpers degrade
// silently to $0 without their catalog/rate args, so we never render a fabricated
// dollar figure. Read-only: Open/Edit navigates to JobDetail. Rail sibling → plain
// onClick, no stopPropagation.

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

const s = {
  pane: {
    width: 320, flexShrink: 0, alignSelf: 'stretch',
    background: 'var(--bg-card)', border: '2px solid var(--border)', borderRadius: 4,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '8px 12px', background: 'var(--header-dark)', color: 'var(--white)',
  },
  hTitle: { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14 },
  hSub: { fontFamily: 'var(--font-body)', fontSize: 11, opacity: 0.85, marginTop: 2 },
  badge: {
    display: 'inline-block', marginTop: 4, fontFamily: 'var(--font-heading)', fontSize: 10,
    fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    background: 'rgba(255,255,255,0.2)', borderRadius: 3, padding: '1px 6px',
  },
  close: { background: 'none', border: 'none', color: 'var(--white)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)' },
  tab: (active) => ({
    flex: 1, padding: '6px 4px', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 10,
    textTransform: 'uppercase', letterSpacing: 0.5,
    background: active ? 'var(--bg-card)' : 'var(--bg-muted, rgba(0,0,0,0.03))',
    color: active ? 'var(--text-primary)' : 'var(--text-light)',
    borderBottom: active ? '2px solid var(--text-primary)' : '2px solid transparent',
  }),
  body: { padding: 12, overflowY: 'auto', flex: 1 },
  field: { marginBottom: 8 },
  label: {
    fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.5, color: 'var(--text-light)', marginBottom: 1,
  },
  value: { fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  sectionTitle: {
    fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 0.5, color: 'var(--text-secondary)', margin: '12px 0 6px',
    borderTop: '1px solid var(--border)', paddingTop: 8,
  },
  mobRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 12,
    fontFamily: 'var(--font-body)', padding: '3px 0', color: 'var(--text-primary)',
  },
  actions: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' },
  actBtn: {
    flex: 1, padding: '7px 8px', cursor: 'pointer', borderRadius: 4,
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.5,
    border: '2px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
  },
  actPrimary: { background: 'var(--header-dark)', color: 'var(--white)', borderColor: 'var(--header-dark)' },
  muted: { fontFamily: 'var(--font-body)', fontSize: 12, fontStyle: 'italic', color: 'var(--text-light)' },
  notFound: { padding: 20, textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--text-light)' },
}

function Field({ label, children }) {
  return (
    <div style={s.field}>
      <div style={s.label}>{label}</div>
      <div style={s.value}>{children}</div>
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

  // Schedule Progress (Day X of N) — N≤0 guard (round-2 L).
  let progress = null
  if (totalWorkDays && totalWorkDays > 0) {
    const today = ymdToday()
    const elapsed = [...workedDaySet].filter(d => d <= today).length
    progress = `Day ${Math.min(elapsed, totalWorkDays)} of ${totalWorkDays}`
  }

  return (
    <div className="cal-job-pane" style={s.pane}>
      <div style={s.header}>
        <div>
          <div style={s.hTitle}>{`${job.job_num || ''} · ${job.job_name || ''}`}</div>
          {subtitle && <div style={s.hSub}>{subtitle}</div>}
          <span style={s.badge}>{getJobStatus(job)}</span>
        </div>
        <button style={s.close} onClick={onClose} title="Close">×</button>
      </div>

      <div style={s.tabs}>
        <button style={s.tab(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
        <button style={s.tab(tab === 'crew')} onClick={() => setTab('crew')}>Crew</button>
        <button style={s.tab(tab === 'production')} onClick={() => setTab('production')}>Production</button>
        <button style={s.tab(tab === 'files')} onClick={() => setTab('files')}>Files</button>
      </div>

      <div style={s.body}>
        {tab === 'overview' && (
          <>
            <Field label="Customer">{job.customer_name || '—'}</Field>
            <Field label="Location">{loc || '—'}</Field>
            <div style={s.grid2}>
              <Field label="Job Type">{job.is_change_order ? 'Change Order' : 'Job'}</Field>
              <Field label="Status">{getJobStatus(job)}</Field>
              <Field label="Start">{fmtDate(start)}</Field>
              <Field label="End">{fmtDate(end)}</Field>
              <Field label="Work Days">{totalWorkDays != null ? totalWorkDays : '—'}</Field>
              <Field label="Crew Needed">{job.crew_needed || '—'}</Field>
            </div>
            {progress && <Field label="Schedule Progress">{progress}</Field>}

            <div style={s.sectionTitle}>Mobilizations</div>
            {hydrating
              ? <div style={s.muted}>Loading…</div>
              : (mobs && mobs.length
                  ? (
                    <>
                      <div style={{ ...s.value, marginBottom: 4 }}>
                        {mobs.length} mobilization{mobs.length === 1 ? '' : 's'}
                        {allocCount != null ? ` · ${allocCount} allocation${allocCount === 1 ? '' : 's'}` : ''}
                      </div>
                      {mobs.map(m => (
                        <div key={m.seq} style={s.mobRow}>
                          <span>{m.label}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {m.start_date ? `${fmtDate(m.start_date)}${m.end_date && m.end_date !== m.start_date ? ' – ' + fmtDate(m.end_date) : ''}` : 'No dates'}
                          </span>
                        </div>
                      ))}
                    </>
                  )
                  : <div style={s.muted}>No mobilizations</div>
                )}

            <Field label="Notes"><span style={{ whiteSpace: 'pre-wrap' }}>{job.notes || '—'}</span></Field>

            <div style={s.sectionTitle}>Production</div>
            <ComingSoon label="Production %, photos, and activity — coming soon" />
          </>
        )}
        {tab === 'crew' && <ComingSoon label="Crew detail — coming soon" />}
        {tab === 'production' && <ComingSoon label="Production tracking — coming soon" />}
        {tab === 'files' && <ComingSoon label="Files — coming soon" />}
      </div>

      <div style={s.actions}>
        <button style={s.actBtn} onClick={() => navigate(`/schedule/jobs/${job.job_id}`)}>Open Job</button>
        <button style={{ ...s.actBtn, ...s.actPrimary }} onClick={() => navigate(`/schedule/jobs/${job.job_id}`)}>Edit Schedule</button>
      </div>
    </div>
  )
}
