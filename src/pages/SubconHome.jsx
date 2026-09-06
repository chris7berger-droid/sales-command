import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, SP, R, FS } from "../lib/tokens";
import { GROUPS, groupVisible } from "../lib/nav";
import { useTenantConfig } from "../lib/TenantConfigContext";
import { loadSubconSummary } from "../lib/subconSummary";
import heroImg from "../assets/hero/hero-01.jpg";

// Subcon Command home (`/`) — the company-level executive command center. A fast
// cross-command read (Sales / Schedule / Field / AR) + a launch surface to drill
// into each module. Home IDENTIFIES; the Commands handle. Numbers reuse each
// module's canonical calc via loadSubconSummary (never re-download raw rows to
// total in React). Sources that aren't live yet wear a wired "Coming soon" slot.

// ── formatting ───────────────────────────────────────────────────────────────
const money = n => (n == null ? "—" : "$" + Math.round(n).toLocaleString());
const count = n => (n == null ? "—" : Number(n).toLocaleString());
const pct = n => (n == null ? "—" : Math.round(n) + "%");
const whenLabel = iso => {
  if (!iso) return "";
  const d = new Date(iso);
  return (d.getMonth() + 1) + "/" + d.getDate();
};

// Welcome hero — the locked construction/sunrise photo (src/assets/hero/hero-01.jpg,
// same asset Sales Home uses) under a left-anchored dark scrim so the headline
// stays readable while the photo shows through on the right.
const HERO_SCRIM =
  "linear-gradient(90deg, rgba(28,24,20,0.93) 0%, rgba(28,24,20,0.78) 42%, rgba(28,24,20,0.34) 100%)";

const CACHE_KEY = "sc_subcon_home_cache";

// ── small primitives ─────────────────────────────────────────────────────────
function Skeleton({ w = 64, h = 26 }) {
  return <div style={{ width: w, height: h, borderRadius: 6, background: C.linenDeep, opacity: 0.55 }} />;
}

// A live KPI cell: big number + label. Clickable → records when `to` is set;
// pass `navState` to hand the target screen a filter (e.g. { stageFilter }).
function KpiCell({ label, value, loading, to, navState, unavailable }) {
  const navigate = useNavigate();
  const clickable = to && !loading && !unavailable;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => navigate(to, navState ? { state: navState } : undefined) : undefined}
      style={{
        textAlign: "left", background: "transparent", border: "none", padding: 0,
        cursor: clickable ? "pointer" : "default", display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0,
      }}
    >
      {loading ? <Skeleton /> : (
        <span style={{ fontSize: FS.boxNum, lineHeight: 1, fontWeight: 900, color: unavailable ? C.textFaint : C.textHead, fontFamily: F.display, letterSpacing: "0.01em" }}>
          {unavailable ? "—" : value}
        </span>
      )}
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, fontFamily: F.ui }}>
        {label}
      </span>
    </button>
  );
}

// A not-yet-live KPI cell — matches the existing "coming soon" pattern.
function ComingSoonCell({ label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: FS.sub, fontWeight: 800, color: C.textMuted, fontFamily: F.display, letterSpacing: "0.02em" }}>Coming soon</span>
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, fontFamily: F.ui }}>
        {label}
      </span>
    </div>
  );
}

// One command card — header (icon + name + tagline + Enter), 3 KPI cells, quick links.
function CommandCard({ group, tagline, cells, quickLinks }) {
  const navigate = useNavigate();
  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, display: "flex", flexDirection: "column", gap: SP.lg, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: SP.md }}>
        <div style={{ display: "flex", alignItems: "center", gap: SP.md, minWidth: 0 }}>
          <span style={{ fontSize: 28 }}>{group.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>{group.label}</div>
            <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui }}>{tagline}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(group.home)}
          style={{ flexShrink: 0, background: C.dark, color: C.teal, border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
        >
          Enter →
        </button>
      </div>

      <div style={{ display: "flex", gap: SP.md }}>
        {cells}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, borderTop: `1px solid ${C.border}`, paddingTop: SP.md }}>
        {quickLinks.map(ql => (
          <button
            key={ql.label}
            type="button"
            onClick={() => navigate(ql.to)}
            style={{ fontSize: 11.5, fontWeight: 700, color: C.textMuted, fontFamily: F.ui, background: C.linenDeep, border: "none", borderRadius: 5, padding: "3px 9px", letterSpacing: "0.02em", cursor: "pointer" }}
          >
            {ql.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SnapshotTile({ label, value, loading, title }) {
  return (
    <div title={title} style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 120 }}>
      {loading ? <Skeleton /> : (
        <span style={{ fontSize: FS.sub, fontWeight: 900, color: C.textHead, fontFamily: F.display }}>{value}</span>
      )}
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, fontFamily: F.ui }}>{label}</span>
    </div>
  );
}

const SEV_COLOR = { high: C.red, med: C.amber, low: C.textLight };

function Panel({ title, action, onAction, children }) {
  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, boxShadow: "0 2px 8px rgba(28,24,20,0.07)", display: "flex", flexDirection: "column", gap: SP.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>{title}</div>
        {action && <button type="button" onClick={onAction} style={{ background: "transparent", border: "none", color: C.tealDark, fontSize: 12, fontWeight: 700, fontFamily: F.ui, cursor: "pointer" }}>{action}</button>}
      </div>
      {children}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function SubconHome({ teamMember, displayRole }) {
  const navigate = useNavigate();
  const cfg = useTenantConfig();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Route `/` is the heaviest load in the suite (it reuses the full Schedule-Home
  // load + sales snapshot + invoice pagination). Cache the result in sessionStorage
  // and skip the refetch entirely if it's <60s old, so bouncing back to Home
  // doesn't re-run ~13 queries every mount (audit C1).
  useEffect(() => {
    let alive = true;
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (c?.data) {
        setData(c.data);
        setLoading(false);
        if (c.ts && Date.now() - c.ts < 60000) return; // fresh enough — no refetch this mount
      }
    } catch { /* ignore bad cache */ }
    loadSubconSummary()
      .then(d => {
        if (!alive) return;
        setData(d);
        setLoading(false);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: d, ts: Date.now() })); } catch { /* quota */ }
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const visInputs = { tenantApps: cfg?.apps, memberApps: teamMember?.apps };
  const visibleGroups = useMemo(() => GROUPS.filter(g => groupVisible(g, visInputs)), [cfg, teamMember]);
  const groupByApp = useMemo(() => Object.fromEntries(visibleGroups.map(g => [g.app, g])), [visibleGroups]);

  const err = data?.errors || {};

  // per-command card definitions, only rendered when the app group is visible
  const cardDefs = [
    groupByApp.sales && {
      group: groupByApp.sales, tagline: "Fill the pipeline",
      quickLinks: [{ label: "Call Log", to: "/sales/calllog" }, { label: "Proposals", to: "/sales/proposals" }, { label: "Customers", to: "/sales/customers" }],
      cells: (
        <>
          <KpiCell label="Active Leads" value={count(data?.sales?.activeLeads)} loading={loading} to="/sales/calllog" unavailable={err.sales} />
          <KpiCell label="Bids Out" value={count(data?.sales?.bidsOut)} loading={loading} to="/sales/calllog" navState={{ stageFilter: "Has Bid" }} unavailable={err.sales} />
          <KpiCell label="Potential Rev" value={money(data?.sales?.potentialRevenue)} loading={loading} to="/sales/proposals" unavailable={err.sales} />
        </>
      ),
    },
    groupByApp.schedule && {
      group: groupByApp.schedule, tagline: "Plan the work",
      quickLinks: [{ label: "Jobs", to: "/schedule/jobs" }, { label: "Crew Schedule", to: "/schedule/schedule" }, { label: "Calendar", to: "/schedule/calendar" }],
      cells: (
        <>
          <KpiCell label="Crew Available" value={count(data?.schedule?.crewAvailable)} loading={loading} to="/schedule/schedule" unavailable={err.schedule} />
          <KpiCell label="Jobs Assigned" value={count(data?.schedule?.jobsAssigned)} loading={loading} to="/schedule/jobs" unavailable={err.schedule} />
          <KpiCell label="Next 30 Days" value={money(data?.schedule?.scheduledToBill)} loading={loading} to="/schedule/billing" unavailable={err.schedule} />
        </>
      ),
    },
    groupByApp.field && {
      group: groupByApp.field, tagline: "Execute the work",
      quickLinks: [{ label: "Daily Logs", to: "/field/dailylogs" }, { label: "Jobs", to: "/field/jobs" }, { label: "Today", to: "/field/today" }],
      cells: (
        <>
          <KpiCell label="Jobs In Progress" value={count(data?.field?.jobsInProgress)} loading={loading} to="/field/jobs" unavailable={err.schedule} />
          <ComingSoonCell label="On Track %" />
          <ComingSoonCell label="Need Attention" />
        </>
      ),
    },
    groupByApp.ar && {
      group: groupByApp.ar, tagline: "Get paid",
      quickLinks: [{ label: "A/R Aging", to: "/ar/aging" }, { label: "Invoices", to: "/ar/invoices" }, { label: "Triage", to: "/ar/triage" }],
      cells: (
        <>
          {/* Display-only: Home's AR numbers come from the live invoices table, but
              the AR module still gates on its QuickBooks-import store, so a click
              would land on "upload a QB export" (audit B2). Re-enable the drill
              when AR reads `invoices` (§4). */}
          <KpiCell label="Outstanding AR" value={money(data?.ar?.outstandingAR)} loading={loading} unavailable={err.ar} />
          <KpiCell label="Open Invoices" value={count(data?.ar?.openInvoices)} loading={loading} unavailable={err.ar} />
          <ComingSoonCell label="Expected This Mo." />
        </>
      ),
    },
  ].filter(Boolean);

  const co = data?.company;

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: SP.xl }}>
      {/* ── Welcome hero ── */}
      <div style={{ position: "relative", borderRadius: R.hero, overflow: "hidden", background: `${HERO_SCRIM}, url(${heroImg})`, backgroundSize: "cover", backgroundPosition: "center", padding: "40px 36px", color: "#fff" }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: C.teal, fontFamily: F.ui, marginBottom: SP.sm }}>
          Welcome to SubCon Command
        </div>
        <div style={{ fontSize: FS.hero, lineHeight: 1.02, fontWeight: 900, fontFamily: F.display, letterSpacing: "0.02em", textTransform: "uppercase", maxWidth: 720 }}>
          Run the whole business from one screen
        </div>
        <div style={{ fontSize: 15, color: "rgba(255,255,255,0.82)", fontFamily: F.body, marginTop: SP.md, maxWidth: 560 }}>
          Sales, Schedule, Field, and A/R — one command center. See where the business stands, then drill in.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: SP.lg, marginTop: SP.xl }}>
          {["Built by a sub, for subs", "One place for every command", "See the whole job, start to paid"].map(v => (
            <div key={v} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.9)", fontFamily: F.ui, fontWeight: 600 }}>
              <span style={{ color: C.teal }}>◆</span> {v}
            </div>
          ))}
        </div>
        <div style={{ marginTop: SP.xl, display: "inline-block", background: "rgba(0,0,0,0.28)", border: `1px solid ${C.tealBorder}`, borderRadius: R.chip, padding: "10px 16px", fontFamily: F.display, fontSize: 16, fontWeight: 800, letterSpacing: "0.04em", color: C.teal }}>
          Build smarter. Run stronger.
        </div>
      </div>

      {/* ── empty state (no apps assigned) ── */}
      {visibleGroups.length === 0 ? (
        <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: "40px 28px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🧭</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>No apps assigned yet</div>
          <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, marginTop: 6 }}>Ask your admin to give you access to a Command app.</div>
        </div>
      ) : (
        <>
          {/* ── Your Command Center: 4 cards ── */}
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: SP.md }}>Your Command Center</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: SP.lg }}>
              {cardDefs.map(def => <CommandCard key={def.group.app} {...def} />)}
            </div>
          </div>

          {/* ── Company Snapshot ── */}
          <Panel title="Company Snapshot">
            <div style={{ display: "flex", flexWrap: "wrap", gap: SP.xl }}>
              <SnapshotTile label="Sold YTD" value={money(co?.soldYTD)} loading={loading} />
              <SnapshotTile label="Avg Quoted Margin (Sold YTD)" value={pct(co?.avgQuotedMargin)} loading={loading} title="Margin quoted at sale — not realized profit on finished jobs" />
              <SnapshotTile label="Jobs YTD" value={count(co?.jobsYTD)} loading={loading} />
              <SnapshotTile label="Active Crews" value={count(co?.activeCrews)} loading={loading} />
            </div>
          </Panel>

          {/* ── Needs Attention + What's Happening ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: SP.lg }}>
            <Panel title="Needs Attention">
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={20} />)}</div>
              ) : (data?.attention?.length ? data.attention.map((row, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => navigate(row.to)}
                  style={{ display: "flex", alignItems: "center", gap: SP.md, background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, padding: "8px 0", cursor: "pointer", textAlign: "left", width: "100%" }}
                >
                  <span style={{ flexShrink: 0, minWidth: 30, fontSize: 20, fontWeight: 900, color: SEV_COLOR[row.severity] || C.textMuted, fontFamily: F.display }}>{row.count}</span>
                  <span style={{ flex: 1, fontSize: 13, color: C.textBody, fontFamily: F.ui }}>{row.label}</span>
                  <span style={{ color: C.textFaint, fontSize: 13 }}>→</span>
                </button>
              )) : (
                <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, padding: "6px 0" }}>Nothing needs attention right now. 👍</div>
              ))}
            </Panel>

            <Panel title="What's Happening" action="View All" onAction={() => navigate("/schedule/jobs")}>
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>{[0, 1, 2, 3].map(i => <Skeleton key={i} w="100%" h={18} />)}</div>
              ) : (data?.activity?.length ? data.activity.map((ev, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => ev.to && navigate(ev.to)}
                  style={{ display: "flex", alignItems: "baseline", gap: SP.md, background: "transparent", border: "none", padding: "6px 0", cursor: ev.to ? "pointer" : "default", textAlign: "left", width: "100%" }}
                >
                  <span style={{ flexShrink: 0, minWidth: 34, fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.ui }}>{whenLabel(ev.when)}</span>
                  <span style={{ flex: 1, fontSize: 13, color: C.textBody, fontFamily: F.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.text}</span>
                </button>
              )) : (
                <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, padding: "6px 0" }}>No recent activity this week.</div>
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
