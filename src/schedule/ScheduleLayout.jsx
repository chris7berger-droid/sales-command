// Schedule Command — content-level layout mounted under the host Subcon shell at
// /schedule/*. The host owns the sidebar/header/auth; this layer keeps Schedule's
// own content toolbar (+ Job / Actions), StatsBar, routed views, and modals.
// Everything renders inside `.schedule-root` so App.css/index.css stay fenced
// (Phase 2, Beat 5). Auth/access gate + duplicate sidebar from the old App.jsx
// are dropped — the host handles login, entitlement, and navigation.
import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'
import './index.css'
import { supabase } from '../lib/supabase'
import { ToastProvider, useToast } from './lib/toast'
import { UserProvider } from './lib/user'
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
import JobDetail from './views/JobDetail'
import Settings from './views/Settings'
import Import from './views/Import'

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
  const toast = useToast()
  const [modal, setModal] = useState(null)
  const [workTypes, setWorkTypes] = useState([])
  const [crewList, setCrewList] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsRef = useRef(null)

  // Dismiss the Actions menu on any outside click/touch.
  useEffect(() => {
    if (!actionsOpen) return
    const onDoc = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [actionsOpen])

  // Load work types + crew for modals
  const loadModalData = useCallback(async () => {
    const [wtRes, crewRes] = await Promise.all([
      supabase.from('work_types').select('*'),
      supabase.from('crew').select('*'),
    ])
    if (wtRes.data) setWorkTypes(wtRes.data.map(w => w.name))
    if (crewRes.data) setCrewList(crewRes.data)
  }, [])

  useEffect(() => { loadModalData() }, [loadModalData])

  function closeModal() { setModal(null) }

  // --- Add Job ---
  const [jobForm, setJobForm] = useState({})
  const [jobWtSelected, setJobWtSelected] = useState([])
  const [wtDropOpen, setWtDropOpen] = useState(false)

  function openAddJob() {
    setJobForm({ job_num: '', job_name: '', amount: '', crew_needed: '3', lead: '', vehicle: '', equipment: '', power_source: '', sow: '', start_date: '', end_date: '', prevailing_wage: false })
    setJobWtSelected([])
    setWtDropOpen(false)
    setModal('job')
  }

  async function doAddJob() {
    const f = jobForm
    const row = {
      job_num: f.job_num || 'NEW',
      job_name: f.job_name || 'Untitled',
      // jobs.amount is a NUMERIC column — store the raw number (strip any $ / commas),
      // null when blank. (The old '$'+amount wrote a string and always failed insert.)
      amount: f.amount ? (Number(String(f.amount).replace(/[$,]/g, '')) || null) : null,
      work_type: jobWtSelected.join(','),
      crew_needed: f.crew_needed || '',
      lead: f.lead,
      vehicle: f.vehicle,
      equipment: f.equipment,
      power_source: f.power_source,
      sow: f.sow,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      prevailing_wage: f.prevailing_wage ? 'Yes' : 'No',
      status: 'Scheduled',
    }
    const { error } = await supabase.from('jobs').insert([row])
    if (error) { console.error(error); toast(`Couldn’t add job: ${error.message}`, 'err'); return }
    toast('Job added', 'ok')
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
    await loadModalData()
  }

  async function clArchive(name) {
    if (!confirm('Archive ' + flipName(name) + '? They will be hidden from active views.')) return
    const { error } = await supabase.from('crew').update({ archived: 'Yes' }).eq('name', name)
    if (error) { console.error(error); return }
    await loadModalData()
  }

  async function clUnarchive(name) {
    const { error } = await supabase.from('crew').update({ archived: 'No' }).eq('name', name)
    if (error) { console.error(error); return }
    toast(flipName(name) + ' restored', 'ok')
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
    await loadModalData()
  }

  async function clDelete(name) {
    if (!confirm('Delete ' + flipName(name) + '? This cannot be undone.')) return
    await supabase.from('assignments').delete().eq('crew_name', name)
    await supabase.from('crew_status').delete().eq('crew_name', name)
    const { error } = await supabase.from('crew').delete().eq('name', name)
    if (error) { console.error(error); toast('Error', 'err'); return }
    toast(flipName(name) + ' deleted', 'wrn')
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

  const activeCrew = crewList.filter(c => c.archived !== 'Yes')
  const archivedCrew = crewList.filter(c => c.archived === 'Yes')

  return (
    <>
      <div className="app-schedule-toolbar">
        <div className="app-header-actions">
          <button className="app-act-btn app-act-primary" onClick={openAddJob}>+ Job</button>
          <div className="app-actions-menu" ref={actionsRef} onMouseLeave={() => setActionsOpen(false)}>
            <button className="app-act-btn" onClick={() => setActionsOpen(o => !o)}>Actions ▾</button>
            {actionsOpen && (
              <div className="app-actions-dropdown">
                <button onClick={() => { setActionsOpen(false); handleRefresh() }}>Refresh</button>
                <button onClick={() => { setActionsOpen(false); openAddCrew() }}>+ Crew</button>
                <button onClick={() => { setActionsOpen(false); setModal('workTypes') }}>Work Types</button>
                <button onClick={() => { setActionsOpen(false); setModal('crewList') }}>Crew List</button>
                <button onClick={() => { setActionsOpen(false); setModal('sendSchedules') }}>Send Schedules</button>
                <button onClick={() => { setActionsOpen(false); setModal('export') }}>Export</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <main className="app-main" key={refreshKey}>
        <Routes>
          <Route index element={<Navigate to="/schedule/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/:jobId" element={<JobDetail />} />
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

      {/* Add Job Modal */}
      {modal === 'job' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Add Job</h3>
            <div className="mfr">
              <input placeholder="Job #" value={jobForm.job_num || ''} onChange={e => setJobForm(p => ({ ...p, job_num: e.target.value }))} />
              <input placeholder="Customer Name" value={jobForm.job_name || ''} onChange={e => setJobForm(p => ({ ...p, job_name: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Proposal $" value={jobForm.amount || ''} onChange={e => setJobForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="mfr-label">Work Types</div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => setWtDropOpen(o => !o)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '7px 10px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                  border: '1px solid rgba(28,24,20,0.2)', background: 'var(--bg-card)',
                  fontFamily: 'var(--font-body)', color: jobWtSelected.length ? 'var(--text-primary)' : 'var(--sand-dark)',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {jobWtSelected.length ? `${jobWtSelected.length} selected — ${jobWtSelected.join(', ')}` : 'Select work types…'}
                </span>
                <span style={{ flexShrink: 0, marginLeft: 8 }}>▾</span>
              </button>
              {wtDropOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4,
                  maxHeight: 200, overflowY: 'auto', background: 'var(--bg-card)',
                  border: '1px solid rgba(28,24,20,0.2)', borderRadius: 8, boxShadow: '0 6px 20px rgba(28,24,20,0.18)',
                }}>
                  {workTypes.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--sand-dark)' }}>No work types yet.</div>}
                  {workTypes.map(wt => (
                    <label key={wt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid rgba(28,24,20,0.06)' }}>
                      <input
                        type="checkbox"
                        checked={jobWtSelected.includes(wt)}
                        onChange={() => setJobWtSelected(p => p.includes(wt) ? p.filter(x => x !== wt) : [...p, wt])}
                        style={{ width: 13, height: 13, flexShrink: 0 }}
                      />
                      {wt}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="mfr">
              <input type="number" min="1" placeholder="Crew#" value={jobForm.crew_needed || ''} onChange={e => setJobForm(p => ({ ...p, crew_needed: e.target.value }))} />
              <input placeholder="Lead/Sales" value={jobForm.lead || ''} onChange={e => setJobForm(p => ({ ...p, lead: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Vehicle" value={jobForm.vehicle || ''} onChange={e => setJobForm(p => ({ ...p, vehicle: e.target.value }))} />
              <input placeholder="Equipment" value={jobForm.equipment || ''} onChange={e => setJobForm(p => ({ ...p, equipment: e.target.value }))} />
            </div>
            <div className="mfr">
              <input placeholder="Power Source" value={jobForm.power_source || ''} onChange={e => setJobForm(p => ({ ...p, power_source: e.target.value }))} />
              <input placeholder="Scope of Work" value={jobForm.sow || ''} onChange={e => setJobForm(p => ({ ...p, sow: e.target.value }))} />
            </div>
            <div className="mfr">
              <input type="date" value={jobForm.start_date || ''} onChange={e => setJobForm(p => ({ ...p, start_date: e.target.value }))} />
              <input type="date" value={jobForm.end_date || ''} onChange={e => setJobForm(p => ({ ...p, end_date: e.target.value }))} />
            </div>
            <div className="mfr">
              <label className="mchk"><input type="checkbox" checked={jobForm.prevailing_wage || false} onChange={e => setJobForm(p => ({ ...p, prevailing_wage: e.target.checked }))} /> Prevailing Wage</label>
            </div>
            <div className="macts">
              <button className="app-act-btn" onClick={closeModal}>Cancel</button>
              <button className="app-act-btn app-act-primary" onClick={doAddJob}>Add</button>
            </div>
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

      {/* Send Schedules - placeholder */}
      {modal === 'sendSchedules' && (
        <div className="mbg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="mdl">
            <h3>Send Schedules</h3>
            <p style={{ fontSize: 12, color: 'var(--sand-dark)' }}>Crew card flipper not yet built. This will open the Schedules view card sender.</p>
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
    </>
  )
}
