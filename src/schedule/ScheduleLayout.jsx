// Schedule Command — content-level layout mounted under the host Subcon shell at
// /schedule/*. The host owns the sidebar/header/auth; this layer keeps Schedule's
// own content toolbar (+ Job / Actions), StatsBar, routed views, and modals.
// Everything renders inside `.schedule-root` so App.css/index.css stay fenced
// (Phase 2, Beat 5). Auth/access gate + duplicate sidebar from the old App.jsx
// are dropped — the host handles login, entitlement, and navigation.
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import './index.css'
import { supabase } from '../lib/supabase'
import { ToastProvider, useToast } from './lib/toast'
import { UserProvider, useUser } from './lib/user'
import { ToolbarContext } from './lib/toolbar'
import { searchExistingJobs, getNextMobSeq, addJobMobilization } from './lib/queries'
import { crewLeadNames } from './lib/crewLeads'
import { crewRequirement } from './lib/allocations'
import { printWeekSchedule, printJobList, printMaterialsList, printDailyStatus } from './lib/exports'
import Home from './views/Home'
import Jobs from './views/Jobs'
import Schedule from './views/Schedule'
import Billing from './views/Billing'
import Materials from './views/Materials'
import Calendar from './views/Calendar'
import Daily from './views/Daily'
import Schedules from './views/Schedules'
import ProductionRate from './views/ProductionRate'
import Settings from './views/Settings'
import Import from './views/Import'
import WeeklyCapacityBand from './components/WeeklyCapacityBand'

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

// Providers wrap the shell because the toolbar + modal handlers below consume
// useToast, and the routed views consume useUser (host teamMember).
export default function ScheduleLayout({ teamMember }) {
  // `.schedule-root` wraps the PROVIDERS (not just the shell) so the fence also
  // covers DOM they emit as siblings of the shell — notably ToastProvider's toast
  // node — which would otherwise render outside the scope and lose all its CSS.
  return (
    <div className="schedule-root">
      <ToastProvider>
        <UserProvider teamMember={teamMember}>
          <ScheduleShell />
        </UserProvider>
      </ToastProvider>
    </div>
  )
}

function ScheduleShell() {
  const navigate = useNavigate()
  const toast = useToast()
  const user = useUser()
  const changedBy = user?.name || 'unknown'
  const [modal, setModal] = useState(null)
  const [workTypes, setWorkTypes] = useState([])
  const [crewList, setCrewList] = useState([])
  const [crewLoading, setCrewLoading] = useState(true)
  const [crewLoadError, setCrewLoadError] = useState(false)
  const leadNames = crewLeadNames(crewList)
  const [showArchived, setShowArchived] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // Set by any crew mutation; on modal close we remount the routed view once so
  // headers like "Crew Available" (computed in the view via computeHomeDashboard)
  // reflect the change. A ref, not state, so closeModal reads it synchronously.
  const crewDirtyRef = useRef(false)

  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsRef = useRef(null)

  // The Weekly Crew Capacity band rides along on the functional screens (Crew
  // Schedule / Calendar / Daily / Logistics). Home and Jobs render their own band
  // inside their dashboards, so they're excluded here to avoid a double header.
  const location = useLocation()
  const BAND_PATHS = ['/schedule/schedule', '/schedule/calendar', '/schedule/daily', '/schedule/materials']
  const showCapacityBand = BAND_PATHS.includes(location.pathname)
  // The +Job/Actions buttons ride inside the Weekly Crew Capacity band header on
  // every screen that shows the band (the 4 functional screens + Jobs, which
  // renders its own band). Elsewhere (Home, Billing, …) they keep their own strip.
  const toolbarInBand = showCapacityBand || location.pathname === '/schedule/jobs'

  // Dismiss the Actions menu on any outside click/touch.
  useEffect(() => {
    if (!actionsOpen) return
    const onDoc = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [actionsOpen])

  // Load work types + crew for modals
  const loadModalData = useCallback(async () => {
    setCrewLoading(true)
    setCrewLoadError(false)
    try {
      const [wtRes, crewRes] = await Promise.all([
        supabase.from('work_types').select('*'),
        supabase.from('crew').select('*'),
      ])
      if (wtRes.data) setWorkTypes(wtRes.data.map(w => w.name))
      if (crewRes.error) setCrewLoadError(true)
      else setCrewList(crewRes.data || [])
    } catch {
      setCrewLoadError(true)
    } finally {
      setCrewLoading(false)
    }
  }, [])

  useEffect(() => { loadModalData() }, [loadModalData])

  function closeModal() {
    if (crewDirtyRef.current) { crewDirtyRef.current = false; setRefreshKey(k => k + 1) }
    setModal(null)
  }

  // --- Add to Schedule (add-job-dedup, workstream A) ---
  // The "+ Job" button no longer blind-inserts a jobs row (which produced phantom,
  // Sales-unlinked jobs). It resolves to exactly two outcomes:
  //   1. Pick an existing Sales-linked job from the search dropdown → add a
  //      mobilization (a trip) to it, with an "is this go-back work?" flag.
  //   2. Typed text matches no Sales job → BLOCK ("create it in Sales first").
  // No path here creates a jobs row, so it can never mint a null-call_log_id orphan.
  const [jobSearch, setJobSearch] = useState('')
  const [jobResults, setJobResults] = useState([])
  const [jobSearching, setJobSearching] = useState(false)
  const [pickedJob, setPickedJob] = useState(null)   // { job_id, call_log_id, job_number, customer, job_name }
  const [mobDraft, setMobDraft] = useState(null)      // { label, start_date, end_date, is_go_back, crew_needed, lead, vehicle, equipment, power_source, sow }
  const [addBusy, setAddBusy] = useState(false)

  function openAddJob() {
    loadModalData()
    setJobSearch('')
    setJobResults([])
    setJobSearching(false)
    setPickedJob(null)
    setMobDraft(null)
    setAddBusy(false)
    setModal('job')
  }

  // Debounced search — only while the modal is open and nothing is picked yet.
  useEffect(() => {
    if (modal !== 'job' || pickedJob) return
    const term = jobSearch.trim()
    if (!term) { setJobResults([]); setJobSearching(false); return }
    let alive = true
    setJobSearching(true)
    const t = setTimeout(async () => {
      const { data } = await searchExistingJobs(term)
      if (alive) { setJobResults(data || []); setJobSearching(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [jobSearch, modal, pickedJob])

  function pickJob(r) {
    setPickedJob(r)
    setJobResults([])
    setMobDraft({ label: '', start_date: '', end_date: '', is_go_back: false, crew_needed: '', lead: '', vehicle: '', equipment: '', power_source: '', sow: '' })
  }

  async function doAddMobilization() {
    if (!pickedJob || addBusy) return
    const d = mobDraft
    if (d.start_date && d.end_date && d.end_date < d.start_date) {
      toast('End date can’t be before the start date', 'err'); return
    }
    const crewNeeded = crewRequirement(d.crew_needed)
    if (String(d.crew_needed ?? '').trim() !== '' && crewNeeded == null) {
      toast('Crew needed must be a whole number of zero or more.', 'err'); return
    }
    // Lead is mandatory — every trip/go-back names who's running it (no more
    // lead-blank allocations on the board/calendar).
    if (crewLoading || crewLoadError) {
      toast('Crew list is unavailable. Reload it before adding a trip.', 'err'); return
    }
    if (!leadNames.includes(d.lead)) {
      toast('Pick a crew lead for this trip', 'err'); return
    }
    setAddBusy(true)
    // seq must clear BOTH existing rows AND day-tagged seqs (audit O2) — resolved
    // by the picked job's id, never re-derived from the typed text.
    const { seq, error: seqErr } = await getNextMobSeq(pickedJob.job_id)
    if (seqErr) { console.error(seqErr); setAddBusy(false); toast('Error preparing trip', 'err'); return }
    const { error } = await addJobMobilization(
      pickedJob.job_id,
      {
        seq, label: d.label, start_date: d.start_date || null, end_date: d.end_date || null, is_go_back: d.is_go_back,
        // Per-allocation detail — blank = inherit the job's own value (B87).
        crew_needed: crewNeeded,
        lead: d.lead || null, vehicle: d.vehicle || null, equipment: d.equipment || null,
        power_source: d.power_source || null, sow: d.sow || null,
      },
      changedBy,
    )
    setAddBusy(false)
    if (error) { console.error(error); toast(error.message || 'Error adding trip', 'err'); return }
    toast(d.is_go_back ? 'Go-back added' : 'Trip added', 'ok')
    closeModal()
    // Force the routed view to remount + refetch so the new job shows immediately
    // (the add happens from the shell; the view owns its own data load, and
    // realtime timing isn't guaranteed). Same mechanism as the Refresh button.
    setRefreshKey(k => k + 1)
  }

  // --- Add Crew ---
  const [crewForm, setCrewForm] = useState({})

  function openAddCrew() {
    setCrewForm({ name: '', team: '', phone: '' })
    setModal('crew')
  }

  async function doAddCrew() {
    if (!crewForm.name) { toast('Name required', 'err'); return }
    const row = { name: crewForm.name, team: crewForm.team || 'Floater', phone: crewForm.phone || null }
    const { error } = await supabase.from('crew').insert([row])
    if (error) { console.error(error); toast('Error', 'err'); return }
    toast('Crew added', 'ok')
    crewDirtyRef.current = true
    await loadModalData()
    closeModal()
  }

  // --- Work Types ---
  const [newWt, setNewWt] = useState('')

  async function doAddWorkType() {
    if (!newWt.trim()) return
    const { error } = await supabase.from('work_types').insert([{ name: newWt.trim() }])
    if (error) { console.error(error); return }
    setNewWt('')
    await loadModalData()
  }

  async function doDeleteWorkType(name) {
    const { error } = await supabase.from('work_types').delete().eq('name', name)
    if (error) { console.error(error); return }
    await loadModalData()
  }

  // --- Crew List ---
  const [clForm, setClForm] = useState({ name: '', team: '', phone: '' })

  async function clAdd() {
    if (!clForm.name) return
    const row = { name: clForm.name, team: clForm.team || 'Floater', phone: clForm.phone || null }
    const { error } = await supabase.from('crew').insert([row])
    if (error) { console.error(error); return }
    setClForm({ name: '', team: '', phone: '' })
    crewDirtyRef.current = true
    await loadModalData()
  }

  async function clArchive(name) {
    if (!confirm('Archive ' + flipName(name) + '? They will be hidden from active views.')) return
    const { error } = await supabase.from('crew').update({ archived: true }).eq('name', name)
    if (error) { console.error(error); return }
    crewDirtyRef.current = true
    await loadModalData()
  }

  async function clUnarchive(name) {
    const { error } = await supabase.from('crew').update({ archived: false }).eq('name', name)
    if (error) { console.error(error); return }
    toast(flipName(name) + ' restored', 'ok')
    crewDirtyRef.current = true
    await loadModalData()
  }

  // Crew edit
  const [editingCrew, setEditingCrew] = useState(null) // { name, team, phone, originalName }

  async function clSave() {
    if (!editingCrew) return
    const updates = { team: editingCrew.team, phone: editingCrew.phone }
    if (editingCrew.name !== editingCrew.originalName) {
      updates.name = editingCrew.name
    }
    const { error } = await supabase.from('crew').update(updates).eq('name', editingCrew.originalName)
    if (error) { console.error(error); toast('Error saving', 'err'); return }
    if (editingCrew.name !== editingCrew.originalName) {
      await supabase.from('assignments').update({ crew_name: editingCrew.name }).eq('crew_name', editingCrew.originalName)
      await supabase.from('crew_status').update({ crew_name: editingCrew.name }).eq('crew_name', editingCrew.originalName)
    }
    toast('Crew updated', 'ok')
    setEditingCrew(null)
    crewDirtyRef.current = true
    await loadModalData()
  }

  async function clDelete(name) {
    if (!confirm('Delete ' + flipName(name) + '? This cannot be undone.')) return
    await supabase.from('assignments').delete().eq('crew_name', name)
    await supabase.from('crew_status').delete().eq('crew_name', name)
    const { error } = await supabase.from('crew').delete().eq('name', name)
    if (error) { console.error(error); toast('Error', 'err'); return }
    toast(flipName(name) + ' deleted', 'wrn')
    crewDirtyRef.current = true
    await loadModalData()
  }

  // --- Refresh --- Reload modal data AND remount the routed view (via the key bump
  // on <main> below) so it re-runs its mount-time fetches. This refetches whatever
  // view you're on without a full window.location.reload() of the whole merged app
  // (which the §2 pre-flight flagged to drop) — and, unlike a plain soft-refresh,
  // it does NOT leave the non-realtime views (Calendar/Daily/Billing/…) stale.
  function handleRefresh() {
    loadModalData()
    setRefreshKey(k => k + 1)
    toast('Refreshed', 'ok')
  }

  const activeCrew = crewList.filter(c => !c.archived)
  const archivedCrew = crewList.filter(c => c.archived)

  // Built once here (owns actionsRef + all handlers), then either dropped into the
  // capacity band's header via context, or rendered in its own strip on screens
  // without a band. Only one render site is live per route.
  const toolbarActions = (
    <div className="app-header-actions">
      <button className="app-act-btn app-act-primary" onClick={openAddJob}>+ Job</button>
      <div className="app-actions-menu" ref={actionsRef}>
        <button className="app-act-btn" onClick={() => setActionsOpen(o => !o)}>Actions ▾</button>
        {actionsOpen && (
          <div className="app-actions-dropdown">
            <button onClick={() => { setActionsOpen(false); handleRefresh() }}>Refresh</button>
            <button onClick={() => { setActionsOpen(false); openAddCrew() }}>+ Crew</button>
            <button onClick={() => { setActionsOpen(false); setModal('workTypes') }}>Work Types</button>
            <button onClick={() => { setActionsOpen(false); setModal('crewList') }}>Crew List</button>
            <button onClick={() => { setActionsOpen(false); navigate('/schedule/schedules') }}>Send Schedules</button>
            <button onClick={() => { setActionsOpen(false); setModal('export') }}>Export</button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <ToolbarContext.Provider value={toolbarActions}>
      {!toolbarInBand && <div className="app-schedule-toolbar">{toolbarActions}</div>}
      {showCapacityBand && location.pathname !== '/schedule/schedule' && <WeeklyCapacityBand key={`capacity-band-${refreshKey}`} />}
      <main className="app-main" key={refreshKey}>
        <Routes>
          <Route index element={<Navigate to="/schedule/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="billing" element={<Billing />} />
          {/* Forecast + Budget folded into Finance/Billing (reskin chunk 1);
              keep external/bookmarked deep links alive via redirect, no 404. */}
          <Route path="billing/forecast" element={<Navigate to="/schedule/billing?tab=forecast" replace />} />
          <Route path="materials" element={<Materials />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="daily" element={<Daily />} />
          <Route path="schedules" element={<Schedules />} />
          <Route path="production-rate" element={<ProductionRate />} />
          <Route path="budget" element={<Navigate to="/schedule/billing?tab=budget" replace />} />
          <Route path="settings" element={<Settings />} />
          <Route path="import" element={<Import />} />
          <Route path="*" element={<Navigate to="/schedule/home" replace />} />
        </Routes>
      </main>

      {/* Add to Schedule Modal (add-job-dedup) — search a Sales-linked job → add a
          mobilization; typed text with no match blocks ("create it in Sales first"). */}
      {modal === 'job' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Add to Schedule</h3>

            {!pickedJob && (
              <>
                <div className="mfr">
                  <input
                    autoFocus
                    placeholder="🔎 Search existing job by #, customer…"
                    value={jobSearch}
                    onChange={e => setJobSearch(e.target.value)}
                  />
                </div>
                {jobResults.length > 0 && (
                  <div className="mwt-list">
                    {jobResults.map(r => (
                      <div key={`${r.call_log_id}-${r.job_id}`} className="mwt-row" style={{ cursor: 'pointer' }} onClick={() => pickJob(r)}>
                        <span><b>#{r.job_number}</b>{r.customer ? ` · ${r.customer}` : ''}{r.job_name ? ` · ${r.job_name}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
                {jobSearch.trim() && jobSearching && (
                  <div className="mfr-label" style={{ color: 'var(--sand-dark)' }}>Searching…</div>
                )}
                {jobSearch.trim() && !jobSearching && jobResults.length === 0 && (
                  <div className="mfr-label" style={{ color: 'var(--sand-dark)' }}>
                    {/^\d+$/.test(jobSearch.trim())
                      ? `Job #${jobSearch.trim()} isn’t in Sales yet — create it in Sales first.`
                      : 'No matching job — create it in Sales first.'}
                  </div>
                )}
                <div className="macts">
                  <button className="app-act-btn" onClick={closeModal}>Cancel</button>
                </div>
              </>
            )}

            {pickedJob && mobDraft && (
              <>
                <div className="mfr-label">
                  ▸ Job #{pickedJob.job_number}{pickedJob.customer ? ` · ${pickedJob.customer}` : ''}{pickedJob.job_name ? ` · ${pickedJob.job_name}` : ''}
                </div>
                <div className="mfr">
                  <label className="mchk"><input type="checkbox" checked={mobDraft.is_go_back} onChange={e => setMobDraft(p => ({ ...p, is_go_back: e.target.checked }))} /> Is this go-back work?</label>
                </div>
                <div className="mfr">
                  <input placeholder="Trip label (optional)" value={mobDraft.label} onChange={e => setMobDraft(p => ({ ...p, label: e.target.value }))} />
                </div>
                <div className="mfr">
                  <input type="date" value={mobDraft.start_date} onChange={e => setMobDraft(p => ({ ...p, start_date: e.target.value }))} />
                  <input type="date" value={mobDraft.end_date} onChange={e => setMobDraft(p => ({ ...p, end_date: e.target.value }))} />
                </div>
                {/* Per-allocation crew + scope (B87). Blank = inherit the job's own.
                    A go-back can run a different crew/scope than the first run. */}
                <div className="mfr-label" style={{ color: 'var(--sand-dark)', marginTop: 4 }}>
                  Lead required. Other blank fields use the job’s values.
                </div>
                <div className="mfr">
                  <input type="number" min="0" step="1" placeholder="Crew #" value={mobDraft.crew_needed} onChange={e => setMobDraft(p => ({ ...p, crew_needed: e.target.value }))} />
                  <select aria-label="Crew lead" required disabled={crewLoading || crewLoadError || !leadNames.length} value={mobDraft.lead} onChange={e => setMobDraft(p => ({ ...p, lead: e.target.value }))}>
                    <option value="">{crewLoading ? 'Loading crew…' : crewLoadError ? 'Crew unavailable' : !leadNames.length ? 'No active crew' : 'Lead (required)…'}</option>
                    {leadNames.map(n => <option key={n} value={n}>{flipName(n)}</option>)}
                  </select>
                </div>
                {crewLoadError && <div className="mfr" role="alert"><span>Couldn’t load the crew list.</span><button className="app-act-btn" onClick={loadModalData}>Retry</button></div>}
                {!crewLoading && !crewLoadError && !leadNames.length && <p className="mfr-label" role="status">Add or restore a crew member in Actions → Crew List first.</p>}
                <div className="mfr">
                  <input placeholder="Vehicle" value={mobDraft.vehicle} onChange={e => setMobDraft(p => ({ ...p, vehicle: e.target.value }))} />
                  <input placeholder="Equipment" value={mobDraft.equipment} onChange={e => setMobDraft(p => ({ ...p, equipment: e.target.value }))} />
                </div>
                <div className="mfr">
                  <input placeholder="Power source" value={mobDraft.power_source} onChange={e => setMobDraft(p => ({ ...p, power_source: e.target.value }))} />
                </div>
                <div className="mfr">
                  <textarea placeholder="Scope of work (optional)" rows={2} value={mobDraft.sow} onChange={e => setMobDraft(p => ({ ...p, sow: e.target.value }))} />
                </div>
                <div className="macts">
                  <button className="app-act-btn" onClick={() => { setPickedJob(null); setMobDraft(null) }}>Back</button>
                  <button className="app-act-btn app-act-primary" disabled={addBusy || crewLoading || crewLoadError || !leadNames.includes(mobDraft.lead)} onClick={doAddMobilization}>{mobDraft.is_go_back ? 'Add Go-Back' : 'Add Trip'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Crew Modal */}
      {modal === 'crew' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Add Crew</h3>
            <div className="mfr">
              <input placeholder="Name (Last, First)" value={crewForm.name || ''} onChange={e => setCrewForm(p => ({ ...p, name: e.target.value }))} />
              <input placeholder="Team # or Floater" value={crewForm.team || ''} onChange={e => setCrewForm(p => ({ ...p, team: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Phone (optional)" value={crewForm.phone || ''} onChange={e => setCrewForm(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Cancel</button>
              <button className="app-act-btn app-act-primary" onClick={doAddCrew}>Add</button>
            </div>
          </div>
        </div>
      )}

      {/* Work Types Modal */}
      {modal === 'workTypes' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Work Types</h3>
            <div className="mwt-list">
              {workTypes.map(wt => (
                <div key={wt} className="mwt-row">
                  <span>{wt}</span>
                  <button className="mwt-del" onClick={() => doDeleteWorkType(wt)}>{'✕'}</button>
                </div>
              ))}
            </div>
            <div className="mfr">
              <input placeholder="New work type" value={newWt} onChange={e => setNewWt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') doAddWorkType() }} />
              <button className="app-act-btn app-act-primary" onClick={doAddWorkType}>Add</button>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Crew List Modal */}
      {modal === 'crewList' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl mdl-wide">
            <h3>Crew List</h3>
            <table className="mcl-tbl">
              <thead>
                <tr><th>Name</th><th>Team</th><th>Phone</th><th style={{ width: 140 }}>Actions</th></tr>
              </thead>
              <tbody>
                {activeCrew.map(c => {
                  const isEditing = editingCrew && editingCrew.originalName === c.name
                  return (
                    <tr key={c.name}>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.name} onChange={e => setEditingCrew(p => ({ ...p, name: e.target.value }))} /> : flipName(c.name)}</td>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.team} onChange={e => setEditingCrew(p => ({ ...p, team: e.target.value }))} /> : (c.team || '—')}</td>
                      <td>{isEditing ? <input className="mcl-inp" value={editingCrew.phone || ''} onChange={e => setEditingCrew(p => ({ ...p, phone: e.target.value }))} /> : (c.phone || '—')}</td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        {isEditing ? (
                          <>
                            <button className="app-act-btn app-act-sm" style={{ background: 'var(--command-green)', color: '#fff', borderColor: 'var(--command-green)' }} onClick={clSave}>Save</button>
                            <button className="app-act-btn app-act-sm" onClick={() => setEditingCrew(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="app-act-btn app-act-sm" onClick={() => setEditingCrew({ name: c.name, team: c.team || '', phone: c.phone || '', originalName: c.name })}>Edit</button>
                            <button className="app-act-btn app-act-sm" onClick={() => clArchive(c.name)}>Archive</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {activeCrew.length === 0 && <div className="mcl-empty">No active crew members</div>}
            <div className="mcl-add">
              <div className="mfr-label">Add New</div>
              <div className="mfr">
                <input placeholder="Name (Last, First)" value={clForm.name} onChange={e => setClForm(p => ({ ...p, name: e.target.value }))} />
                <input placeholder="Team # or Floater" value={clForm.team} onChange={e => setClForm(p => ({ ...p, team: e.target.value }))} />
                <input placeholder="Phone" value={clForm.phone} onChange={e => setClForm(p => ({ ...p, phone: e.target.value }))} />
                <button className="app-act-btn app-act-primary" onClick={clAdd}>Add</button>
              </div>
            </div>
            <div className="mcl-archived-toggle" onClick={() => setShowArchived(!showArchived)}>
              Archived ({archivedCrew.length}) {showArchived ? '▴' : '▾'}
            </div>
            {showArchived && archivedCrew.map(c => (
              <div key={c.name} className="mcl-arch-row">
                <span>{flipName(c.name)}</span>
                <button className="app-act-btn app-act-sm" onClick={() => clUnarchive(c.name)}>Restore</button>
              </div>
            ))}
            {showArchived && archivedCrew.length === 0 && <div className="mcl-empty">No archived crew members</div>}
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Menu */}
      {modal === 'export' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Export</h3>
            <div className="mwt-list">
              <div className="mwt-row" onClick={() => { printWeekSchedule(); closeModal() }}>Week Schedule</div>
              <div className="mwt-row" onClick={() => { printJobList(); closeModal() }}>Job List</div>
              <div className="mwt-row" onClick={() => { printMaterialsList(); closeModal() }}>Materials List</div>
              <div className="mwt-row" onClick={() => { printDailyStatus(); closeModal() }}>Daily Crew Status</div>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      )}
    </ToolbarContext.Provider>
  )
}
