import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAllRows, loadJobMobilizationRows } from '../lib/queries'
import { pickAllocField } from '../lib/allocations'
import { buildJobTrips, tripDate, tripPeriod, tripRange } from '../lib/trips'
import MobsModal from './MobsModal'
import './TripsPanel.css'

const sections = [['upcoming', 'Upcoming'], ['current', 'Current dates'], ['past', 'Past dates'], ['undated', 'Dates to set']]
const nameLabel = name => name?.includes(',') ? name.split(',').reverse().map(s => s.trim()).join(' ') : name

export default function TripsPanel({ job, mobs = [], onUpdated, today }) {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const [expanded, setExpanded] = useState({})
  const [editing, setEditing] = useState(null)
  const now = new Date()
  const date = today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    let alive = true
    Promise.all([
      loadJobMobilizationRows(job.job_id),
      loadAllRows('assignments', 'id, job_id, crew_name, date, mobilization_id', {
        orderBy: 'id', filterFn: query => query.eq('job_id', job.job_id),
      }),
    ]).then(([trips, crew]) => {
      if (!alive) return
      const failure = trips.error || crew.error
      setError(failure?.message || null)
      if (!failure) setData({ jobId: job.job_id, trips: buildJobTrips(trips.data, crew.data, job) })
    }).catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [job, refresh])

  function updated() {
    setRefresh(n => n + 1)
    onUpdated?.()
  }

  const trips = data?.jobId === job.job_id ? data.trips : null
  return <div className="sjc-panel job-trips">
    <div className="job-trips-toolbar">
      <span>Grouped by scheduled dates. Past dates do not mean the work is completed.</span>
      <button className="app-act-btn" onClick={() => setRefresh(n => n + 1)}>Refresh trips</button>
    </div>
    {error ? <div role="alert">Couldn’t load all trips and crew: {error} <button className="app-act-btn" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>
      : !trips ? <p>Loading trips and crew…</p>
      : !trips.length ? <p>No trips or crew history saved for this job yet.</p>
      : sections.map(([period, title]) => {
        const items = trips.filter(t => tripPeriod(t, date) === period).sort((a, b) => {
          const order = String(a.start_date || a.end_date || '').localeCompare(String(b.start_date || b.end_date || ''))
          return (period === 'past' ? -order : order) || (a.seq || 0) - (b.seq || 0)
        })
        if (!items.length) return null
        return <section key={period} aria-label={title}>
          <h4>{title} <span>({items.length})</span></h4>
          {items.map(trip => {
            const people = [...new Set(trip.assignments.map(a => a.crew_name).filter(Boolean))].sort()
            const assignedDays = [...new Set(trip.assignments.map(a => a.date))].sort()
            const open = !!expanded[trip.key]
            const field = key => trip.legacy ? null : pickAllocField(trip, job, key)
            const detail = (label, key, empty = 'Not set') => {
              const value = field(key)
              const inherited = value != null && value !== '' && (trip[key] == null || trip[key] === '')
              return <div><dt>{label}{inherited && <small> · from job</small>}</dt><dd className={key === 'sow' ? 'job-trip-sow' : undefined} tabIndex={key === 'sow' ? 0 : undefined} role={key === 'sow' ? 'region' : undefined} aria-label={key === 'sow' ? 'Scope of work' : undefined}>{value == null || value === '' ? empty : key === 'lead' ? nameLabel(value) : String(value)}</dd></div>
            }
            return <article className="job-trip" key={trip.key} data-trip-id={trip.key}>
              <button className="job-trip-summary" aria-expanded={open} onClick={() => setExpanded(s => ({ ...s, [trip.key]: !s[trip.key] }))}>
                <span>{open ? '▾' : '▸'}</span>
                <span className="job-trip-title"><strong>{trip.legacy ? 'Crew records' : trip.parent ? 'Job schedule' : `Trip ${trip.seq}${trip.label ? ` · ${trip.label}` : ''}`}{trip.is_go_back ? ' · Go back' : ''}</strong><span>{tripRange(trip)}</span></span>
                <span className="job-trip-staffing"><span>{people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${assignedDays.length} crew ${assignedDays.length === 1 ? 'date' : 'dates'}` : period === 'past' ? 'No crew assignments recorded' : 'No crew assigned yet'}</span>{field('lead') && <span>Lead: {nameLabel(field('lead'))}</span>}</span>
              </button>
              {open && <div className="job-trip-details">
                {trip.legacy && <p>These crew days aren’t linked to a saved trip. They are preserved here without guessing which trip they belong to.</p>}
                {trip.parent && <p>These dates are saved on the job. They stay visible alongside trips with different dates. Edit the job’s dates and details in Crew Schedule.</p>}
                {!trip.legacy && <dl className="job-trip-fields">
                  {detail('Lead', 'lead')}{detail('Crew needed', 'crew_needed')}
                  {detail('Vehicle', 'vehicle')}{detail('Equipment', 'equipment')}{detail('Power source', 'power_source')}
                  {detail('Scope of work', 'sow', 'No scope entered')}
                  <div><dt>{trip.parent ? 'Job notes' : 'Trip notes'}</dt><dd>{(trip.parent ? job.notes : trip.note) || 'No notes entered'}</dd></div>
                </dl>}
                <h5>Crew assignments</h5>
                {people.length ? <ul>{people.map(name => <li key={name}><strong>{nameLabel(name)}</strong> — {[...new Set(trip.assignments.filter(a => a.crew_name === name).map(a => a.date))].sort().map(tripDate).join(', ')}</li>)}</ul> : <p>{period === 'past' ? 'No crew assignments are recorded for this trip.' : 'No crew assigned yet. This trip is saved and can be staffed in Crew Schedule.'}</p>}
                <div className="job-trip-actions">
                  {!trip.legacy && !trip.parent && <button className="app-act-btn app-act-primary" onClick={() => setEditing(trip.id)}>Edit trip</button>}
                  <button className="app-act-btn" onClick={() => navigate(`/schedule/schedule?job=${job.job_id}&week=${trip.start_date || assignedDays[0] || date}`)}>Open Crew Schedule</button>
                </div>
              </div>}
            </article>
          })}
        </section>
      })}
    {editing && <MobsModal job={job} mobs={mobs} initialEditId={editing} onClose={() => setEditing(null)} onUpdated={updated} />}
  </div>
}
