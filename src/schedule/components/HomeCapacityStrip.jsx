import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useToolbarActions } from '../lib/toolbar'

const DAYS_LONG = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function flipName(n) {
  if (!n) return ''
  const p = n.split(',')
  return p.length === 2 ? p[1].trim() + ' ' + p[0].trim() : n
}

// Weekly Crew Capacity — the full-width charcoal strip (§8 composition #2). Left:
// three circular summary badges. Right: six per-day capacity indicators (assigned
// / available + bar + %) with a TODAY marker. All numbers come from
// computeHomeDashboard (§11); this component is presentation only.
function pctColor(pct) {
  if (pct >= 80) return 'var(--sig-green)'
  if (pct >= 50) return 'var(--sig-orange)'
  return 'var(--sig-red)'
}

function Badge({ value, label, color }) {
  return (
    <div className="hcs-badge">
      <div className="hcs-badge-circle" style={{ borderColor: color, color }}>{value}</div>
      <div className="hcs-badge-text">
        <div className="hcs-badge-value">{label}</div>
      </div>
    </div>
  )
}

export default function HomeCapacityStrip({ data, weekLabel }) {
  const navigate = useNavigate()
  const location = useLocation()
  const days = data?.capacityDays || []
  const [detailDay, setDetailDay] = useState(null)
  // No point linking to the Crew Schedule when we're already on it.
  const onCrewSchedule = location.pathname === '/schedule/schedule'
  // +Job / Actions, provided by ScheduleShell — rendered here so they sit inside
  // the band header instead of a separate strip above it. Null on any screen
  // outside the shell (defensive; the band only mounts under it today).
  const toolbarActions = useToolbarActions()

  return (
    <section className="hcs">
      <div className="hcs-head">
        <div className="hcs-title-block">
          <div className="hcs-title">Weekly Crew Capacity</div>
          {weekLabel && <div className="hcs-week">{weekLabel}</div>}
        </div>
        <div className="hcs-head-actions">
          {toolbarActions}
          {!onCrewSchedule && <button className="hcs-view-btn" onClick={() => navigate('/schedule/schedule')}>View Crew Schedule →</button>}
        </div>
      </div>

      <div className="hcs-body">
        <div className="hcs-badges">
          <Badge value={data?.crewAvailable ?? 0} label="Crew Available" color="var(--teal)" />
          <Badge value={data?.assignedCount ?? 0} label="Assigned" color="var(--sig-orange)" />
          <Badge value={data?.openSpots ?? 0} label="Open Crew Spots" color="var(--sig-purple)" />
        </div>

        <div className="hcs-days">
          {days.map((d, i) => {
            const [, mm, dd] = d.date.split('-')
            const color = pctColor(d.pct)
            const free = d.free ?? Math.max(0, d.avail - d.assigned)
            return (
              <div key={d.date} className={`hcs-day hcs-day-click${d.isToday ? ' hcs-day-today' : ''}`} onClick={() => setDetailDay(d)}>
                <div className="hcs-day-badges">
                  <span className="hcs-day-avail" title={`${free} crew free`}>{free}</span>
                  {d.out > 0 && <span className="hcs-day-off" title={`${d.out} crew off`}>{d.out}</span>}
                </div>
                <div className="hcs-day-label">{DAYS_LONG[i]} {parseInt(dd, 10)}</div>
                <div className="hcs-day-count">{d.assigned} / {d.avail}</div>
                <div className="hcs-day-bar">
                  <div className="hcs-day-bar-fill" style={{ width: `${Math.min(100, d.pct)}%`, background: color }} />
                </div>
                <div className="hcs-day-pct" style={{ color }}>{d.pct}%</div>
                {d.isToday && <div className="hcs-day-today-tag">TODAY</div>}
              </div>
            )
          })}
        </div>
      </div>

      {detailDay && (() => {
        const di = days.indexOf(detailDay)
        const [, mm, dd] = detailDay.date.split('-')
        const dayLabel = DAYS_LONG[di] || ''
        const det = detailDay.detail || { available: [], assigned: [], out: [] }
        return (
          <div className="sch-modal-overlay" onClick={() => setDetailDay(null)}>
            <div className="sch-modal sch-modal-detail" onClick={e => e.stopPropagation()}>
              <div className="sch-modal-title">{dayLabel} {parseInt(mm, 10)}/{parseInt(dd, 10)}</div>
              <div className="sch-dd-section-hdr" style={{ color: 'var(--command-green)' }}>Available ({det.available.length})</div>
              {det.available.map(c => (
                <div key={c.name} className="sch-dd-row">{'•'} {flipName(c.name)}</div>
              ))}
              <div className="sch-dd-section-hdr" style={{ color: '#3498db' }}>Assigned ({det.assigned.length})</div>
              {det.assigned.map((c, idx) => (
                <div key={c.name + idx} className="sch-dd-row">
                  {'•'} {flipName(c.name)} <span className="sch-dd-arrow">{'→'}</span> {c.job ? c.job.job_num + ' - ' + c.job.job_name : '?'}
                </div>
              ))}
              <div className="sch-dd-section-hdr" style={{ color: 'var(--danger)' }}>Out ({det.out.length})</div>
              {det.out.map(c => (
                <div key={c.name} className="sch-dd-row">{'•'} {flipName(c.name)} <span className="sch-dd-status">({c.status})</span></div>
              ))}
              <div className="sch-modal-actions">
                <button className="sch-btn" onClick={() => setDetailDay(null)}>CLOSE</button>
              </div>
            </div>
          </div>
        )
      })()}
    </section>
  )
}
