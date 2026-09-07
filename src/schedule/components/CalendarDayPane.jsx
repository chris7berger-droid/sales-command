import { useState } from 'react'
import ComingSoon from './ComingSoon'

// Day pane (plan §8.1). Renders off the selected date. Derives NOTHING: the day's
// members + the closures that resolve their color/crew/lead come down as props
// from Calendar() — the pane just lays them out. Rail sibling (not nested in a
// clickable cell), so internal buttons use plain onClick, no stopPropagation.

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtHeader(ds) {
  if (!ds) return ''
  const d = new Date(ds + 'T00:00:00')
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`
}

const s = {
  pane: {
    width: 300, flexShrink: 0, alignSelf: 'stretch',
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px', borderBottom: '1px solid var(--border)',
  },
  hTitle: { fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' },
  close: {
    background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer',
    fontSize: 20, lineHeight: 1, padding: 0,
  },
  tabs: { display: 'flex', gap: 4, padding: '8px 10px 0' },
  tab: (active) => ({
    padding: '5px 10px', border: 'none', cursor: 'pointer', borderRadius: 6,
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
    background: active ? '#1c1814' : 'transparent',
    color: active ? '#30cfac' : 'var(--text-light)',
  }),
  body: { padding: 8, overflowY: 'auto', flex: 1 },
  row: (selected) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px',
    borderRadius: 6, cursor: 'pointer', marginBottom: 2,
    background: selected ? 'rgba(48,207,172,0.12)' : 'transparent',
    boxShadow: selected ? 'inset 0 0 0 1px #30cfac' : 'none',
    transition: 'background 0.12s',
  }),
  dot: (color) => ({ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }),
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 13,
    color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  rowSub: {
    fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1,
  },
  crew: {
    display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0,
    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
  },
  chev: { color: 'var(--text-light)', flexShrink: 0, fontSize: 16 },
  empty: {
    fontFamily: 'var(--font-body)', fontSize: 12, fontStyle: 'italic',
    color: 'var(--text-light)', padding: 16, textAlign: 'center',
  },
}

// Small person glyph for the crew count (matches the mockup's "person · N").
function PersonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" />
    </svg>
  )
}

export default function CalendarDayPane({
  date, members = [], selectedJobId,
  getJobColor, getJobStatus, barMeta, onSelectJob, onClose,
}) {
  const [tab, setTab] = useState('jobs')

  return (
    <div className="cal-day-pane" style={s.pane}>
      <div style={s.header}>
        <span style={s.hTitle}>{fmtHeader(date)}</span>
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
                      <div style={s.rowSub}>{lead || getJobStatus(job)}</div>
                    </div>
                    {crewCount > 0 && <span style={s.crew}><PersonIcon />{crewCount}</span>}
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
