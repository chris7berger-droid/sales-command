import { useMemo, useState } from 'react'
import HomeCapacityStrip from './HomeCapacityStrip'
import { computeHomeDashboard } from '../lib/queries'
import { crewWeekSummary } from '../lib/crewWeekSummary'
import { tripDate, tripRange } from '../lib/trips'

const LABELS = { starting: 'Jobs Starting', ending: 'Jobs Ending', needing: 'Jobs Needing Crew', unknown: 'Unclear Crew Requirements' }
const COLORS = { starting: 'var(--teal)', ending: 'var(--sig-orange)', needing: 'var(--sig-purple)' }

export default function CrewWeekCapacity({ jobs, weekJobs, crew, assignments, crewStatus, allocations, dates, todayStr, weekLabel, loading, error, pulse, onOpenTrip }) {
  const [selected, setSelected] = useState(null)
  const historical = dates.at(-1) < todayStr
  const selectedTitle = selected === 'unknown' && historical ? 'Historical Crew Details' : LABELS[selected]
  const data = useMemo(() => computeHomeDashboard({ jobs, crew, weekAssignments: assignments,
    allAssignments: assignments, crewStatusMap: crewStatus, dates, todayStr,
  }), [jobs, crew, assignments, crewStatus, dates, todayStr])
  const summary = useMemo(() => crewWeekSummary(weekJobs, allocations, assignments, dates), [weekJobs, allocations, assignments, dates])
  const badges = ['starting', 'ending', 'needing'].map(key => ({
    label: LABELS[key], value: summary[key].length, color: COLORS[key], onClick: () => setSelected(key),
  }))
  function openTrip(jobId, trip) {
    if (onOpenTrip?.(jobId, trip?.id || 'job')) setSelected(null)
  }
  return <>
    <HomeCapacityStrip data={data} weekLabel={weekLabel} badges={badges} loading={loading} loadError={error} pulse={pulse}
      summaryNote={!historical && summary.unknown.length > 0 && <button className="hcs-check-needs" onClick={() => setSelected('unknown')}>
        {summary.unknown.length} {summary.unknown.length === 1 ? 'job' : 'jobs'}: crew requirements unclear
      </button>} />
    {selected && !loading && !error && <div className="sch-modal-overlay" onClick={() => setSelected(null)} onKeyDown={e => { if (e.key === 'Escape') setSelected(null) }}>
      <div className="sch-modal sch-modal-detail" role="dialog" aria-modal="true" aria-label={selectedTitle} onClick={e => e.stopPropagation()}>
        <div className="sch-modal-title">{selectedTitle} ({summary[selected].length})</div>
        <p>{weekLabel}</p>
        <p className="sch-summary-help">{selected === 'starting' || selected === 'ending'
          ? 'Trip dates, including return trips. Each job counts once; a trip ending does not mean the whole job is complete.'
          : selected === 'unknown' ? historical
            ? 'This past week has missing crew requirements or overlapping trip dates. These are details of the saved history.'
            : 'Crew may already be assigned. The planned number needed is missing, or trips overlap. These jobs are not counted as known shortages.'
            : `${historical ? 'Historical staffing for this week. ' : ''}Each job counts once. Shortages below are for individual days.`}</p>
        {summary[selected].length === 0 && <p>No matching jobs this week.</p>}
        {summary[selected].map(entry => <div className="sch-summary-job" key={entry.key}>
          <strong>{entry.job.job_num} — {entry.job.job_name}</strong>
          {entry.details.map((detail, i) => <div className="sch-summary-detail" key={i}>
            {(detail.editTrips || [detail.trip]).map((trip, index) => <button type="button" className="sch-summary-trip-link" key={trip?.id || index}
              onClick={() => openTrip(detail.jobId, trip)}>
              {trip?.label || (trip?.seq ? `Trip ${trip.seq}` : 'Job schedule')} →
            </button>)}
            {detail.date ? <span>{tripDate(detail.date)} · {detail.reason
              ? `${detail.assigned} assigned · ${historical ? detail.editTrips?.length > 1 ? 'Trips overlap on these dates' : 'Crew requirement not recorded' : detail.reason}`
              : `${detail.assigned} / ${detail.needed} assigned · ${historical ? 'short by' : 'needs'} ${detail.short}${historical ? '' : ' more'}`}</span>
              : <span>{tripRange(detail.trip)}</span>}
          </div>)}
        </div>)}
        {selected === 'needing' && summary.unknown.length > 0 && <button className="sch-btn" onClick={() => setSelected('unknown')}>
          {historical ? 'View historical crew details for' : 'Also check crew needs for'} {summary.unknown.length} {summary.unknown.length === 1 ? 'job' : 'jobs'}
        </button>}
        <div className="sch-modal-actions"><button autoFocus className="sch-btn" onClick={() => setSelected(null)}>Close</button></div>
      </div>
    </div>}
  </>
}
