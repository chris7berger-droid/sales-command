import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Job change-log (audit trail), ported from the retired JobDetail "History" tab so
// nothing is lost when JobDetail goes away. Read-only: renders job_changes rows
// (auto-written by updateJobField on every field edit), grouped by date. Lazy —
// only mounts when the card's HISTORY panel is opened, so it fetches on demand.

export default function HistoryPanel({ job }) {
  const [changes, setChanges] = useState(null)  // null = loading

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('job_changes')
        .select('*')
        .eq('job_id', job.job_id)
        .order('changed_at', { ascending: false })
        .limit(100)
      if (!cancelled) setChanges(data || [])
    })()
    return () => { cancelled = true }
  }, [job.job_id])

  if (changes === null) return <div className="sjc-panel"><div className="jh-empty">Loading…</div></div>
  if (changes.length === 0) return <div className="sjc-panel"><div className="jh-empty">No changes logged yet</div></div>

  // Group by day (same presentation as the old JobDetail History tab).
  const groups = []
  let currentDate = null
  changes.forEach(c => {
    const d = new Date(c.changed_at)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (dateKey !== currentDate) {
      currentDate = dateKey
      groups.push({ date: dateKey, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), items: [] })
    }
    groups[groups.length - 1].items.push(c)
  })

  return (
    <div className="sjc-panel">
      <div className="jd-history">
        {groups.map(g => (
          <div key={g.date} className="jd-history-group">
            <div className="jd-history-date">{g.label}</div>
            <div className="jd-history-items">
              {g.items.map(c => (
                <div key={c.id} className="jd-history-row">
                  <span className="jd-history-field">{c.field}</span>
                  <span className="jd-history-vals">
                    {c.old_value && <span className="jd-history-old">{c.old_value}</span>}
                    <span className="jd-history-arrow">{'→'}</span>
                    <span className="jd-history-new">{c.new_value}</span>
                  </span>
                  <span className="jd-history-time">{new Date(c.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
