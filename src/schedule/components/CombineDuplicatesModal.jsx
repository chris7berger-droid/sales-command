// Combine duplicates (mobilization_model, 2026-09-08). A job that got scheduled
// several times shows as several cards that share one original call. This tool
// lets Chris fold the extras into the ONE card he keeps: the folded cards' crew
// days roll under the kept job as mobilizations in its history, and the folded
// cards are hidden (not deleted — merged_into_job_id). Every which-cards /
// which-keeper decision is his; the DB (combine_jobs) only enforces that folded
// cards share the kept card's original call.

import { useMemo, useState } from 'react'
import { findDuplicateJobGroups, combineJobs } from '../lib/queries'
import { useUser } from '../lib/user'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null
}
function rangeLabel(c) {
  const a = fmtShort(c.start_date), b = fmtShort(c.end_date)
  if (!a && !b) return 'Dates TBD'
  return a && b && c.start_date === c.end_date ? a : `${a || 'TBD'} – ${b || 'TBD'}`
}

// One duplicate group: pick a keeper, check what to fold, confirm.
function CombineGroup({ group, changedBy, onCombined }) {
  const [keeper, setKeeper] = useState(null)
  const [folds, setFolds] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function chooseKeeper(jobId) {
    setKeeper(jobId)
    setFolds(new Set(group.cards.map(c => c.job_id).filter(id => id !== jobId)))
    setError(null)
  }
  function toggleFold(jobId) {
    if (jobId === keeper) return
    setFolds(prev => {
      const next = new Set(prev)
      next.has(jobId) ? next.delete(jobId) : next.add(jobId)
      return next
    })
  }

  const foldIds = [...folds]
  const keeperCard = group.cards.find(c => c.job_id === keeper)

  async function doCombine() {
    setBusy(true); setError(null)
    const { error } = await combineJobs(keeper, foldIds, changedBy)
    setBusy(false)
    if (error) { setError(error.message); setConfirming(false); return }
    onCombined?.()
  }

  return (
    <div style={{ border: '1px solid rgba(28,24,20,0.18)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{group.title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10, fontFamily: 'var(--font-body, inherit)' }}>
        Shows as {group.cards.length} cards. Pick the one to keep — the checked cards fold into it as trips in its history.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.cards.map(c => {
          const isKeeper = c.job_id === keeper
          const isFold = folds.has(c.job_id)
          return (
            <div key={c.job_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, background: isKeeper ? 'var(--header-dark)' : 'transparent', color: isKeeper ? 'var(--teal, #30cfac)' : 'var(--text-primary)', border: '1px solid rgba(28,24,20,0.12)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)' }}>
                <input type="radio" name={`keep-${group.callLogId}`} checked={isKeeper} onChange={() => chooseKeeper(c.job_id)} />
                Keep
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: keeper == null || isKeeper ? 'default' : 'pointer', opacity: keeper == null || isKeeper ? 0.4 : 1, fontFamily: 'var(--font-heading)' }}>
                <input type="checkbox" disabled={keeper == null || isKeeper} checked={isFold} onChange={() => toggleFold(c.job_id)} />
                Fold in
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                <div style={{ fontSize: 10, opacity: 0.8 }}>{rangeLabel(c)} · {c.crewDays} crew day{c.crewDays === 1 ? '' : 's'}{c.status ? ` · ${c.status}` : ''}</div>
              </div>
            </div>
          )
        })}
      </div>

      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8, fontFamily: 'var(--font-body, inherit)' }}>{error}</div>}

      {!confirming ? (
        <div style={{ marginTop: 10 }}>
          <button className="app-act-btn app-act-primary" disabled={keeper == null || foldIds.length === 0 || busy} onClick={() => setConfirming(true)}>
            Combine {foldIds.length || ''} into kept job
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: 'rgba(28,24,20,0.06)' }}>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-body, inherit)', marginBottom: 8 }}>
            Fold {foldIds.length} card{foldIds.length === 1 ? '' : 's'} into <b>{keeperCard?.name}</b>? Their crew days move under it as trips, and the folded cards are hidden (not deleted).
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="app-act-btn app-act-primary" disabled={busy} onClick={doCombine}>{busy ? 'Combining…' : 'Confirm combine'}</button>
            <button className="app-act-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CombineDuplicatesModal({ jobs = [], assignmentsByJobId = {}, onClose, onCombined }) {
  const user = useUser()
  const changedBy = user?.name || 'unknown'
  const groups = useMemo(() => findDuplicateJobGroups(jobs, assignmentsByJobId), [jobs, assignmentsByJobId])

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 620, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Combine duplicate jobs</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontFamily: 'var(--font-body, inherit)', marginBottom: 14 }}>
          These jobs show as more than one card because they were scheduled several times. Fold the extras into the one you keep — nothing is deleted, and you decide every combine.
        </div>

        {groups.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '16px 0' }}>
            No duplicate jobs found — every job shows as a single card.
          </div>
        ) : (
          groups.map(g => (
            <CombineGroup key={g.callLogId} group={g} changedBy={changedBy} onCombined={onCombined} />
          ))
        )}
      </div>
    </div>
  )
}
