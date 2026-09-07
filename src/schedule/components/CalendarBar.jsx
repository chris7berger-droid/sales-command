// One continuous calendar bar segment (plan §2.1). Presentational only: the
// parent positions it in the week-row overlay grid via `gridColumn`/`gridRow`
// and hands it the already-resolved label pieces. Color is the job's alternating
// readability color (NOT work type / lead / customer) — a small PW marker rides
// on top without recoloring the whole bar. Read-only: clicking selects the job.

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
        background: color,
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
      {/* Job number in a dark pill with teal text — the same treatment the sales
          lists (Call Log / Proposals / Invoices) use, so the number reads on any
          bar color and the app shares one visual language. Name stays white. */}
      {jobNum && (
        <span style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, letterSpacing: '0.04em',
          color: '#30cfac', background: '#1c1814', borderRadius: 4,
          padding: '0 5px', lineHeight: `${height - 4}px`, flexShrink: 0,
        }}>{jobNum}</span>
      )}
      {jobName && (
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto' }}>{jobName}</span>
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
