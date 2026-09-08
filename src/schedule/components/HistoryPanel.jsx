import { deriveJobTrips } from '../lib/queries'

// Job HISTORY = the list of the job's mobilizations (trips to site), built from
// the crew days it already has (mobilization_model C2). Replaces the old panel
// that read job_changes (the field-edit audit log — the "wrong table, always
// empty" problem the plan called out). A continuous run of scheduled days is one
// trip; a gap of more than a week starts the next. Combining duplicate cards
// brings more of a job's trips together here; nothing needs combining for a
// single job's own trips to show.
//
// Props: job, assignmentDates (Set/array of the job's crew-day ISO strings),
// mobs (the getJobMobilizations array — for labels + go-back badges).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null
}
function rangeLabel(t) {
  const a = fmt(t.start_date), b = fmt(t.end_date)
  if (!a && !b) return 'Dates TBD'
  return t.start_date === t.end_date ? a : `${a} – ${b}`
}

export default function HistoryPanel({ job, assignmentDates = null, mobs = [] }) {
  const trips = deriveJobTrips(assignmentDates, mobs)

  if (trips.length === 0) {
    return (
      <div className="sjc-panel">
        <div className="jh-empty">No scheduled days yet — this job has no crew days on the board.</div>
      </div>
    )
  }

  return (
    <div className="sjc-panel">
      <div className="jd-history">
        {trips.map(t => {
          const stripe = t.is_go_back ? '#b45309' /* rust */ : 'var(--teal, #30cfac)'
          return (
            <div
              key={t.seq}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                background: 'var(--bg-card)', border: '1px solid rgba(28,24,20,0.14)',
                borderLeft: `4px solid ${stripe}`,
              }}
            >
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 12, color: 'var(--text-light)', minWidth: 46 }}>
                Trip {t.seq}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.label || rangeLabel(t)}
                  {t.is_go_back && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: 'var(--header-dark)', color: 'var(--teal, #30cfac)', fontFamily: 'var(--font-heading)' }}>Go Back</span>
                  )}
                </div>
                {t.label && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{rangeLabel(t)}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-light)', fontFamily: 'var(--font-heading)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {t.dayCount} crew day{t.dayCount === 1 ? '' : 's'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
