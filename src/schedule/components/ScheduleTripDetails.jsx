import { useState } from 'react'
import { pickAllocField } from '../lib/allocations'
import { tripRange } from '../lib/trips'
import MobsModal from './MobsModal'
import './ScheduleTripDetails.css'

const nameLabel = name => name?.includes(',') ? name.split(',').reverse().map(s => s.trim()).join(' ') : name
const fields = [['lead', 'Lead'], ['crew_needed', 'Crew needed'], ['vehicle', 'Vehicle'], ['equipment', 'Equipment'], ['power_source', 'Power source'], ['sow', 'Scope of work']]

export default function ScheduleTripDetails({ job, trips, onUpdated }) {
  const [editingId, setEditingId] = useState(null)
  return <section className="sch-trip-details" aria-label="Trips this week">
    <h4>Trips this week</h4>
    {trips.map(trip => <article className="sch-week-trip" key={trip.id} data-schedule-trip-id={trip.id}>
      <div className="sch-week-trip-heading">
        <div><strong>{trip.label || `Trip ${trip.seq}`}{trip.is_go_back ? ' · Go back' : ''}</strong><div>{tripRange(trip)}</div></div>
        <button className="app-act-btn app-act-primary" onClick={() => setEditingId(trip.id)}>Edit trip</button>
      </div>
      <dl>{fields.map(([key, label]) => {
        const value = pickAllocField(trip, job, key)
        const inherited = (trip[key] == null || trip[key] === '') && value != null && value !== ''
        return <div key={key}><dt>{label}{inherited && <small> · from job</small>}</dt><dd>{value == null || value === '' ? 'Not set' : key === 'lead' ? nameLabel(value) : String(value)}</dd></div>
      })}</dl>
      <div className="sch-trip-note"><strong>Trip notes</strong><p>{trip.note || 'No trip notes entered'}</p></div>
    </article>)}
    {editingId && <MobsModal job={job} initialEditId={editingId} onClose={() => setEditingId(null)} onUpdated={onUpdated} />}
  </section>
}
