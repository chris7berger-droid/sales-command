import { useMemo, useState } from 'react'
import HomeCapacityStrip from './HomeCapacityStrip'
import { computeHomeDashboard } from '../lib/queries'
import { crewWeekSummary } from '../lib/crewWeekSummary'
import { tripDate, tripRange } from '../lib/trips'

const LABELS = { starting: 'Jobs Starting', ending: 'Jobs Ending', needing: 'Jobs Needing Crew', unknown: 'Crew Needs to Check' }
const COLORS = { starting: 'var(--teal)', ending: 'var(--sig-orange)', needing: 'var(--sig-purple)' }

export default function CrewWeekCapacity({ jobs, weekJobs, crew, assignments, crewStatus, allocations, dates, todayStr, weekLabel, loading, error, pulse }) {
  const [selected, setSelected] = useState(null)
  const data = useMemo(() => computeHomeDashboard({ jobs, crew, weekAssignments: assignments,
    allAssignments: assignments, crewStatusMap: crewStatus, dates, todayStr,
  }), [jobs, crew, assignments, crewStatus, dates, todayStr])
  const summary = useMemo(() => crewWeekSummary(weekJobs, allocations, assignments, dates), [weekJobs, allocations, assignments, dates])
  const badges = ['starting', 'ending', 'needing'].map(key => ({
    label: LABELS[key], value: summary[key].length, color: COLORS[key], onClick: () => setSelected(key),
  }))
  return <>
    <HomeCapacityStrip data={data} weekLabel={weekLabel} badges={badges} loading={loading} loadError={error} pulse={pulse}
      summaryNote={summary.unknown.length > 0 && <button className="hcs-check-needs" onClick={() => setSelected('unknown')}>
        {summary.unknown.length} {summary.unknown.length === 1 ? 'job' : 'jobs'}: crew needs to check
      </button>} />
    {selected && !loading && !error && <div className="sch-modal-overlay" onClick={() => setSelected(null)} onKeyDown={e => { if (e.key === 'Escape') setSelected(null) }}>
      <div className="sch-modal sch-modal-detail" role="dialog" aria-modal="true" aria-label={LABELS[selected]} onClick={e => e.stopPropagation()}>
        <div className="sch-modal-title">{LABELS[selected]} ({summary[selected].length})</div>
        <p>{weekLabel}</p>
        <p className="sch-summary-help">{selected === 'starting' || selected === 'ending'
          ? 'Trip dates, including return trips. Each job counts once; a trip ending does not mean the whole job is complete.'
          : selected === 'unknown' ? 'These requirements need checking. They are not counted as known crew shortages.'
            : 'Each job counts once. Shortages below are for individual days.'}</p>
        {summary[selected].length === 0 && <p>No matching jobs this week.</p>}
        {summary[selected].map(entry => <div className="sch-summary-job" key={entry.key}>
          <strong>{entry.job.job_num} — {entry.job.job_name}</strong>
          {entry.details.map((detail, i) => <div className="sch-summary-detail" key={i}>
            <span>{detail.tripLabel || detail.trip?.label || (detail.trip?.seq ? `Trip ${detail.trip.seq}` : 'Job schedule')}</span>
            {detail.date ? <span>{tripDate(detail.date)} · {detail.reason || `${detail.assigned} / ${detail.needed} assigned · needs ${detail.short} more`}</span>
              : <span>{tripRange(detail.trip)}</span>}
          </div>)}
        </div>)}
        {selected === 'needing' && summary.unknown.length > 0 && <button className="sch-btn" onClick={() => setSelected('unknown')}>
          Also check crew needs for {summary.unknown.length} {summary.unknown.length === 1 ? 'job' : 'jobs'}
        </button>}
        <div className="sch-modal-actions"><button autoFocus className="sch-btn" onClick={() => setSelected(null)}>Close</button></div>
      </div>
    </div>}
  </>
}
