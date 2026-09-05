import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadJobs, loadBillingSurfaceData, setBillingWorklistFlag } from '../lib/queries'
import { buildBillingSurface, billingCardKey, BILLING_CARDS } from '../lib/billingForecast'
import { getMonday, fmtWk } from '../lib/weeks'
import { useUser } from '../lib/user'
import { useToast } from '../lib/toast'
import FilterBar from '../../components/FilterBar'
import BillingCard from '../components/BillingCard'
import BillingForecast from '../components/BillingForecast'

// /billing — Finance / Billing. One consolidated money screen (reskin chunk 1):
//   • Worklist  → one flat list of billing-worklist rows (was the 4-card picker),
//                 each row wears its status (billingCardKey → BILLING_CARDS.label)
//                 and renders the full BillingCard; a shared FilterBar (Status new)
//                 + a Total-to-Bill header + a Go Backs chip.
//   • Forecast  → the 90-day cash-flow forecast, folded in from views/Forecast.jsx
//                 (reads built.forecast — NO second fetch).
//   • Budget    → placeholder slot for the chunk-2 margin cards.
// Reads canonical Sales invoices read-only; writes back only billing_worklist
// override flags. Tolerant ?tab= reader: worklist(default)|forecast|budget;
// unknown → worklist (never 404). StageJobCard billed-clicks land on ?tab=worklist.

const money = (n) => '$' + Math.round(n || 0).toLocaleString()
const cardLabel = (key) => BILLING_CARDS.find((c) => c.key === key)?.label || 'Ready to Bill'

// Per-row status pill — dark bubble, teal text (brand: dollar/status badges are
// C.dark bg + teal text, not full-card dark). Uses schedule CSS vars.
const statusChipStyle = {
  alignSelf: 'flex-start',
  background: 'var(--panel-dark)',
  color: 'var(--teal)',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 700,
  fontFamily: 'var(--font-heading)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const TABS = [
  { key: 'worklist', label: 'Worklist' },
  { key: 'forecast', label: 'Forecast' },
  { key: 'budget', label: 'Budget' },
]

export default function Billing() {
  const user = useUser()
  const toast = useToast()
  const canEdit = user?.role === 'Admin' // money-config role gate (§8.1c #9)
  const [searchParams, setSearchParams] = useSearchParams()

  // tolerant ?tab= reader — unknown/absent → worklist (hard default, never 404)
  const tabParam = searchParams.get('tab')
  const tab = tabParam === 'forecast' ? 'forecast' : tabParam === 'budget' ? 'budget' : 'worklist'
  const setTab = (t) => setSearchParams(t === 'worklist' ? {} : { tab: t }, { replace: true })

  const [jobs, setJobs] = useState([])
  const [surface, setSurface] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyJobId, setBusyJobId] = useState(null)
  const [filters, setFilters] = useState({ status: '', sales: '', dateFrom: '', dateTo: '', workType: '', customer: '', jobNumber: '' })
  const [gbOnly, setGbOnly] = useState(false)
  const loadIdRef = useRef(0)

  const loadData = useCallback(async () => {
    const thisLoad = ++loadIdRef.current
    setLoading(true)
    const [jRes, data] = await Promise.all([loadJobs(), loadBillingSurfaceData()])
    if (thisLoad !== loadIdRef.current) return // a newer load superseded this one
    setJobs(jRes.data || [])
    setSurface(data)
    setLoading(false)
  }, [])

  // Mount data-load (same idiom as Jobs.jsx loadData). The loadIdRef guard
  // prevents the cascading-render concern the lint rule warns about.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const built = useMemo(() => {
    if (!surface) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return buildBillingSurface(jobs, surface, today, getMonday)
  }, [jobs, surface])

  const weekLabel = useMemo(() => fmtWk(getMonday(new Date())), [])

  const onFlag = useCallback(async (jobId, field, value) => {
    if (!canEdit) return
    // Optimistic: patch the local override immediately so the card + forecast
    // update in place (buildBillingSurface re-derives from surface.overrides via
    // the useMemo). Persist in the background; revert on failure.
    setBusyJobId(jobId)
    setSurface((prev) => {
      if (!prev) return prev
      const overrides = prev.overrides ? [...prev.overrides] : []
      const idx = overrides.findIndex((o) => String(o.job_id) === String(jobId))
      if (idx >= 0) overrides[idx] = { ...overrides[idx], [field]: value }
      else overrides.push({ job_id: jobId, [field]: value })
      return { ...prev, overrides }
    })
    const { error } = await setBillingWorklistFlag(jobId, field, value, user?.name || 'unknown')
    setBusyJobId(null)
    if (error) {
      toast(`Couldn’t save: ${error.message}`, 'err')
      await loadData() // revert to server truth
      return
    }
    toast('Saved', 'ok')
  }, [canEdit, user, toast, loadData])

  // filter option lists — derived from the built rows (no new fetch)
  const statusOptions = useMemo(() => BILLING_CARDS.map((c) => ({ value: c.key, label: c.label })), [])
  const salesOptions = useMemo(
    () => (built ? [...new Set(built.rows.map((r) => r.salesName).filter(Boolean))].sort() : []),
    [built],
  )
  const workTypeOptions = useMemo(
    () => (built ? [...new Set(built.rows.map((r) => r.workType).filter(Boolean))].sort().map((n) => ({ id: n, name: n })) : []),
    [built],
  )

  // apply the filter bar + Go Backs chip over the flat row list
  const filteredRows = useMemo(() => {
    if (!built) return []
    const cust = filters.customer.trim().toLowerCase()
    const jn = filters.jobNumber.trim().toLowerCase()
    return built.rows.filter((r) => {
      if (gbOnly && !r.override?.nothing_to_bill) return false
      if (filters.status && billingCardKey(r) !== filters.status) return false
      if (filters.sales && r.salesName !== filters.sales) return false
      if (filters.workType && r.workType !== filters.workType) return false
      if (cust && !(r.customerName || '').toLowerCase().includes(cust)) return false
      if (jn && !String(r.jobNum || '').toLowerCase().includes(jn)) return false
      // Date filters by last invoice sent date; a never-billed row (no lastSent)
      // passes through so a date bound doesn't nuke the ready-to-bill worklist.
      if (filters.dateFrom && r.lastSent && r.lastSent < filters.dateFrom) return false
      if (filters.dateTo && r.lastSent && r.lastSent > filters.dateTo) return false
      return true
    })
  }, [built, filters, gbOnly])

  return (
    <div className="bill-surface">
      {/* section tabs — Worklist / Forecast / Budget */}
      <div className="bill-tabs" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              border: `1.5px solid ${tab === t.key ? 'var(--teal)' : 'var(--brd)'}`,
              background: tab === t.key ? 'var(--panel-dark)' : 'transparent',
              color: tab === t.key ? 'var(--teal)' : 'var(--text-secondary)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="bill-loading">Loading billing…</div>}

      {/* ── WORKLIST ─────────────────────────────────────────────────────── */}
      {!loading && built && tab === 'worklist' && (
        <div className="jh-picker bill-picker">
          <div className="bill-picker-summary">
            <div className="bill-picker-sum-lbl">Total to bill — {weekLabel}</div>
            <div className="bill-picker-sum-num">{money(built.toBill)}</div>
            <div className="bill-picker-sum-sub">{built.toBillRows.length} still owed · {built.rows.length} on the billing list</div>
          </div>

          <button
            className={`bill-gb-filter${gbOnly ? ' on' : ''}`}
            onClick={() => setGbOnly((v) => !v)}
            title="Go Backs — jobs already built/billed, flagged so you know why they came up"
          >
            <span className="bill-gb-icon">&#8617;</span>
            <span className="bill-gb-count">{built.goBackRows.length}</span>
            Go Back{built.goBackRows.length === 1 ? '' : 's'}
            <span className="bill-gb-hint">{gbOnly ? 'showing' : 'view'} &rarr;</span>
          </button>

          <div style={{ margin: '12px 0 16px' }}>
            <FilterBar
              filters={filters}
              onChange={setFilters}
              statusOptions={statusOptions}
              salesOptions={salesOptions}
              workTypeOptions={workTypeOptions}
            />
          </div>

          {filteredRows.length === 0 ? (
            <div className="bill-drill-empty">Nothing matches these filters.</div>
          ) : (
            <div className="bill-drill-grid">
              {filteredRows.map((r) => (
                <div key={r.jobId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={statusChipStyle}>{cardLabel(billingCardKey(r))}</span>
                  <BillingCard
                    row={r}
                    canEdit={canEdit}
                    onFlag={onFlag}
                    busy={busyJobId === r.jobId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── FORECAST (folded in — reads built.forecast, no second fetch) ──── */}
      {!loading && built && tab === 'forecast' && (
        <BillingForecast forecast={built.forecast} partial={surface?.partial} rows={built.rows} jobs={jobs} />
      )}

      {/* ── BUDGET (chunk-2 margin-card placeholder slot) ────────────────── */}
      {!loading && tab === 'budget' && (
        <div className="jh-wrap">
          <div className="jh-empty">
            Budget &amp; margin — coming soon. Live per-job margin (contract vs.
            crew-logged cost) lands with chunk 2, once Field Command DPRs are flowing.
          </div>
        </div>
      )}
    </div>
  )
}
