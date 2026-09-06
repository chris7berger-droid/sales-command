import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, SP, R, FS } from "../lib/tokens";
import { GROUPS, groupVisible } from "../lib/nav";
import { useTenantConfig } from "../lib/TenantConfigContext";
import { loadSubconSummary } from "../lib/subconSummary";
import heroImg from "../assets/hero/hero-01.jpg";

// Subcon Command home (`/`) — the company-level executive command center. Fast
// cross-command read (Sales / Schedule / Field / AR) + a launch surface. Home
// IDENTIFIES; the Commands handle. Numbers reuse each module's canonical calc via
// loadSubconSummary; unbacked sources wear a wired "Coming soon" slot. Visual pass
// tracks the executive-dashboard mockup: dark accent command cards, photo hero.

// ── formatting ───────────────────────────────────────────────────────────────
const money = n => (n == null ? "—" : "$" + Math.round(n).toLocaleString());
const count = n => (n == null ? "—" : Number(n).toLocaleString());
const pct = n => (n == null ? "—" : Math.round(n) + "%");

// Relative "2h ago / 3d ago" for the activity feed; falls back to a date past a week.
const whenLabel = iso => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  const dt = new Date(iso);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
};

// Welcome hero — the construction/sunrise photo under a left-anchored dark scrim
// so the headline stays readable while the photo shows on the right. (Drop a real
// construction-sunset shot in as src/assets/hero/hero-01.jpg to match the mockup.)
const HERO_SCRIM =
  "linear-gradient(90deg, rgba(28,24,20,0.95) 0%, rgba(28,24,20,0.82) 38%, rgba(28,24,20,0.28) 100%)";
const CACHE_KEY = "sc_subcon_home_cache";

// per-command accent color + readable ENTER-button text
const ACCENTS = {
  sales:    { c: C.green,  enterText: "#fff" },
  schedule: { c: C.teal,   enterText: C.dark },
  field:    { c: C.amber,  enterText: C.dark },
  ar:       { c: C.purple, enterText: "#fff" },
};

const VALUE_PROPS = [
  { icon: "🎯", head: "More Jobs", sub: "Win the right work." },
  { icon: "⚙️", head: "Smoother Operations", sub: "Keep crews moving." },
  { icon: "📈", head: "Stronger Profits", sub: "Turn work into results." },
];

const KIND_DOT = { schedule: C.teal, invoice: C.amber, payment: C.green };

// ── small primitives ─────────────────────────────────────────────────────────
function Skeleton({ w = 64, h = 26, dark }) {
  return <div style={{ width: w, height: h, borderRadius: 6, background: dark ? "rgba(255,255,255,0.16)" : C.linenDeep, opacity: dark ? 1 : 0.55 }} />;
}

// KPI cell: big number + label. `dark` = white-on-dark (inside a command card).
// Clickable → records when `to` is set; `navState` hands the target a filter.
function KpiCell({ label, value, loading, to, navState, unavailable, dark }) {
  const navigate = useNavigate();
  const clickable = to && !loading && !unavailable;
  const numColor = dark ? (unavailable ? "rgba(255,255,255,0.4)" : "#fff") : (unavailable ? C.textFaint : C.textHead);
  const labelColor = dark ? "rgba(255,255,255,0.6)" : C.textLight;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => navigate(to, navState ? { state: navState } : undefined) : undefined}
      style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: clickable ? "pointer" : "default", display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}
    >
      {loading ? <Skeleton dark={dark} /> : (
        <span style={{ fontSize: FS.boxNum, lineHeight: 1, fontWeight: 900, color: numColor, fontFamily: F.display, letterSpacing: "0.01em" }}>
          {unavailable ? "—" : value}
        </span>
      )}
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: labelColor, fontFamily: F.ui }}>
        {label}
      </span>
    </button>
  );
}

function ComingSoonCell({ label, dark }) {
  const v = dark ? "rgba(255,255,255,0.82)" : C.textMuted;
  const l = dark ? "rgba(255,255,255,0.6)" : C.textLight;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: FS.sub, fontWeight: 800, color: v, fontFamily: F.display, letterSpacing: "0.02em" }}>Coming soon</span>
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: l, fontFamily: F.ui }}>{label}</span>
    </div>
  );
}

// One command card — dark, with the command's accent on the icon badge + ENTER bar.
function CommandCard({ group, tagline, accent, cells, quickLinks }) {
  const navigate = useNavigate();
  const enterLabel = group.label.replace(/ Command$/i, "");
  return (
    <div style={{ background: C.darkRaised, border: `1px solid ${C.darkBorder}`, borderRadius: R.card, padding: SP.xl, display: "flex", flexDirection: "column", gap: SP.lg, boxShadow: "0 6px 22px rgba(0,0,0,0.28)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: SP.md }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: accent.c, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{group.icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#fff", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            {group.label} <span style={{ color: accent.c }}>›</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 700 }}>{tagline}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: SP.md }}>{cells}</div>

      <button
        type="button"
        onClick={() => navigate(group.home)}
        style={{ width: "100%", background: accent.c, color: accent.enterText, border: "none", borderRadius: R.chip, padding: "11px", fontSize: 12.5, fontWeight: 800, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
      >
        Enter {enterLabel} →
      </button>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center", borderTop: `1px solid ${C.darkBorder}`, paddingTop: SP.md }}>
        {quickLinks.map(ql => (
          <button key={ql.label} type="button" onClick={() => navigate(ql.to)} style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.7)", fontFamily: F.ui, background: "transparent", border: "none", cursor: "pointer", letterSpacing: "0.02em" }}>
            {ql.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SnapshotTile({ label, value, loading, icon, color, title }) {
  return (
    <div title={title} style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 130 }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{icon}</div>
      {loading ? <Skeleton /> : (
        <span style={{ fontSize: 26, fontWeight: 900, color: C.textHead, fontFamily: F.display }}>{value}</span>
      )}
      <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textLight, fontFamily: F.ui }}>{label}</span>
    </div>
  );
}

const SEV_COLOR = { high: C.red, med: C.amber, low: C.purple };

function Panel({ title, action, onAction, children }) {
  return (
    <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, boxShadow: "0 2px 8px rgba(28,24,20,0.07)", display: "flex", flexDirection: "column", gap: SP.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>{title}</div>
        {action && <button type="button" onClick={onAction} style={{ background: "transparent", border: "none", color: C.tealDark, fontSize: 12, fontWeight: 700, fontFamily: F.ui, cursor: "pointer" }}>{action} →</button>}
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

  // Route `/` is the heaviest load in the suite. Cache in sessionStorage and skip
  // the refetch if it's <60s old, so bouncing back doesn't re-run ~13 queries.
  useEffect(() => {
    let alive = true;
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (c?.data) {
        setData(c.data);
        setLoading(false);
        if (c.ts && Date.now() - c.ts < 60000) return;
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
      group: groupByApp.sales, tagline: "Fill the pipeline", accent: ACCENTS.sales,
      quickLinks: [{ label: "Call Log", to: "/sales/calllog" }, { label: "Proposals", to: "/sales/proposals" }, { label: "Customers", to: "/sales/customers" }],
      cells: (
        <>
          <KpiCell dark label="Active Leads" value={count(data?.sales?.activeLeads)} loading={loading} to="/sales/calllog" unavailable={err.sales} />
          <KpiCell dark label="Bids Out" value={count(data?.sales?.bidsOut)} loading={loading} to="/sales/calllog" navState={{ stageFilter: "Has Bid" }} unavailable={err.sales} />
          <KpiCell dark label="Potential Rev" value={money(data?.sales?.potentialRevenue)} loading={loading} to="/sales/proposals" unavailable={err.sales} />
        </>
      ),
    },
    groupByApp.schedule && {
      group: groupByApp.schedule, tagline: "Plan the work", accent: ACCENTS.schedule,
      quickLinks: [{ label: "Jobs", to: "/schedule/jobs" }, { label: "Crew Schedule", to: "/schedule/schedule" }, { label: "Calendar", to: "/schedule/calendar" }],
      cells: (
        <>
          <KpiCell dark label="Crew Available" value={count(data?.schedule?.crewAvailable)} loading={loading} to="/schedule/schedule" unavailable={err.schedule} />
          <KpiCell dark label="Jobs Assigned" value={count(data?.schedule?.jobsAssigned)} loading={loading} to="/schedule/jobs" unavailable={err.schedule} />
          <KpiCell dark label="Next 30 Days" value={money(data?.schedule?.scheduledToBill)} loading={loading} to="/schedule/billing" unavailable={err.schedule} />
        </>
      ),
    },
    groupByApp.field && {
      group: groupByApp.field, tagline: "Execute the work", accent: ACCENTS.field,
      quickLinks: [{ label: "Daily Logs", to: "/field/dailylogs" }, { label: "Jobs", to: "/field/jobs" }, { label: "Today", to: "/field/today" }],
      cells: (
        <>
          <KpiCell dark label="Jobs In Progress" value={count(data?.field?.jobsInProgress)} loading={loading} to="/field/jobs" unavailable={err.schedule} />
          <ComingSoonCell dark label="On Track %" />
          <ComingSoonCell dark label="Need Attention" />
        </>
      ),
    },
    groupByApp.ar && {
      group: groupByApp.ar, tagline: "Get paid", accent: ACCENTS.ar,
      quickLinks: [{ label: "A/R Aging", to: "/ar/aging" }, { label: "Invoices", to: "/ar/invoices" }, { label: "Triage", to: "/ar/triage" }],
      cells: (
        <>
          {/* Display-only: Home's AR numbers come from the live invoices table, but
              the AR module still gates on its QuickBooks-import store, so a click
              would land on "upload a QB export" (audit B2). Re-enable when AR reads
              `invoices` (§4). */}
          <KpiCell dark label="Outstanding AR" value={money(data?.ar?.outstandingAR)} loading={loading} unavailable={err.ar} />
          <KpiCell dark label="Open Invoices" value={count(data?.ar?.openInvoices)} loading={loading} unavailable={err.ar} />
          <ComingSoonCell dark label="Expected This Mo." />
        </>
      ),
    },
  ].filter(Boolean);

  const co = data?.company;

  return (
    <div style={{ maxWidth: 1240, display: "flex", flexDirection: "column", gap: SP.xl }}>
      {/* ── Welcome hero ── */}
      <div style={{ position: "relative", borderRadius: R.hero, overflow: "hidden", background: `${HERO_SCRIM}, url(${heroImg})`, backgroundSize: "cover", backgroundPosition: "center", padding: "36px 40px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: SP.xl, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 660 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase", color: C.teal, fontFamily: F.ui, marginBottom: 4 }}>Welcome to</div>
          <div style={{ fontSize: FS.hero, lineHeight: 0.98, fontWeight: 900, fontFamily: F.display, letterSpacing: "0.01em" }}>
            SubCon <span style={{ color: C.teal }}>Command</span>
          </div>
          <div style={{ fontSize: 16, color: "rgba(255,255,255,0.85)", fontFamily: F.body, marginTop: SP.sm }}>
            One system. Every phase. A more profitable tomorrow.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: SP.xl, marginTop: SP.xl }}>
            {VALUE_PROPS.map(v => (
              <div key={v.head} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 38, height: 38, borderRadius: "50%", background: C.tealGlow, border: `1px solid ${C.tealBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{v.icon}</span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.06em" }}>{v.head}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.68)", fontFamily: F.ui }}>{v.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ alignSelf: "flex-start", background: "rgba(0,0,0,0.42)", border: `1px solid ${C.darkBorder}`, borderRadius: R.card, padding: "20px 24px", minWidth: 190 }}>
          <div style={{ fontSize: 26, fontWeight: 900, fontFamily: F.display, color: "#fff", lineHeight: 1.05, textTransform: "uppercase", letterSpacing: "0.02em" }}>Build smarter.<br />Run stronger.</div>
          <div style={{ width: 46, height: 3, background: C.amber, marginTop: 12, borderRadius: 2 }} />
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
          {/* ── Your Command Center: cards ── */}
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>Your Command Center</div>
            <div style={{ fontSize: 13.5, color: C.textMuted, fontFamily: F.ui, marginTop: 2, marginBottom: SP.lg }}>Pick a command to get to work, or review the big picture.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: SP.lg }}>
              {cardDefs.map(def => <CommandCard key={def.group.app} {...def} />)}
            </div>
          </div>

          {/* ── Company Snapshot ── */}
          <Panel title="Company Snapshot">
            <div style={{ display: "flex", flexWrap: "wrap", gap: SP.xl }}>
              <SnapshotTile label="Sold YTD" value={money(co?.soldYTD)} loading={loading} icon="💰" color={C.green} />
              <SnapshotTile label="Avg Quoted Margin (Sold YTD)" value={pct(co?.avgQuotedMargin)} loading={loading} icon="📊" color={C.amber} title="Margin quoted at sale — not realized profit on finished jobs" />
              <SnapshotTile label="Jobs YTD" value={count(co?.jobsYTD)} loading={loading} icon="🏗" color={C.tealDark} />
              <SnapshotTile label="Active Crews" value={count(co?.activeCrews)} loading={loading} icon="👥" color={C.purple} />
            </div>
          </Panel>

          {/* ── Needs Attention + What's Happening ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: SP.lg }}>
            <Panel title="Needs Attention" action={data?.attention?.length ? "View All" : null} onAction={() => navigate("/schedule/jobs")}>
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={20} />)}</div>
              ) : (data?.attention?.length ? data.attention.map((row, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => navigate(row.to)}
                  style={{ display: "flex", alignItems: "center", gap: SP.md, background: "transparent", border: "none", borderBottom: `1px solid ${C.border}`, padding: "9px 0", cursor: "pointer", textAlign: "left", width: "100%" }}
                >
                  <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: SEV_COLOR[row.severity] || C.textMuted, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, fontFamily: F.display }}>{row.count}</span>
                  <span style={{ flex: 1, fontSize: 13.5, color: C.textBody, fontFamily: F.ui }}>{row.label}</span>
                  <span style={{ color: C.textFaint, fontSize: 14 }}>›</span>
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
                  style={{ display: "flex", alignItems: "center", gap: SP.md, background: "transparent", border: "none", padding: "8px 0", cursor: ev.to ? "pointer" : "default", textAlign: "left", width: "100%" }}
                >
                  <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: KIND_DOT[ev.kind] || C.textLight }} />
                  <span style={{ flex: 1, fontSize: 13.5, color: C.textBody, fontFamily: F.ui, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.text}</span>
                  <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: C.textFaint, fontFamily: F.ui }}>{whenLabel(ev.when)}</span>
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
