import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { C, F } from '../../lib/tokens'
import { loadJobs, loadAllRows, loadMobilizationsByJobId } from '../lib/queries'
import { fmtD, getMonday } from '../lib/weeks'
import { DEFAULT_CREW_START, buildCrewWeekText, crewDateLabel, crewDisplayName, crewWeekDates } from '../lib/crewWeekText'

export default function Schedules() {
  const navigate = useNavigate()
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
  const [defaultStart, setDefaultStart] = useState(DEFAULT_CREW_START)
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
      <button className="crew-text-back" onClick={() => navigate(`/schedule/schedule?week=${week}`)}>← Back to Crew Schedule</button>
      <header className="crew-text-header">
      <div><div className="crew-text-eyebrow">CREW COMMUNICATION</div><h1>Weekly crew texts</h1>
      <p>Choose a person, review their week, then copy one text to send in Messages.</p>
      </div></header>
      <div className="crew-text-week">
      <div className="crew-text-nav">
        <button onClick={() => moveWeek(-1)}>← Prev week</button>
        <label>Week of<input aria-label="Week of" type="date" value={week}
          onChange={e => { if (e.target.value) { setParams({ week: e.target.value }); setCopyMsg('') } }} /></label>
        <button onClick={() => moveWeek(1)}>Next week →</button>
      </div>
      <p className="crew-text-range">{crewDateLabel(dates[0])} – {crewDateLabel(dates.at(-1))}</p>
      </div>
      {error ? <div role="alert">Could not load a complete schedule: {error}
        <button onClick={() => setRetry(n => n + 1)}>Retry</button></div> :
        !ready ? <p role="status">Loading weekly schedules…</p> : <div className="crew-text-workspace">
          <div className="crew-text-controls">
          <h2>Prepare the message</h2>
          <div className="crew-text-nav crew-text-people">
            <label className="crew-text-person">Crew member<select aria-label="Crew member" value={name} onChange={e => chooseName(e.target.value)}>
              {names.map(n => <option key={n} value={n}>{crewDisplayName(n)}</option>)}
            </select></label>
            <button disabled={!names.length} onClick={() => chooseName(names[(names.indexOf(name) - 1 + names.length) % names.length])}>← Previous person</button>
            <button disabled={!names.length} onClick={() => chooseName(names[(names.indexOf(name) + 1) % names.length])}>Next person →</button>
            <button onClick={() => { setRetry(n => n + 1); setCopyMsg('') }}>Refresh</button>
          </div>
          <label>Usual start / meeting instructions (optional)
            <input value={defaultStart} placeholder={DEFAULT_CREW_START}
              onChange={e => { setDefaultStart(e.target.value); setCopyMsg('') }} />
          </label>
          <p className="crew-text-hint">Applies to this preview and the next person. Saved delayed starts take priority.</p>
          {message?.warnings.length > 0 && <div className="crew-text-review" role="note">
            <strong>Check before sending</strong>
            <ul>{message.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </div>}
          </div>
          <div className="crew-text-preview">
          <div className="crew-text-preview-heading"><div><div className="crew-text-eyebrow">MESSAGE PREVIEW</div>
          <h2>{name ? crewDisplayName(name) + '’s week' : 'Text preview'}</h2></div>
          <span className="crew-text-hint">One text · Mon–Sun</span></div>
          {message ? <>
            <button className="crew-text-copy" onClick={copy}>Copy {crewDisplayName(name)}’s week</button>
            <p className="crew-text-feedback" role="status">{copyMsg || "Copy, then paste into Messages to send."}</p>
            <label>Text preview<textarea readOnly value={message.text} aria-label="Text preview" /></label>
          </> : <p>No crew found.</p>}
          </div>
        </div>}
      <style>{`
        .crew-text { max-width: 1180px; margin: 0 auto; padding: 12px 24px 32px; color: ${C.textBody}; font-family: ${F.body}; }
        .crew-text h1 { font: 800 34px/1.1 ${F.display}; text-transform: uppercase; color: ${C.textHead}; margin: 5px 0 8px; }
        .crew-text h2 { font: 700 23px/1.2 ${F.display}; color: ${C.textHead}; margin: 0 0 16px; }
        .crew-text p { margin: 8px 0; line-height: 1.5; }
        .crew-text-eyebrow { font: 700 11px ${F.ui}; letter-spacing: .12em; color: ${C.textMuted}; }
        .crew-text-header { margin: 22px 0; }
        .crew-text-week { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-top: 1px solid ${C.borderStrong}; border-bottom: 1px solid ${C.borderStrong}; padding: 14px 0; margin-bottom: 24px; }
        .crew-text-range { color: ${C.textMuted}; font-size: 14px; }
        .crew-text-nav { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
        .crew-text-workspace { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(0, 1.2fr); gap: 24px; align-items: start; }
        .crew-text-controls, .crew-text-preview { min-width: 0; padding: 22px; border: 1px solid ${C.borderStrong}; border-radius: 12px; background: ${C.linenCard}; }
        .crew-text-people { align-items: stretch; display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 24px; }
        .crew-text-person { grid-column: 1 / -1; }
        .crew-text label { display: block; font-size: 14px; font-weight: 600; }
        .crew-text input, .crew-text select, .crew-text textarea { box-sizing: border-box; min-width: 0; display: block; width: 100%; margin-top: 6px; padding: 11px 12px; border: 1px solid ${C.borderStrong}; border-radius: 6px; background: ${C.linenDeep}; color: ${C.textHead}; font: inherit; -webkit-appearance: none; }
        .crew-text select { appearance: auto; }
        .crew-text button { padding: 11px 14px; min-height: 42px; border: 1px solid ${C.borderStrong}; border-radius: 6px; background: ${C.linenLight}; color: ${C.textHead}; font-weight: 700; cursor: pointer; }
        .crew-text button:hover:not(:disabled) { border-color: ${C.tealDark}; }
        .crew-text button:disabled { opacity: .5; cursor: default; }
        .crew-text button:focus-visible, .crew-text input:focus-visible, .crew-text select:focus-visible, .crew-text textarea:focus-visible { outline: 2px solid ${C.tealDark}; outline-offset: 3px; }
        .crew-text .crew-text-back { background: transparent; }
        .crew-text-preview { border-top: 3px solid ${C.tealDark}; }
        .crew-text-preview-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
        .crew-text-preview-heading h2 { margin: 5px 0 0; font-size: 28px; }
        .crew-text .crew-text-copy { width: 100%; background: ${C.teal}; color: ${C.dark}; }
        .crew-text textarea { min-height: 440px; background: ${C.linenLight}; line-height: 1.65; resize: vertical; font-weight: 400; padding: 18px; }
        .crew-text-hint, .crew-text .crew-text-feedback { font-size: 13px; color: ${C.textMuted}; }
        .crew-text-feedback { min-height: 38px; }
        .crew-text-review { margin-top: 22px; padding: 14px; border-left: 3px solid ${C.amber}; background: ${C.linenLight}; border-radius: 6px; }
        .crew-text-review ul { margin: 8px 0 0; padding-left: 18px; font-size: 14px; line-height: 1.5; }
        @media(max-width: 800px) { .crew-text-workspace { grid-template-columns: 1fr; } }
        @media(max-width: 480px) { .crew-text { padding: 12px 10px; } .crew-text-controls, .crew-text-preview { padding: 16px; } .crew-text-week > .crew-text-nav { display: grid; grid-template-columns: 1fr 1fr; width: 100%; } .crew-text-week label { grid-column: 1 / -1; grid-row: 1; } .crew-text button { padding: 10px; } }
      `}</style>
    </section>
  )
}
