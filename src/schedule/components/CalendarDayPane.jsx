import { useState } from 'react'
import ComingSoon from './ComingSoon'

// Day pane (plan §8.1). Renders off the selected date. Derives NOTHING: the day's
// members + the closures that resolve their color/crew/lead come down as props
// from Calendar() — the pane just lays them out. Rail sibling (not nested in a
// clickable cell), so internal buttons use plain onClick, no stopPropagation.

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtHeader(ds) {
  if (!ds) return ''
  const d = new Date(ds + 'T00:00:00')
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`
}

const s = {
  pane: {
    width: 300, flexShrink: 0, alignSelf: 'stretch',
    background: 'var(--bg-card)', border: '2px solid var(--border)', borderRadius: 4,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', background: 'var(--header-dark)', color: 'var(--white)',
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  close: {
    background: 'none', border: 'none', color: 'var(--white)', cursor: 'pointer',
    fontSize: 18, lineHeight: 1, padding: 0,
  },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)' },
  tab: (active) => ({
    flex: 1, padding: '6px 4px', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.5,
    background: active ? 'var(--bg-card)' : 'var(--bg-muted, rgba(0,0,0,0.03))',
    color: active ? 'var(--text-primary)' : 'var(--text-light)',
    borderBottom: active ? '2px solid var(--text-primary)' : '2px solid transparent',
  }),
  body: { padding: 8, overflowY: 'auto', flex: 1 },
  row: (selected) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
    borderRadius: 4, cursor: 'pointer', marginBottom: 2,
    background: selected ? 'var(--bg-muted, rgba(0,0,0,0.06))' : 'transparent',
    boxShadow: selected ? 'inset 0 0 0 1px var(--text-primary)' : 'none',
  }),
  dot: (color) => ({ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }),
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 12,
    color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  rowSub: {
    fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  crew: {
    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, flexShrink: 0,
    background: 'var(--header-dark)', color: 'var(--white)', borderRadius: 3, padding: '1px 5px',
  },
  chev: { color: 'var(--text-light)', flexShrink: 0, fontSize: 14 },
  empty: {
    fontFamily: 'var(--font-body)', fontSize: 12, fontStyle: 'italic',
    color: 'var(--text-light)', padding: 12, textAlign: 'center',
  },
}

export default function CalendarDayPane({
  date, members = [], selectedJobId,
  getJobColor, getJobStatus, barMeta, onSelectJob, onClose,
}) {
  const [tab, setTab] = useState('jobs')

  return (
    <div className="cal-day-pane" style={s.pane}>
      <div style={s.header}>
        <span>{fmtHeader(date)}</span>
        <button style={s.close} onClick={onClose} title="Close">×</button>
      </div>

      <div style={s.tabs}>
        <button style={s.tab(tab === 'jobs')} onClick={() => setTab('jobs')}>Jobs ({members.length})</button>
        <button style={s.tab(tab === 'crew')} onClick={() => setTab('crew')}>Crew View</button>
        <button style={s.tab(tab === 'summary')} onClick={() => setTab('summary')}>Summary</button>
      </div>

      <div style={s.body}>
        {tab === 'jobs' && (
          members.length === 0
            ? <div style={s.empty}>No crew scheduled this day</div>
            : members.map(({ jobId, seg }) => {
                const { crewCount, lead } = barMeta(seg)
                const job = seg.job
                return (
                  <div
                    key={jobId}
                    style={s.row(selectedJobId === jobId)}
                    onClick={() => onSelectJob(jobId)}
                  >
                    <span style={s.dot(getJobColor(job))} />
                    <div style={s.rowMain}>
                      <div style={s.rowTitle}>{`${job.job_num || ''} · ${job.job_name || ''}`}</div>
                      <div style={s.rowSub}>
                        {getJobStatus(job)}{lead ? ` · ${lead}` : ''}
                      </div>
                    </div>
                    {crewCount > 0 && <span style={s.crew}>{crewCount}</span>}
                    <span style={s.chev}>›</span>
                  </div>
                )
              })
        )}
        {tab === 'crew' && <ComingSoon label="Crew View — coming soon" />}
        {tab === 'summary' && <ComingSoon label="Summary — coming soon" />}
      </div>
    </div>
  )
}
