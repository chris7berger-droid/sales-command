import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { checkScheduleDeletion, deleteJob, deleteJobMobilization } from '../lib/queries'
import { tripRange } from '../lib/trips'
import { crewScheduleLink } from '../lib/jobCardSchedule'
import './DeleteScheduleItem.css'

// Shared by Crew Schedule, the job's Trips editor, and whole-job deletion.
// No assignment mutation exists here. Eligibility is rechecked by DB triggers.
export default function DeleteScheduleItem({ job, trip = null, disabled = false, onDeleted, onBusy, className = 'app-act-btn', style }) {
  const navigate = useNavigate()
  const [stage, setStage] = useState(null)
  const [blocker, setBlocker] = useState(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const button = useRef(null)
  const dialog = useRef(null)
  useEffect(() => {
    dialog.current?.querySelector('input:not(:disabled), button:not(:disabled)')?.focus()
  }, [stage, busy])
  const item = trip ? 'trip' : 'job'
  const title = trip ? `${trip.label || 'Trip'} · ${tripRange(trip)}` : job.job_name
  const setWorking = value => { inFlight.current = value; setBusy(value); onBusy?.(value) }
  const close = () => { if (inFlight.current) return; setStage(null); setTyped(''); setBlocker(null); button.current?.focus() }
  async function begin() {
    if (inFlight.current) return
    setWorking(true); setBlocker(null); setTyped(''); setStage('checking')
    try {
      const result = await checkScheduleDeletion(job.job_id, trip?.id)
      if (result.error) { setBlocker({ message: 'Could not verify whether deletion is safe. ' + result.error.message }); setStage('blocked') }
      else if (result.blocker) { setBlocker(result.blocker); setStage('blocked') }
      else setStage('warning')
    } catch { setBlocker({ message: 'Could not verify whether deletion is safe. Try again.' }); setStage('blocked') }
    finally { setWorking(false) }
  }
  async function remove() {
    if (inFlight.current || typed !== 'DELETE') return
    setWorking(true)
    try {
      const result = trip
        ? await deleteJobMobilization(job.job_id, trip)
        : await deleteJob(job.job_id)
      if (result.error) { setBlocker({ message: result.error.message }); setStage('blocked'); return }
      setStage('deleted')
      await onDeleted?.()
      setStage(null)
    } catch {
      setBlocker({ message: 'The result could not be refreshed. Reload the schedule before trying again.' }); setStage('blocked')
    } finally { setWorking(false) }
  }
  return <>
    <button ref={button} type="button" className={className} style={style} disabled={disabled || busy} onClick={begin}>Delete {item}</button>
    {stage && createPortal(<div className="schedule-root schedule-delete-overlay" onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
      if (e.key === 'Tab') {
        const controls = [...e.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
        const first = controls[0], last = controls.at(-1)
        if (!first) { e.preventDefault(); return }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }}>
      <section ref={dialog} className="schedule-delete-dialog" role="alertdialog" aria-modal="true" aria-label={`Delete ${item}`}>
        <h3>{stage === 'blocked' ? `Cannot delete this ${item}` : `Delete ${item}`}</h3>
        <p><strong>Job {job.job_num}</strong> · {title}</p>
        {stage === 'checking' && <p role="status">Checking crew and recorded work…</p>}
        {stage === 'deleted' && <p role="status">Deleted. Refreshing the schedule…</p>}
        {stage === 'blocked' && <p role="alert">{blocker?.message}</p>}
        {stage === 'warning' && <p>{trip
          ? 'You’re about to remove this trip permanently. It will be removed from the schedule and the job’s trip history. This cannot be undone.'
          : 'You’re about to remove this job from the schedule. Its Sales proposal will be freed to pull back or re-send. The job remains recoverable for 24 hours from the Recovery Bin.'}</p>}
        {stage === 'confirm' && <>
          <p>{trip ? 'Final confirmation: permanently delete this trip? This cannot be undone.' : 'Final confirmation: remove this job from the schedule? Recovery is available for 24 hours.'}</p>
          <label>Type DELETE to confirm<input autoFocus aria-label="Type DELETE to confirm" value={typed} disabled={busy} onChange={e => setTyped(e.target.value)} /></label>
        </>}
        <div className="schedule-delete-actions">
          <button autoFocus={stage !== 'confirm'} type="button" className="app-act-btn" disabled={busy} onClick={close}>Cancel</button>
          {stage === 'blocked' && blocker?.code === 'crew' && <button type="button" className="app-act-btn" onClick={() => {
            close()
            navigate(crewScheduleLink(job, trip ? [trip] : []))
          }}>Go to Crew Schedule</button>}
          {stage === 'warning' && <button type="button" className="app-act-btn" onClick={() => setStage('confirm')}>Continue</button>}
          {stage === 'confirm' && <button type="button" className="app-act-btn schedule-delete-confirm" disabled={busy || typed !== 'DELETE'} onClick={remove}>{busy ? 'Deleting…' : trip ? 'Permanently delete trip' : 'Delete job'}</button>}
        </div>
      </section>
    </div>, document.body)}
  </>
}
