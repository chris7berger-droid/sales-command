// One continuous calendar bar segment (plan §2.1). Presentational only: the
// parent positions it in the week-row overlay grid via `gridColumn`/`gridRow`
// and hands it the already-resolved label pieces. Color is the job's alternating
// readability color (NOT work type / lead / customer) — a small PW marker rides
// on top without recoloring the whole bar. Read-only: clicking selects the job.

export default function CalendarBar({
  gridColumn, gridRow, color, jobNum, jobName, crewCount, lead, isPW, selected, onSelect,
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
        fontSize: 10,
        fontFamily: 'var(--font-heading)',
        fontWeight: 600,
        padding: '1px 5px',
        margin: '0 1px',
        borderRadius: 3,
        height: 16,
        lineHeight: '14px',
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
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto' }}>{label}</span>
      {isPW && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700,
          background: 'rgba(255,255,255,0.85)', color: '#6d28d9',
          borderRadius: 2, padding: '0 2px', flexShrink: 0, lineHeight: '12px',
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
