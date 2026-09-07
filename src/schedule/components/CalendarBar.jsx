// One continuous calendar bar segment (plan §2.1). Presentational only: the
// parent positions it in the week-row overlay grid via `gridColumn`/`gridRow`
// and hands it the already-resolved label pieces. Color is the job's alternating
// readability color (NOT work type / lead / customer) — a small PW marker rides
// on top without recoloring the whole bar. Read-only: clicking selects the job.

// Fade a hex color to an rgba string — softens the bar fill against the linen
// theme (less visual strain) while a fuller-color border keeps each bar distinct.
function hexA(hex, a) {
  const h = String(hex).replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export default function CalendarBar({
  gridColumn, gridRow, color, jobNum, jobName, crewCount, lead, isPW, selected, onSelect,
  height = 16, fontSize = 10,
}) {
  const label = `${jobNum || ''}${jobNum && jobName ? ' · ' : ''}${jobName || ''}`.trim()
  const title = `${label}${isPW ? ' (PW)' : ''}`
    + (crewCount ? ` — ${crewCount} crew` : '')
    + (lead ? ` — ${lead}` : '')

  return (
    <div
      className="cal-bar"
      onClick={e => { e.stopPropagation(); onSelect && onSelect() }}
      title={title}
      style={{
        gridColumn,
        gridRow,
        background: hexA(color, 0.55),
        border: `1px solid ${hexA(color, 0.85)}`,
        boxSizing: 'border-box',
        color: '#fff',
        fontSize,
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        padding: '1px 6px',
        margin: '0 1px',
        borderRadius: 3,
        height,
        lineHeight: `${height - 2}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        pointerEvents: 'auto',
        boxShadow: selected ? '0 0 0 2px var(--text-primary)' : 'none',
      }}
    >
      {/* Job identifier as a single dark pill with teal text — the same treatment
          the sales lists (Call Log / Proposals / Invoices) use. jobNum is already
          the composite "num - name" (display_job_number), so no separate white
          name is needed. Ellipsis handles long labels on short bars. */}
      {jobNum && (
        <span style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, letterSpacing: '0.04em',
          color: '#30cfac', background: '#1c1814', borderRadius: 4,
          padding: '0 6px', lineHeight: `${height - 4}px`,
          flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{jobNum}</span>
      )}
      {isPW && (
        <span style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: Math.max(9, fontSize - 2),
          letterSpacing: '0.04em', background: '#1c1814', color: '#30cfac',
          borderRadius: 4, padding: '0 5px', flexShrink: 0, lineHeight: `${height - 6}px`,
        }}>PW</span>
      )}
      {lead && (
        <span style={{ opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>
          {lead}
        </span>
      )}
      {crewCount > 0 && (
        <span className="cal-badge" style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
          background: 'rgba(0,0,0,0.3)', color: '#fff',
          borderRadius: 3, padding: '0 4px', lineHeight: '14px', flexShrink: 0, marginLeft: 'auto',
        }}>{crewCount}</span>
      )}
    </div>
  )
}
