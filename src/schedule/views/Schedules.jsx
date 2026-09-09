import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { C, F } from '../../lib/tokens'
import { loadJobs, loadAllRows, loadMobilizationsByJobId } from '../lib/queries'
import { fmtD, getMonday } from '../lib/weeks'
import { buildCrewWeekText, crewDateLabel, crewDisplayName, crewWeekDates } from '../lib/crewWeekText'

export default function Schedules() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('week')
  const validWeek = /^\d{4}-\d{2}-\d{2}$/.test(requested || '') &&
    !Number.isNaN(new Date(`${requested}T12:00:00`).getTime())
  const week = crewWeekDates(validWeek ? requested : fmtD(getMonday(new Date())))[0]
  const dates = useMemo(() => crewWeekDates(week), [week])
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)
  const [selectedName, setSelectedName] = useState('')
  const [defaultStart, setDefaultStart] = useState('')
  const [copyMsg, setCopyMsg] = useState('')

  useEffect(() => {
    let stale = false
    async function load() {
      setError(null)
      setSnapshot(null)
      try {
        const [jobRes, crewRes, asgnRes] = await Promise.all([
          loadJobs(),
          loadAllRows('crew', 'name, archived', { orderBy: 'name' }),
          loadAllRows('assignments', 'id, job_id, mobilization_id, crew_name, date', {
            orderBy: 'id', filterFn: q => q.gte('date', dates[0]).lte('date', dates.at(-1)),
          }),
        ])
        if (jobRes.error || crewRes.error || asgnRes.error) throw jobRes.error || crewRes.error || asgnRes.error
        const allocations = await loadMobilizationsByJobId(jobRes.data, { liveOnly: true, throwOnError: true })
        if (!stale) setSnapshot({ week, jobs: jobRes.data, crew: crewRes.data,
          assignments: asgnRes.data, allocations, updatedAt: new Date(), retry })
      } catch (err) {
        if (!stale) setError(err.message || 'Could not load weekly schedules.')
      }
    }
    load()
    return () => { stale = true }
  }, [week, dates, retry])

  const ready = snapshot?.week === week && snapshot?.retry === retry && !error
  const names = useMemo(() => {
    if (!snapshot) return []
    // Include assigned people missing from the roster; never lose work.
    return [...new Set([...snapshot.crew.filter(c => !c.archived).map(c => c.name),
      ...snapshot.assignments.map(a => a.crew_name)].filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }, [snapshot])
  const name = names.includes(selectedName) ? selectedName : names[0] || ''
  const message = useMemo(() => ready && name ? buildCrewWeekText({ ...snapshot, name, dates, defaultStart }) : null,
    [ready, snapshot, name, dates, defaultStart])

  function moveWeek(offset) {
    const next = new Date(`${week}T12:00:00`)
    next.setDate(next.getDate() + offset * 7)
    setParams({ week: fmtD(next) })
    setCopyMsg('')
  }
  function chooseName(value) { setSelectedName(value); setCopyMsg('') }
  async function copy() {
    if (!message) return
    try {
      await navigator.clipboard.writeText(message.text)
      setCopyMsg(`Copied ${crewDisplayName(name)}’s week — paste it into Messages.`)
    } catch {
      setCopyMsg('Clipboard unavailable. Select the preview text and copy it manually.')
    }
  }

  return (
    <section className="crew-text">
      <h1>Weekly crew texts</h1>
      <p>Choose a person, review their week, then copy one text to send in Messages.</p>
      <div className="crew-text-nav">
        <button onClick={() => moveWeek(-1)}>← Prev week</button>
        <label>Week of<input aria-label="Week of" type="date" value={week}
          onChange={e => { if (e.target.value) { setParams({ week: e.target.value }); setCopyMsg('') } }} /></label>
        <button onClick={() => moveWeek(1)}>Next week →</button>
      </div>
      <p>{crewDateLabel(dates[0])} – {crewDateLabel(dates.at(-1))}</p>
      {error ? <div role="alert">Could not load a complete schedule: {error}
        <button onClick={() => setRetry(n => n + 1)}>Retry</button></div> :
        !ready ? <p role="status">Loading weekly schedules…</p> : <>
          <div className="crew-text-nav">
            <label className="crew-text-person">Crew member<select aria-label="Crew member" value={name} onChange={e => chooseName(e.target.value)}>
              {names.map(n => <option key={n} value={n}>{crewDisplayName(n)}</option>)}
            </select></label>
            <button disabled={!names.length} onClick={() => chooseName(names[(names.indexOf(name) - 1 + names.length) % names.length])}>← Previous person</button>
            <button disabled={!names.length} onClick={() => chooseName(names[(names.indexOf(name) + 1) % names.length])}>Next person →</button>
            <button onClick={() => { setRetry(n => n + 1); setCopyMsg('') }}>Refresh</button>
          </div>
          <label>Usual start / meeting instructions (optional)
            <input value={defaultStart} placeholder="e.g. Meet at shop at 6:30 AM"
              onChange={e => { setDefaultStart(e.target.value); setCopyMsg('') }} />
          </label>
          <p className="crew-text-hint">Applies to this preview and the next person. Saved delayed starts take priority.</p>
          {message?.warnings.length > 0 && <div className="crew-text-review" role="note">
            <strong>Check before sending</strong>
            <ul>{message.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </div>}
          {message ? <>
            <button className="crew-text-copy" onClick={copy}>Copy {crewDisplayName(name)}’s week</button>
            <p role="status">{copyMsg}</p>
            <label>Text preview<textarea readOnly value={message.text} aria-label="Text preview" /></label>
          </> : <p>No crew found.</p>}
        </>}
      <style>{`
        .crew-text { max-width: 760px; margin: 0 auto; padding: 20px 16px 40px; color: ${C.textBody}; font-family: ${F.body}; }
        .crew-text h1 { font-family: ${F.display}; text-transform: uppercase; color: ${C.textHead}; }
        .crew-text p { margin: 10px 0; }
        .crew-text-nav { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; margin: 18px 0; }
        .crew-text label { display: block; font-weight: 600; }
        .crew-text-person { flex: 1; min-width: 160px; }
        .crew-text input, .crew-text select, .crew-text textarea { display: block; width: 100%; margin-top: 6px; padding: 12px; border: 1px solid ${C.borderStrong}; border-radius: 8px; background: ${C.linenDeep}; color: ${C.textHead}; font: inherit; }
        .crew-text select { appearance: auto; -webkit-appearance: auto; }
        .crew-text button { padding: 12px 16px; border: 1px solid ${C.borderStrong}; border-radius: 8px; background: ${C.linenCard}; color: ${C.textHead}; font-weight: 700; cursor: pointer; }
        .crew-text button:disabled { opacity: .5; cursor: default; }
        .crew-text button:focus-visible, .crew-text input:focus-visible, .crew-text select:focus-visible, .crew-text textarea:focus-visible { outline: 2px solid ${C.tealDark}; outline-offset: 3px; }
        .crew-text .crew-text-copy { width: 100%; background: ${C.teal}; color: ${C.dark}; margin-top: 16px; }
        .crew-text textarea { min-height: 540px; line-height: 1.55; resize: vertical; font-weight: 400; }
        .crew-text-hint { font-size: 13px; color: ${C.textLight}; }
        .crew-text-review { padding: 14px; border-left: 4px solid ${C.amber}; background: ${C.linenCard}; border-radius: 6px; }
        .crew-text-review ul { margin: 8px 0 0; padding-left: 20px; font-size: 14px; }
        @media(max-width: 480px) { .crew-text { padding: 16px 10px; } .crew-text-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .crew-text-nav label { grid-column: 1 / -1; grid-row: 1; } .crew-text button { padding: 10px; } }
      `}</style>
    </section>
  )
}
