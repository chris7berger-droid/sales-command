// Mobilizations editor (Phase F, F2a). A mobilization = one trip to site
// (Mob 1, Mob 2…). Schedule OWNS the live job's trips post-send: this modal
// adds/edits them on job_mobilizations directly, never touching the frozen
// proposal or its lock. Two add actions (D3):
//   • + Add trip     — reschedules / adds sold work (is_go_back = false)
//   • + Add Go Back  — a tracked return trip: warranty / added work (is_go_back = true)
//
// The editable row list reads job_mobilizations rows DIRECTLY (loadJobMobilizationRows)
// — NOT the day-derived getJobMobilizations array (audit C1) — so a freshly-added
// dayless go-back is visible and taggable. The day-derived `mobs` prop is used only
// to enrich each row with its tagged-day count.

import { useEffect, useState, useCallback, useRef } from 'react'
import { loadAllRows, loadJobMobilizationRows, addJobMobilization, updateJobMobilization, deleteJobMobilization, countPullTicketsForMob, loadMaterialsCatalog, computeMobCosts } from '../lib/queries'
import { crewLeadNames } from '../lib/crewLeads'
import { useUser } from '../lib/user'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ISO "2026-07-28" → "Jul 28" (local-parse, no TZ shift). null on empty/invalid.
function fmtShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return null
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

function rangeLabel(row) {
  const a = fmtShort(row.start_date)
  const b = fmtShort(row.end_date)
  if (!a && !b) return 'Dates TBD'
  return a && b && row.start_date === row.end_date ? a : `${a || 'TBD'} – ${b || 'TBD'}`
}

// Every mobilization_seq tagged on the job's field-SOW days (across all WTCs; legacy
// flat jobs.field_sow when a job has no WTCs). Used for (a) seq = max+1 over rows AND
// day tags (audit O2), and (b) the delete-time tagged-day scan.
function collectDaySeqs(job) {
  const out = []
  const wtcs = Array.isArray(job?._wtcs) ? job._wtcs : []
  const pushFrom = arr => { if (Array.isArray(arr)) for (const d of arr) { const s = d?.mobilization_seq; if (s != null) out.push(Number(s)) } }
  if (wtcs.length) for (const w of wtcs) pushFrom(w.field_sow)
  else pushFrom(job?.field_sow)
  return out
}

export default function MobsModal({ job, mobs = [], initialEditId = null, initialCreate = false, editOnly = false, onCreate, onClose, onUpdated }) {
  const user = useUser()
  const changedBy = user?.name || 'unknown'

  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The row being edited: { id | null(new), seq, label, start_date, end_date, is_go_back }.
  const [draft, setDraft] = useState(null)
  const openedInitial = useRef(false)
  const [crewNames, setCrewNames] = useState([])
  const [crewError, setCrewError] = useState(null)
  const [crewLoaded, setCrewLoaded] = useState(false)
  const [crewRefresh, setCrewRefresh] = useState(0)
  useEffect(() => {
    let alive = true
    loadAllRows('crew', 'name, archived', { orderBy: 'name' }).then(({ data, error }) => {
      if (!alive) return
      setCrewError(error?.message || null)
      setCrewNames(error ? [] : crewLeadNames(data || []))
      setCrewLoaded(true)
    })
    return () => { alive = false }
  }, [crewRefresh])

  // Tagged-day count per seq, from the day-derived list (read-only enrichment).
  const dayCountBySeq = new Map((mobs || []).map(m => [m.seq, m.dayCount]))

  // Catalog for the go-back cost rollup (F3). Loaded once; cost is derived on read.
  const [catalog, setCatalog] = useState([])
  useEffect(() => {
    let alive = true
    loadMaterialsCatalog().then(({ data }) => { if (alive) setCatalog(data || []) })
    return () => { alive = false }
  }, [])
  const costsBySeq = computeMobCosts(job, catalog)

  const reload = useCallback(async () => {
    const { data, error: loadError } = await loadJobMobilizationRows(job.job_id)
    setError(loadError?.message || null)
    setLoaded(!loadError)
    if (!loadError) setRows(data)
  }, [job.job_id])

  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if ((!initialEditId && !initialCreate) || !loaded || openedInitial.current) return
    openedInitial.current = true
    if (initialCreate) {
      setDraft({ id: null, seq: Math.max(0, ...rows.map(r => r.seq || 0), ...collectDaySeqs(job)) + 1, label: '', start_date: null, end_date: null, is_go_back: false })
      return
    }
    const row = rows.find(r => r.id === initialEditId)
    if (row) setDraft({ ...row })
    else setError('This trip is no longer on this job. Close and refresh the trips list.')
  }, [initialEditId, initialCreate, loaded, rows, job])

  const nextSeq = () => Math.max(0, ...rows.map(r => r.seq || 0), ...collectDaySeqs(job)) + 1

  function startAdd(isGoBack) {
    setError(null)
    setDraft({ id: null, seq: nextSeq(), label: '', start_date: null, end_date: null, is_go_back: isGoBack })
  }

  function startEdit(row) {
    setError(null)
    setDraft({ ...row })
  }

  async function saveDraft() {
    if (!draft || busy) return
    // Validate the range (the <input min> is only a hint, T5 #3): a bad end can't persist.
    if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
      setError('End date can’t be before the start date.')
      return
    }
    if (draft.crew_needed != null && draft.crew_needed !== '' && (!Number.isInteger(Number(draft.crew_needed)) || Number(draft.crew_needed) < 0)) {
      setError('Crew needed must be a whole number of zero or more.')
      return
    }
    setBusy(true); setError(null)
    const payload = { label: draft.label, start_date: draft.start_date, end_date: draft.end_date }
    // Send only edited operational fields; changing dates must not clear them.
    const original = rows.find(r => r.id === draft.id) || {}
    for (const field of ['crew_needed', 'lead', 'vehicle', 'equipment', 'power_source', 'sow', 'note']) {
      if ((draft[field] ?? '') !== (original[field] ?? '')) {
        payload[field] = field === 'crew_needed'
          ? (draft[field] === '' || draft[field] == null ? null : Number(draft[field]))
          : draft[field] || null
      }
    }
    const res = draft.id == null
      ? await addJobMobilization(job.job_id, { seq: draft.seq, ...payload, is_go_back: draft.is_go_back }, changedBy)
      : await updateJobMobilization(job.job_id, { id: draft.id, seq: draft.seq, label: rows.find(r => r.id === draft.id)?.label }, payload, changedBy)
    if (res.error) { setError(res.error.message); setBusy(false); return }
    setDraft(null); setBusy(false)
    await reload()
    onUpdated?.()
    if (initialEditId || initialCreate) onClose()
  }

  async function removeRow(row) {
    if (busy) return
    setBusy(true); setError(null)
    // Part 1 (irreversible pull_tickets CASCADE) is the HARD BLOCK — check it FIRST,
    // before asking the user to confirm anything, so a blocked mob never shows a
    // pointless "delete anyway?" prompt (T5 #1). deleteJobMobilization re-checks it
    // as the authority regardless.
    const { count: ptCount, error: ptErr } = await countPullTicketsForMob(row.id)
    if (ptErr) { setError(ptErr.message); setBusy(false); return }
    if (ptCount > 0) {
      setBusy(false)
      window.alert(
        `Can't delete Mob ${row.seq} — it has ${ptCount} pull ticket${ptCount === 1 ? '' : 's'}. ` +
        `Deleting it would destroy those pull tickets and their numbering. Remove the pull tickets first.`
      )
      return
    }
    // Part 2 (recoverable): warn + confirm on field-SOW day tags.
    const taggedDays = collectDaySeqs(job).filter(s => s === row.seq).length
    if (taggedDays > 0 && !window.confirm(
      `Mob ${row.seq} — ${row.label || '(no label)'} is tagged on ${taggedDays} field-SOW day${taggedDays === 1 ? '' : 's'}. ` +
      `Deleting it leaves those days without a mobilization (you can re-tag them). Delete anyway?`
    )) { setBusy(false); return }
    const res = await deleteJobMobilization(job.job_id, row, changedBy)
    if (res.blocked) {
      // Race: a pull ticket appeared between the pre-check and here. Still honored.
      setBusy(false)
      window.alert(`Can't delete Mob ${row.seq} — it now has ${res.pullTicketCount} pull ticket(s). Remove them first.`)
      return
    }
    if (res.error) { setError(res.error.message); setBusy(false); return }
    setBusy(false)
    await reload()
    onUpdated?.()
  }

  const inp = {
    padding: '6px 8px', fontSize: 12, borderRadius: 5, boxSizing: 'border-box',
    background: 'var(--bg-card)', border: '1px solid rgba(28,24,20,0.22)', color: 'var(--text-primary)',
    fontFamily: 'var(--font-body, inherit)', WebkitAppearance: 'none',
  }
  const lbl = { fontSize: 10, fontWeight: 700, color: 'var(--text-light)', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }
  const secondaryBtn = { background: 'none', border: '1px solid rgba(28,24,20,0.28)', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-heading)', color: 'var(--text-primary)', flexShrink: 0 }
  const deleteBtn = { ...secondaryBtn, border: '1px solid var(--danger)', color: 'var(--danger)' }

  const anyEditing = draft != null

  return (
    <div className="mbg" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="mdl" role="dialog" aria-modal="true" aria-label={initialCreate ? "Create a trip" : initialEditId ? "Edit trip" : "Manage trips"} style={{ maxWidth: 760, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>{initialCreate ? 'Create a trip' : initialEditId ? 'Edit trip' : editOnly ? 'Choose a trip to edit' : 'Trips'} — {job.job_num || ''} {job.job_name || ''}</h3>
          <button className="app-act-btn" disabled={busy} onClick={onClose}>Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-light)', fontFamily: 'var(--font-body, inherit)', marginBottom: 12 }}>
          {initialCreate ? 'Enter this trip’s dates and details. Assign individual crew members in Crew Schedule after saving.' : editOnly ? 'Select a saved trip below to update its dates and details.' : initialEditId ? 'Update this trip’s dates and details. Crew assignments are managed in Crew Schedule.' : 'Manage trips to site. Add another trip or a go-back for warranty or added work.'}
        </div>

        {!initialEditId && !initialCreate && !editOnly && <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="app-act-btn app-act-primary" disabled={!loaded || anyEditing || busy} onClick={() => startAdd(true)}>+ Add Go Back</button>
          <button className="app-act-btn" disabled={!loaded || anyEditing || busy} onClick={() => startAdd(false)}>+ Add trip</button>
        </div>}

        {error && <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--font-body, inherit)', marginBottom: 10 }}>{error} {!loaded && <button className="app-act-btn" onClick={reload}>Retry</button>}</div>}

        {!loaded ? (
          <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '20px 0' }}>Loading…</div>
        ) : rows.length === 0 && !anyEditing ? (
          <div style={{ fontSize: 13, color: 'var(--text-light)', padding: '16px 0' }}>
            {editOnly ? <>No trips saved yet. <button className="app-act-btn app-act-primary" onClick={onCreate}>Create a trip</button></> : 'No trips on this job yet. Add a trip or a go-back above.'}
          </div>
        ) : (
          <div className="mobs-list">
            {rows.filter(row => !initialCreate && (!initialEditId || row.id === initialEditId)).map(row => {
              if (draft && draft.id === row.id) return renderEditor(row.seq)
              const dayCount = dayCountBySeq.get(row.seq)
              return (
                <div key={row.id} className="mobs-row" style={{ borderLeftColor: row.is_go_back ? 'var(--warning)' : 'var(--command-green)' }}>
                  <div className="mobs-seq">Mob {row.seq}</div>
                  <div className="mobs-body">
                    <div className="mobs-label">
                      {row.label || <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>(no label)</span>}
                      {row.is_go_back && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 5, background: 'var(--header-dark)', color: 'var(--teal, #30cfac)', fontFamily: 'var(--font-heading)' }}>Go Back</span>
                      )}
                    </div>
                    <div className="mobs-meta">{dayCount != null ? `${dayCount} day${dayCount === 1 ? '' : 's'} tagged` : 'No days tagged yet'}</div>
                    <div className="mobs-dates">{rangeLabel(row)}</div>
                    {row.is_go_back && (() => {
                      const c = costsBySeq[row.seq]
                      if (!c || c.dayCount === 0) return <div className="mobs-dates" style={{ color: 'var(--text-light)' }}>No cost yet — tag days to this go-back</div>
                      return (
                        <div className="mobs-dates" style={{ color: 'var(--command-green)', fontWeight: 600 }}>
                          Go-back cost: {fmtMoney(c.total)} <span style={{ color: 'var(--text-light)', fontWeight: 400 }}>({fmtMoney(c.materialCost)} materials + {fmtMoney(c.laborCost)} labor)</span>
                          {c.needsRate && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · needs labor rate</span>}
                          {c.unpriced && <span style={{ color: 'var(--warning)', fontWeight: 700 }}> · some materials unpriced</span>}
                        </div>
                      )
                    })()}
                  </div>
                  <button style={secondaryBtn} disabled={anyEditing || busy} onClick={() => startEdit(row)}>Edit</button>
                  {!editOnly && <button style={deleteBtn} disabled={anyEditing || busy} onClick={() => removeRow(row)}>Delete</button>}
                </div>
              )
            })}
            {draft && draft.id == null && renderEditor(draft.seq)}
          </div>
        )}
      </div>
    </div>
  )

  // The existing editor handles both entry points; identity and crew-day links stay fixed.
  function renderEditor(seq) {
    const fields = [['label', 'Trip label', 'text'], ['start_date', 'Start date', 'date'], ['end_date', 'End date', 'date'], ['crew_needed', 'Crew needed', 'number'], ['vehicle', 'Vehicle', 'text'], ['equipment', 'Equipment', 'text'], ['power_source', 'Power source', 'text']]
    return <div key={`edit-${draft.id ?? 'new'}`} className="mobs-row" style={{ display: 'block', borderLeftColor: 'var(--command-green)' }}>
      <h4 style={{ margin: '0 0 12px' }}>Trip {seq}{draft.is_go_back ? ' · Go back' : ''}</h4>
      <p style={{ fontSize: 12, color: 'var(--text-light)' }}>Leave crew, vehicle, equipment, power source, or scope blank to use the job’s value. Assign individual crew members in Crew Schedule.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        {fields.map(([field, label, type]) => <label key={field} style={lbl}>{label}
          <input aria-label={label} type={type} disabled={busy} min={type === 'number' ? 0 : field === 'end_date' ? draft.start_date || '' : undefined} step={type === 'number' ? 1 : undefined} value={draft[field] ?? ''} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))} style={{ ...inp, width: '100%', display: 'block', marginTop: 4 }} />
        </label>)}
        <label style={lbl}>Lead
          <select aria-label="Lead" value={draft.lead || ''} disabled={busy || !crewLoaded || !!crewError} onChange={e => setDraft(d => ({ ...d, lead: e.target.value }))} style={{ ...inp, width: '100%', display: 'block', marginTop: 4 }}>
            <option value="">{!crewLoaded ? 'Loading crew…' : 'Use job lead'}</option>
            {draft.lead && !crewNames.includes(draft.lead) && <option value={draft.lead}>{draft.lead} (current)</option>}
            {crewNames.map(name => <option key={name} value={name}>{name.includes(',') ? name.split(',').reverse().map(s => s.trim()).join(' ') : name}</option>)}
          </select>
        </label>
      </div>
      {crewError && <p role="alert">Couldn’t load crew choices: {crewError} <button className="app-act-btn" onClick={() => setCrewRefresh(n => n + 1)}>Retry crew</button></p>}
      {crewLoaded && !crewError && !crewNames.length && <p>No active crew members available. The existing lead is preserved.</p>}
      {[['sow', 'Scope of work'], ['note', 'Trip notes']].map(([field, label]) => <label key={field} style={{ ...lbl, display: 'block', marginTop: 12 }}>{label}
        <textarea aria-label={label} disabled={busy} value={draft[field] || ''} rows={3} onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))} style={{ ...inp, display: 'block', width: '100%', marginTop: 4, resize: 'vertical' }} />
      </label>)}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="app-act-btn app-act-primary" disabled={busy} onClick={saveDraft}>{busy ? 'Saving…' : 'Save'}</button>
        <button style={secondaryBtn} disabled={busy} onClick={() => { if (initialEditId || initialCreate) onClose(); else { setDraft(null); setError(null) } }}>Cancel</button>
      </div>
    </div>
  }
}
