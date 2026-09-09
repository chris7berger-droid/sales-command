import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateJobMobilization } from '../lib/queries'
import { tripRange } from '../lib/trips'
import { useUser } from '../lib/user'
import './ScheduleTripDetails.css'

const nameLabel = name => name?.includes(',') ? name.split(',').reverse().map(s => s.trim()).join(' ') : name

export default function ScheduleTripDetails({ job, trips, leadNames, onUpdated, onEditStateChange, editKey, initialSelected = null, children }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(initialSelected)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const editorKey = editKey ?? job.job_id
  useEffect(() => {
    onEditStateChange?.(editorKey, dirty || busy)
    return () => onEditStateChange?.(editorKey, false)
  }, [editorKey, dirty, busy, onEditStateChange])
  const trip = selected === 'job' ? null : trips.find(t => t.id === selected) || trips[0]
  return <div className="sch-trip-editor">
    <div className="sch-trip-heading">{trips.length > 0 && <label className="sch-trip-select">Trip title
      <select className="sch-dinp" aria-label="Select trip title" disabled={busy} value={trip?.id || 'job'} onChange={e => {
        if (dirty) { setSelectionError('Save or cancel your changes before switching trips.'); return }
        setSelectionError(''); setSelected(e.target.value)
      }}>
        {trips.map(t => <option key={t.id} value={t.id}>{t.label || `Trip ${t.seq}`} · {tripRange(t)}</option>)}
        <option value="job">Job defaults / original job dates</option>
      </select>
    </label>}
    <button type="button" className="app-act-btn" disabled={busy} onClick={() => {
      if (dirty) { setSelectionError("Save or cancel your changes before opening the job."); return }
      navigate(`/schedule/jobs?job=${encodeURIComponent(job.job_id)}&panel=trips`)
    }}>Open job →</button></div>
    {selectionError && <p role="alert">{selectionError}</p>}
    {trip ? <TripFields key={JSON.stringify(trip)} job={job} trip={trip} leadNames={leadNames} onUpdated={onUpdated} onDirty={value => { setDirty(value); setSelectionError('') }} onBusy={setBusy} /> : children}
  </div>
}

function TripFields({ job, trip, leadNames, onUpdated, onDirty, onBusy }) {
  const user = useUser()
  const [draft, setDraft] = useState({ ...trip })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const change = (field, value) => { setDraft(d => ({ ...d, [field]: value })); setDirty(true); onDirty(true) }
  async function save(e) {
    e.preventDefault()
    if (busy) return
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) { setError('End date can’t be before the start date.'); return }
    if (draft.crew_needed != null && draft.crew_needed !== '' && (!Number.isInteger(Number(draft.crew_needed)) || Number(draft.crew_needed) < 0)) { setError('Crew needed must be a whole number of zero or more.'); return }
    const patch = { label: draft.label, start_date: draft.start_date, end_date: draft.end_date }
    for (const field of ['crew_needed', 'lead', 'vehicle', 'equipment', 'power_source', 'sow', 'note']) {
      if ((draft[field] ?? '') !== (trip[field] ?? '')) patch[field] = field === 'crew_needed' ? (draft[field] === '' || draft[field] == null ? null : Number(draft[field])) : draft[field] || null
    }
    setBusy(true); onBusy(true); setError('')
    try {
      const result = await updateJobMobilization(job.job_id, trip, patch, user?.name || 'unknown')
      if (result.error) { setError(result.error.message); return }
      await onUpdated()
      setDirty(false); onDirty(false)
    } catch (err) { setError(err.message || 'Could not save this trip. Try again.') }
    finally { setBusy(false); onBusy(false) }
  }
  const sow = draft.sow || job.sow || ''
  const sowUrl = /^https?:\/\//i.test(sow) ? sow : /^www\./i.test(sow) ? `https://${sow}` : null
  const input = (field, label, type = 'text') => <div key={field}>
    <label>{label}</label>
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
    <input className="sch-dinp" aria-label={label} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 1 : undefined} disabled={busy} value={draft[field] ?? ''} placeholder={job[field] != null ? `Use job: ${job[field]}` : ''} onChange={e => change(field, e.target.value)} />
    {field === 'sow' && sowUrl && <a href={sowUrl} target="_blank" rel="noopener noreferrer" className="sch-sow-link" title="Open SOW">📄</a>}
    </div>
  </div>
  return <form noValidate onSubmit={save} data-schedule-trip-id={trip.id}>
    <div className="sch-det-grid">
      {input('vehicle', 'Vehicle')}{input('equipment', 'Equipment')}{input('power_source', 'Power')}
      <div><label>Lead</label><select className="sch-dinp" aria-label="Lead" disabled={busy} value={draft.lead || ''} onChange={e => change('lead', e.target.value)}>
        <option value="">{job.lead ? `Use job: ${nameLabel(job.lead)}` : 'Use job lead (not set)'}</option>
        {draft.lead && !leadNames.includes(draft.lead) && <option value={draft.lead}>{nameLabel(draft.lead)} (current)</option>}
        {leadNames.map(name => <option key={name} value={name}>{nameLabel(name)}</option>)}
      </select></div>
    </div>
    <div className="sch-det-grid">
      {input('start_date', 'Start', 'date')}{input('end_date', 'End', 'date')}{input('sow', 'Scope / SOW')}{input('crew_needed', 'Crew needed', 'number')}
    </div>
    <div className="sch-det-grid">{input('label', 'Trip title')}</div>
    <div className="sch-det-notes-wrap"><label>Trip notes</label><textarea className="sch-job-notes" aria-label="Trip notes" disabled={busy} value={draft.note || ''} onChange={e => change('note', e.target.value)} /></div>
    {error && <p role="alert">{error}</p>}
    {dirty && <div className="sch-trip-save"><button className="app-act-btn app-act-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save trip'} </button><button className="app-act-btn" type="button" disabled={busy} onClick={() => { setDraft({ ...trip }); setDirty(false); onDirty(false); setError('') }}>Cancel</button></div>}
  </form>
}
