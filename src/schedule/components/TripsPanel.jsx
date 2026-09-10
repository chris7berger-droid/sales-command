import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAllRows, loadJobMobilizationRows } from '../lib/queries'
import { supabase } from '../../lib/supabase'
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
  const [converting, setConverting] = useState(false)
  const now = new Date()
  const date = today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  useEffect(() => {
    let alive = true
    Promise.all([
      loadJobMobilizationRows(job.job_id),
      loadAllRows('assignments', 'id, job_id, crew_name, date, mobilization_id', {
        orderBy: 'id', filterFn: query => query.eq('job_id', job.job_id),
      }),
    ]).then(async ([trips, crew]) => {
      if (!alive) return
      const failure = trips.error || crew.error
      setError(failure?.message || null)
      if (failure) return
      const built = buildJobTrips(trips.data, crew.data, job)
      // First rollout is intentionally limited to job 10088. Convert each
      // unlinked date block into a real titled trip, oldest block first.
      if (String(job.job_num || '').startsWith('10088') && built.some(t => t.legacy)) {
        setConverting(true)
        try {
          const legacy = built.filter(t => t.legacy).sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
          const startSeq = Math.max(0, ...(trips.data || []).map(t => Number(t.seq) || 0)) + 1
          for (let i = 0; i < legacy.length; i++) {
            const block = legacy[i]
            const { data: created, error: createError } = await supabase.from('job_mobilizations').insert({
              job_id: job.job_id, seq: startSeq + i, label: `Trip ${i + 1}`,
              start_date: block.start_date, end_date: block.end_date, mob_type: 'unconfirmed',
            }).select('id').single()
            if (createError) throw createError
            const ids = block.assignments.map(a => a.id)
            if (ids.length) {
              const { error: linkError } = await supabase.from('assignments').update({ mobilization_id: created.id }).in('id', ids).is('mobilization_id', null)
              if (linkError) throw linkError
            }
          }
          if (alive) setRefresh(n => n + 1)
        } catch (err) {
          if (alive) setError(`Couldn’t convert 10088 crew records into trips: ${err.message}`)
        } finally {
          if (alive) setConverting(false)
        }
        return
      }
      setData({ jobId: job.job_id, trips: built })
    }).catch(err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [job, refresh])

  function updated() {
    setRefresh(n => n + 1)
    onUpdated?.()
  }

  const allTrips = data?.jobId === job.job_id ? data.trips : null
  // The job's own date range is reference information, not a saved trip. Keep it
  // above the list so the list contains only real trips and legacy crew records.
  const trips = allTrips?.filter(trip => !trip.parent)
  const jobSchedule = allTrips?.find(trip => trip.parent)
  return <div className="sjc-panel job-trips">
    <div className="job-trips-toolbar">
      <span>Grouped by scheduled dates. Past dates do not mean the work is completed.</span>
      <button className="app-act-btn" onClick={() => setRefresh(n => n + 1)}>Refresh trips</button>
    </div>
    {error ? <div role="alert">Couldn’t load all trips and crew: {error} <button className="app-act-btn" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>
      : !trips ? <p>{converting ? 'Creating trips from the existing crew records…' : 'Loading trips and crew…'}</p>
      : <>
        {jobSchedule && <div className="job-schedule-reference">
          <strong>Job schedule</strong>
          <span>{tripRange(jobSchedule)}</span>
        </div>}
        {!trips.length ? <p>No trips or crew history saved for this job yet.</p> : sections.map(([period, title]) => {
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
                <span className="job-trip-title"><strong>{trip.legacy ? 'Crew records' : trip.parent ? 'Job schedule' : `Trip ${trip.displayNumber}${trip.label ? ` · ${trip.label}` : ''}`}{trip.is_go_back ? ' · Go back' : ''}</strong><span>{tripRange(trip)}</span>{trip.label && /^Trip \d+$/.test(trip.label) && <small className="job-trip-title-reminder">Please update trip title.</small>}</span>
                <span className="job-trip-staffing"><span>{people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${assignedDays.length} crew ${assignedDays.length === 1 ? 'date' : 'dates'}` : period === 'past' ? 'No crew assignments recorded' : 'No crew assigned yet'}</span>{field('lead') && <span>Lead: {nameLabel(field('lead'))}</span>}</span>
              </button>
              {open && <div className="job-trip-details">
                {trip.label && /^Trip \d+$/.test(trip.label) && <p>Please update trip title.</p>}
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
                  <button className="app-act-btn" onClick={() => navigate(`/schedule/schedule?job=${job.job_id}&week=${trip.start_date || assignedDays[0] || date}${trip.id ? `&trip=${encodeURIComponent(trip.id)}` : ''}`)}>Open Crew Schedule</button>
                </div>
              </div>}
            </article>
          })}
        </section>
      })}
      </>}
    {editing && <MobsModal job={job} mobs={mobs} initialEditId={editing} onClose={() => setEditing(null)} onUpdated={updated} />}
  </div>
}
