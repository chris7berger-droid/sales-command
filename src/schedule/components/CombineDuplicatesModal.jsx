// Combine duplicates (mobilization_model, 2026-09-08). A job that got scheduled
// several times shows as several cards that share one original call. For each
// card you choose "Add to Main" or "Don't Add to Main", then Save. The cards you
// add are merged into ONE job (the earliest is the main; the rest fold in as
// trips in its history); the ones you don't add stay as separate cards. Nothing
// is deleted. The DB (combine_jobs) only ever combines cards sharing one call.

import { useState } from 'react'
import { findDuplicateJobGroups, combineJobs } from '../lib/queries'
import { useUser } from '../lib/user'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null
}
function rangeLabel(c) {
  const a = fmtShort(c?.start_date), b = fmtShort(c?.end_date)
  if (!a && !b) return 'Dates TBD'
  return a && b && c.start_date === c.end_date ? a : `${a || 'TBD'} – ${b || 'TBD'}`
}

// One duplicate group: per-card Add / Don't Add, then Save.
function CombineGroup({ group, changedBy, onCombined }) {
  // choice[job_id] = 'add' | 'no'. Default: add everything (the common case).
  const [choice, setChoice] = useState(() => {
    const o = {}
    for (const c of group.cards) o[c.job_id] = 'add'
    return o
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)   // { mainNum, mainName, folded } after a successful save

  const added = group.cards.filter(c => choice[c.job_id] === 'add')
  const mainCard = added[0] || null           // earliest added = the main (cards are date-sorted)
  const foldIds = added.slice(1).map(c => c.job_id)

  async function save() {
    if (added.length < 2) { setError('Pick "Add to Main" on at least 2 cards to combine.'); return }
    setBusy(true); setError(null)
    const { error } = await combineJobs(mainCard.job_id, foldIds, changedBy)
    setBusy(false)
    if (error) { setError(error.message); return }
    setDone({ mainNum: mainCard.num, mainName: mainCard.name, folded: foldIds.length })
    onCombined?.()   // refresh the board underneath; this group stays on screen (frozen list)
  }

  // After saving, keep the group's identity on screen with a result — don't blank out.
  if (done) {
    return (
      <div style={{ border: '1px solid var(--teal, #30cfac)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'rgba(48,207,172,0.10)' }}>
        <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {group.num ? `${group.num} · ` : ''}{group.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-body, inherit)', marginTop: 4 }}>
          ✓ Combined into <b>{done.mainNum ? `${done.mainNum} — ` : ''}{done.mainName}</b>. {done.folded} card{done.folded === 1 ? '' : 's'} folded in as trips in its history.
        </div>
      </div>
    )
  }

  const seg = (active) => ({
    fontFamily: 'var(--font-heading)', fontSize: 11, fontWeight: 800, letterSpacing: '0.03em',
    textTransform: 'uppercase', padding: '6px 11px', cursor: 'pointer',
    border: `1.5px solid ${active ? 'var(--teal, #30cfac)' : 'rgba(28,24,20,0.35)'}`,
    background: active ? 'var(--header-dark)' : 'transparent',
    color: active ? 'var(--teal, #30cfac)' : 'var(--text-primary)',
    flexShrink: 0,
  })

  return (
    <div style={{ border: '1px solid rgba(28,24,20,0.18)', borderRadius: 8, padding: 12, marginBottom: 12, background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{group.num ? `${group.num} · ` : ''}{group.title}</div>
      <div style={{ fontSize: 11, color: 'var(--text-light)', marginBottom: 10, fontFamily: 'var(--font-body, inherit)' }}>
        Shows as {group.cards.length} cards. Mark each <b>Add to Main</b> or <b>Don't Add to Main</b>, then Save. Added cards merge into one job (each becomes a trip); the earliest is the main.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.cards.map(c => {
          const isAdd = choice[c.job_id] === 'add'
          const isMain = isAdd && mainCard && c.job_id === mainCard.job_id
          return (
            <div key={c.job_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 6, background: isAdd ? 'rgba(48,207,172,0.10)' : 'transparent', border: '1px solid rgba(28,24,20,0.12)' }}>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                <button type="button" onClick={() => setChoice(p => ({ ...p, [c.job_id]: 'add' }))} style={{ ...seg(isAdd), borderRadius: '6px 0 0 6px', borderRight: 'none' }}>Add to Main</button>
                <button type="button" onClick={() => setChoice(p => ({ ...p, [c.job_id]: 'no' }))} style={{ ...seg(!isAdd), borderRadius: '0 6px 6px 0' }}>Don't Add</button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.num ? `${c.num} — ` : ''}{c.name}
                  {isMain && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: 'var(--header-dark)', color: 'var(--teal, #30cfac)', fontFamily: 'var(--font-heading)' }}>Main</span>}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-light)' }}>{rangeLabel(c)} · {c.crewDays} crew day{c.crewDays === 1 ? '' : 's'}{c.status ? ` · ${c.status}` : ''}</div>
              </div>
            </div>
          )
        })}
      </div>

      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8, fontFamily: 'var(--font-body, inherit)' }}>{error}</div>}

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="app-act-btn app-act-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <span style={{ fontSize: 11, color: 'var(--text-light)', fontFamily: 'var(--font-body, inherit)' }}>
          {added.length >= 2
            ? `Merges ${added.length} cards into “${mainCard?.name}” (${added.length - 1} fold in).`
            : 'Add at least 2 cards to combine.'}
        </span>
      </div>
    </div>
  )
}

export default function CombineDuplicatesModal({ jobs = [], assignmentsByJobId = {}, onClose, onCombined }) {
  const user = useUser()
  const changedBy = user?.name || 'unknown'
  // Freeze the group list on open. If it recomputed off `jobs`, a just-combined
  // group would vanish the instant you Save — the bug Chris hit. Kept stable so
  // each group stays on screen and shows its result after saving.
  const [groups] = useState(() => findDuplicateJobGroups(jobs, assignmentsByJobId))

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mdl" style={{ maxWidth: 640, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Combine duplicate jobs</h3>
          <button className="app-act-btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontFamily: 'var(--font-body, inherit)', marginBottom: 14 }}>
          These jobs show as more than one card because they were scheduled several times. For each card choose Add to Main or Don't Add, then Save. Nothing is deleted, and you decide every combine.
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
