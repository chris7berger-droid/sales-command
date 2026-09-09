import { useState } from 'react'
import MobsModal from './MobsModal'

export default function BuildScheduleModal({ job, mobs, onClose, onUpdated }) {
  const [mode, setMode] = useState(null)
  if (mode) return <MobsModal key={mode} job={job} mobs={mobs} initialCreate={mode === 'create'} editOnly={mode === 'edit'} onCreate={() => setMode('create')} onClose={onClose} onUpdated={onUpdated} />
  return <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="mdl" role="dialog" aria-modal="true" aria-label="Build schedule" style={{ maxWidth: 460 }}>
      <h3>Build schedule</h3>
      <p>{job.job_num} · {job.job_name}</p>
      <p style={{ margin: '16px 0' }}>Do you want to create a trip or edit a trip?</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button className="app-act-btn app-act-primary" onClick={() => setMode('create')}>Create a trip</button>
        <button className="app-act-btn" onClick={() => setMode('edit')}>Edit a trip</button>
        <button className="app-act-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  </div>
}
