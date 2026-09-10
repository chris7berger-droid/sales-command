import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { C, F } from '../../lib/tokens'
import { loadAllRows, loadJobs, loadMobilizationsByJobId } from '../lib/queries'
import { fmtD } from '../lib/weeks'
import { buildCrewWeekText, crewDateLabel, crewDisplayName, crewWeekDates, DEFAULT_CREW_START } from '../lib/crewWeekText'

// A separate, authenticated phone route. No ScheduleLayout or desktop shell.
export default function CrewPhone() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('week') || ''
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(requested) &&
    requested >= '1900-01-01' && requested <= '2100-12-31' &&
    fmtD(new Date(`${requested}T12:00:00`)) === requested
  const week = crewWeekDates(validDate ? requested : fmtD(new Date()))[0]
  const dates = useMemo(() => crewWeekDates(week), [week])
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState('')
  const [defaultStart, setDefaultStart] = useState(DEFAULT_CREW_START)
  const [feedback, setFeedback] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [showText, setShowText] = useState(false)
  const textRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      setSnapshot(null)
      try {
        const [jobRes, crewRes, assignmentRes] = await Promise.all([
          loadJobs(),
          loadAllRows('crew', 'name, archived', { orderBy: 'name' }),
          loadAllRows('assignments', 'id, job_id, mobilization_id, crew_name, date', {
            orderBy: 'id', filterFn: q => q.gte('date', dates[0]).lte('date', dates.at(-1)),
          }),
        ])
        if (jobRes.error || crewRes.error || assignmentRes.error) throw jobRes.error || crewRes.error || assignmentRes.error
        const allocations = await loadMobilizationsByJobId(jobRes.data, { liveOnly: true, throwOnError: true })
        if (!cancelled) setSnapshot({ week, refresh, jobs: jobRes.data, crew: crewRes.data,
          assignments: assignmentRes.data, allocations, updatedAt: new Date() })
      } catch (err) {
        if (!cancelled) setError(err.message || 'Please try again.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [week, dates, refresh])

  useEffect(() => {
    const reload = () => { if (document.visibilityState === 'visible') setRefresh(n => n + 1) }
    document.addEventListener('visibilitychange', reload)
    window.addEventListener('focus', reload)
    return () => {
      document.removeEventListener('visibilitychange', reload)
      window.removeEventListener('focus', reload)
    }
  }, [])

  const ready = snapshot?.week === week && snapshot?.refresh === refresh && !error
  const names = useMemo(() => snapshot ? [...new Set([
    ...snapshot.crew.filter(c => !c.archived).map(c => c.name),
    ...snapshot.assignments.map(a => a.crew_name),
  ].filter(Boolean))].sort((a, b) => crewDisplayName(a).localeCompare(crewDisplayName(b))) : [], [snapshot])
  const name = names.includes(selected) ? selected : names[0] || ''
  const message = useMemo(() => ready && name ? buildCrewWeekText({ ...snapshot, name, dates, defaultStart }) : null,
    [ready, snapshot, name, dates, defaultStart])
  const displayName = crewDisplayName(name)
  const canShare = typeof navigator.share === 'function'

  function choose(value) { setSelected(value); setFeedback(null); setShowText(false) }
  function movePerson(offset) { choose(names[(names.indexOf(name) + offset + names.length) % names.length]) }
  function changeWeek(value) { setParams({ week: value }); setFeedback(null); setShowText(false) }
  function moveWeek(offset) {
    const date = new Date(`${week}T12:00:00`)
    date.setDate(date.getDate() + offset * 7)
    changeWeek(fmtD(date))
  }
  async function copy() {
    if (!message || sharing) return
    const text = message.text
    try {
      await navigator.clipboard.writeText(text)
      setFeedback({ text, note: `Copied ${displayName}’s week. Paste it into Messages.` })
    } catch {
      setShowText(true)
      setFeedback({ text, note: 'Select and copy the text below, then paste it into Messages.' })
      requestAnimationFrame(() => {
        textRef.current?.focus()
        textRef.current?.select()
      })
    }
  }
  async function share() {
    if (!message || sharing) return
    const text = message.text
    setSharing(true)
    setFeedback(null)
    try {
      // Call directly from the tap; iPhone sharing requires user activation.
      await navigator.share({ text })
    } catch (err) {
      if (err.name !== 'AbortError') setFeedback({ text, note: 'Sharing is unavailable. Use Copy, then paste into Messages.' })
    } finally {
      setSharing(false)
    }
  }

  return (
    <main className="crew-phone">
      <header className="cp-header">
        <span className="cp-brand">SUBCON COMMAND</span>
        <h1>Weekly crew texts</h1>
        <p>Choose a person. Share their week from your phone.</p>
      </header>
      <section className="cp-picker" aria-label="Choose schedule">
        <div className="cp-week">
          <button aria-label="Previous week" disabled={sharing} onClick={() => moveWeek(-1)}>←</button>
          <label>Week of<input aria-label="Week of" type="date" min="1900-01-01" max="2100-12-31" value={week}
            disabled={sharing} onChange={e => { if (e.target.value) changeWeek(e.target.value) }} /></label>
          <button aria-label="Next week" disabled={sharing} onClick={() => moveWeek(1)}>→</button>
        </div>
        {ready && names.length > 0 && <>
          <label>Crew member<select value={name} disabled={sharing} onChange={e => choose(e.target.value)}>
            {names.map(n => <option key={n} value={n}>{crewDisplayName(n)}</option>)}
          </select></label>
          <div className="cp-person-nav">
            <button disabled={sharing} onClick={() => movePerson(-1)}>← Previous person</button>
            <button disabled={sharing} onClick={() => movePerson(1)}>Next person →</button>
          </div>
          <details className="cp-start">
            <summary>Start / meeting instructions</summary>
            <label>Usual start<input value={defaultStart} disabled={sharing} onChange={e => { setDefaultStart(e.target.value); setFeedback(null) }} /></label>
            <p>Default: 6:30 AM at the shop. Saved delayed starts override this on their assigned days.</p>
          </details>
        </>}
      </section>

      {error ? <section className="cp-notice" role="alert">
        <h2>Couldn’t load the full schedule</h2><p>{error}</p>
        <button onClick={() => setRefresh(n => n + 1)}>Retry</button>
      </section> : !ready ? <p className="cp-loading" role="status">Loading weekly schedules…</p> : !names.length ?
        <p className="cp-loading">No crew found.</p> : message && <>
          <div className="cp-section-title"><h2>{displayName}’s week</h2>
            <button disabled={sharing} onClick={() => setRefresh(n => n + 1)}>Refresh</button>
          </div>
          <p className="cp-updated">Updated {snapshot.updatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · Monday–Sunday</p>
          {message.warnings.length > 0 && <section className="cp-notice" aria-label="Check before sharing">
            <h2>Check before sharing</h2><ul>{message.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          </section>}
          <div className="cp-days">
            {message.days.map(day => <section className={`cp-day${day.entries.length ? '' : ' cp-day-empty'}`} key={day.date}>
              <h3>{crewDateLabel(day.date)}</h3>
              {day.entries.length > 1 && <p className="cp-multiple">Multiple assignments — confirm order/start times with office.</p>}
              {day.entries.length ? day.entries.map((entry, index) => {
                const [title, ...lines] = entry.split('\n')
                return <article key={index}><h4>{title}</h4><p>{lines.join('\n')}</p></article>
              }) : <p>No work assigned</p>}
            </section>)}
          </div>
          <details className="cp-exact" open={showText} onToggle={e => setShowText(e.currentTarget.open)}>
            <summary>Full text to share</summary>
            <textarea ref={textRef} aria-label="Full text to share" readOnly value={message.text} />
          </details>
        </>}
      <a className="cp-desktop-link" href="/">Open desktop app</a>
      <footer className="cp-actions">
        <div>
          <p className="cp-feedback" role="status">{feedback?.text === message?.text ? feedback?.note :
            message ? `Send ${displayName}’s week` : 'Choose a loaded schedule to share.'}</p>
          <div className="cp-action-buttons">
            {canShare && <button className="cp-primary" disabled={!message || sharing} onClick={share}>{sharing ? 'Sharing…' : 'Share week'}</button>}
            <button className={canShare ? '' : 'cp-primary'} disabled={!message || sharing} onClick={copy}>Copy week</button>
          </div>
        </div>
      </footer>
      <style>{`
        .crew-phone { max-width: 620px; min-height: 100dvh; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) 16px 190px; font-family: ${F.body}; color: ${C.textBody}; }
        .crew-phone * { box-sizing: border-box; }
        .crew-phone h1, .crew-phone h2, .crew-phone h3, .crew-phone h4 { color: ${C.textHead}; }
        .crew-phone h1 { font: 800 34px/1.1 ${F.display}; margin: 6px 0 10px; }
        .crew-phone h2 { font: 700 24px/1.2 ${F.display}; }
        .crew-phone p { line-height: 1.5; }
        .crew-phone button { min-height: 46px; padding: 10px 12px; border: 1px solid ${C.borderStrong}; border-radius: 8px; background: ${C.linenLight}; color: ${C.dark}; font: 600 15px ${F.body}; cursor: pointer; }
        .crew-phone button:disabled { opacity: .45; cursor: default; }
        .crew-phone :is(button, input, select, summary, textarea, a):focus-visible { outline: 3px solid ${C.tealDark}; outline-offset: 2px; }
        .cp-brand { color: ${C.tealDark}; font: 700 11px ${F.ui}; letter-spacing: .14em; }
        .cp-header { margin-bottom: 22px; }
        .cp-header p { color: ${C.textMuted}; font-size: 16px; }
        .cp-picker { background: ${C.linenCard}; border: 1px solid ${C.borderStrong}; border-radius: 12px; padding: 14px; }
        .crew-phone label { display: block; min-width: 0; font-size: 13px; font-weight: 600; }
        .crew-phone input, .crew-phone select, .crew-phone textarea { display: block; width: 100%; min-width: 0; min-height: 48px; margin-top: 6px; padding: 11px; border: 1px solid ${C.borderStrong}; border-radius: 8px; background: ${C.linenDeep}; color: ${C.textHead}; font: 400 16px ${F.body}; -webkit-appearance: none; }
        .crew-phone select { appearance: auto; }
        .cp-week { display: grid; grid-template-columns: 46px minmax(0, 1fr) 46px; align-items: end; gap: 10px; margin-bottom: 18px; }
        .cp-week button { min-height: 48px; font-size: 22px; padding: 5px; }
        .cp-week input { max-width: 100%; }
        .cp-person-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
        .cp-start { margin-top: 12px; border-top: 1px solid ${C.border}; }
        .crew-phone summary { cursor: pointer; padding: 15px 0; min-height: 46px; font-size: 14px; font-weight: 600; }
        .cp-start p { font-size: 13px; color: ${C.textMuted}; margin-top: 8px; }
        .cp-section-title { display: flex; gap: 12px; justify-content: space-between; align-items: center; margin-top: 24px; }
        .cp-section-title h2 { overflow-wrap: anywhere; }
        .cp-updated { font-size: 12px; color: ${C.textMuted}; margin: 5px 0 16px; }
        .cp-loading { padding: 24px 0; }
        .cp-day { border: 1px solid ${C.borderStrong}; background: ${C.linenCard}; border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
        .cp-day h3 { padding: 11px 14px; background: ${C.linenDeep}; border-bottom: 1px solid ${C.border}; font: 700 18px ${F.display}; }
        .cp-day article { padding: 14px; border-top: 1px solid ${C.border}; }
        .cp-day article:first-of-type { border-top: 0; }
        .cp-day h4 { font-size: 18px; line-height: 1.35; margin-bottom: 10px; overflow-wrap: anywhere; }
        .cp-day article p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 1.65; }
        .cp-day-empty { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: transparent; }
        .cp-day-empty h3 { padding: 0; background: none; border: 0; font-size: 16px; }
        .cp-day-empty p { font-size: 13px; color: ${C.textMuted}; }
        .cp-notice { padding: 14px; margin: 16px 0; background: ${C.linenLight}; border-left: 3px solid ${C.amber}; overflow-wrap: anywhere; }
        .cp-notice h2 { font-size: 21px; margin-bottom: 8px; }
        .cp-notice ul { padding-left: 18px; font-size: 14px; line-height: 1.5; }
        .cp-notice button { margin-top: 12px; }
        .cp-multiple { padding: 12px 14px; font-size: 14px; }
        .cp-exact textarea { min-height: 400px; resize: vertical; line-height: 1.5; }
        .cp-desktop-link { display: inline-block; color: ${C.textMuted}; padding: 18px 0; font-size: 14px; }
        .cp-actions { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; padding: 12px 16px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid ${C.borderStrong}; background: ${C.linenCard}; box-shadow: 0 -4px 20px rgba(28,24,20,.06); }
        .cp-actions > div { max-width: 588px; margin: 0 auto; }
        .cp-feedback { font-size: 13px; margin-bottom: 9px; overflow-wrap: anywhere; }
        .cp-action-buttons { display: flex; gap: 10px; }
        .cp-action-buttons button { flex: 1; min-height: 50px; font-size: 17px; font-weight: 700; }
        .crew-phone .cp-primary { background: ${C.teal}; color: ${C.dark}; border-color: ${C.teal}; }
      `}</style>
    </main>
  )
}
