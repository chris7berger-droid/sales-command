// Home — ENGAGEMENT redesign (docs/plans/home-engagement-redesign.md).
// A reskin of the shipped follow-up engine into the shape of
// docs/home-engagement-mockup-v1.png. Build order of truth: part 5 > part 4 >
// parts 1–3 > original boxes. Six boxes, top → bottom:
//   1. YOU (personal win) — never displaced.
//   2. Money bar (personal; carries all pace/pressure) + donut.
//   3. Business, in the open (shared: crew runway AS-IS + goal thermometer).
//   4. Your book (personal scoreboard: Wants Bid → Has Bid → Sold, tap to drill).
//   5. What you owe (bids due + self-set follow-ups; celebrates when clear).
//   6. Where to hunt (opportunity finder + dormant/quiet lists).
// Style rules (CLAUDE.md): NO white backgrounds; teal buttons get BLACK text.
import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { C, F, SP, R, FS } from "../lib/tokens";
import { fmt$ } from "../lib/utils";
import { useAlerts } from "../lib/alerts";
import { useTenantConfig } from "../lib/TenantConfigContext";
import { homeEngagement, owedItems, dormantCustomers, goneQuietBids, huntResults, SUPPRESSION_WINDOWS } from "../lib/followUp";
import RunwayBar from "../components/followup/RunwayBar";
import MoneyDonut from "../components/followup/MoneyDonut";
import GoalThermometer from "../components/followup/GoalThermometer";
import HuntBox from "../components/followup/HuntBox";
import HuntResultsPanel from "../components/followup/HuntResultsPanel";
import LogOutcomeModal from "../components/followup/LogOutcomeModal";
import heroImg from "../assets/hero/hero-01.jpg";

const LIGHT = "#f3ede1";            // light ink on the dark hero / hunt panels
const LIGHT_MUTED = "rgba(243,237,225,0.72)";
const pctOf = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);
const OWED_PREVIEW = 8;             // What You Owe caps to the most-overdue few, rest behind an expander

function BoxLabel({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SP.md }}>
      <div style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textLight, fontFamily: F.ui }}>{children}</div>
      {right}
    </div>
  );
}

export default function Home({ displayName = "there", displayRole = "Sales Rep", repName = "" }) {
  const navigate = useNavigate();
  const cfg = useTenantConfig();
  const { snapshot, loading, hasSnapshot, firstLoadError, refresh } = useAlerts();

  const canManage = ["Admin", "Manager"].includes(displayRole);
  const [logTarget, setLogTarget] = useState(null);
  const [showAllOwed, setShowAllOwed] = useState(false);
  const [toast, setToast] = useState(null);

  // auto-dismiss the "logged" confirmation
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const firstName = (repName || displayName).split(" ")[0];
  const h = new Date().getHours();
  const partOfDay = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const eng = useMemo(
    () => (snapshot ? homeEngagement(snapshot, { repName, monthlyGoal: cfg.monthly_billing_goal }) : null),
    [snapshot, repName, cfg.monthly_billing_goal]
  );
  const owed = useMemo(() => (snapshot ? owedItems(snapshot, { repName }) : []), [snapshot, repName]);
  const repGoneQuiet = useMemo(() => (snapshot ? goneQuietBids(snapshot, { repName }) : []), [snapshot, repName]);
  const repDormant = useMemo(() => (snapshot ? dormantCustomers(snapshot, { repName }) : []), [snapshot, repName]);
  const results = useMemo(() => (snapshot ? huntResults(snapshot, { repName }) : { callsThisWeek: 0, reengaged: 0 }), [snapshot, repName]);

  const loadingCore = !hasSnapshot && loading;

  const onGoTo = (card) => {
    if (card.callLogId) navigate(`/calllog/${card.callLogId}`, { state: { from: "/home" } });
    else if (card.customerId) navigate(`/customers/${card.customerId}`);
  };

  if (loadingCore) return <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>Loading…</div>;
  if (firstLoadError) return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.red, fontFamily: F.ui }}>
      Couldn't load. <button onClick={refresh} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.tealDark, fontWeight: 700, fontFamily: F.ui }}>Retry</button>
    </div>
  );
  if (!eng) return null;

  const { hero, bar, donut, scoreboard, thermometer, target } = eng;

  // ── Money bar geometry ──
  const fillPct = Math.min(100, target > 0 ? (bar.sold / target) * 100 : 0);
  const paceMove = `${fmt$(bar.gap)} to go — one good job, or ${repGoneQuiet.length} quiet bid${repGoneQuiet.length === 1 ? "" : "s"} you already have out.`;

  // ── Donut views (2 only: booked-vs-left → big-vs-small) ──
  const soldTotal = donut.large + donut.small;
  const donutViews = [
    {
      tapLabel: "Booked vs Left", // MoneyDonut shows the NEXT view's tapLabel as the tap hint
      center: `${pctOf(donut.booked, donut.booked + donut.left) || (donut.over ? 100 : 0)}%`,
      centerSub: "booked",
      over: donut.over,
      slices: [
        { label: "Booked", value: donut.booked, color: C.teal, pct: pctOf(donut.booked, donut.booked + donut.left) },
        { label: "Left to go", value: donut.left, color: C.linenDeep, pct: pctOf(donut.left, donut.booked + donut.left) },
      ],
    },
    {
      tapLabel: "Big vs Small",
      center: fmt$(soldTotal),
      centerSub: "sold",
      slices: [
        { label: "Large ≥ $50K", value: donut.large, color: C.tealDeep, pct: pctOf(donut.large, soldTotal) },
        { label: "Small < $50K", value: donut.small, color: C.amber, pct: pctOf(donut.small, soldTotal) },
      ],
    },
  ];

  // ── Scoreboard (Box 4) tiles ──
  const tiles = [
    { stage: "Wants Bid", data: scoreboard["Wants Bid"], note: "waiting on your number" },
    { stage: "Has Bid", data: scoreboard["Has Bid"], note: "out the door" },
    { stage: "Sold", data: scoreboard.Sold, note: "closed this month" },
  ];
  const openTile = (stage) => navigate("/calllog", { state: { stageFilter: stage, sales: repName } });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: SP.xxl, maxWidth: 1600 }}>

      {/* ── BOX 1 · YOU (personal win) ───────────────────────────────────── */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: R.hero, background: C.dark, minHeight: 190 }}>
        <img src={heroImg} alt="" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "62%", height: "100%", objectFit: "cover", objectPosition: "center" }} />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${C.dark} 42%, rgba(28,24,20,0.72) 62%, rgba(28,24,20,0.10) 100%)` }} />
        <div style={{ position: "relative", padding: SP.xl }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SP.md }}>
            <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "rgba(243,237,225,0.5)", fontFamily: F.ui }}>{dateStr}</span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: LIGHT, fontFamily: F.body, marginBottom: SP.sm }}>
            Good {partOfDay}, {firstName}. <span aria-hidden>👋</span>
          </div>

          {hero.state === "results" && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: SP.md, flexWrap: "wrap" }}>
                <span style={{ fontSize: FS.hero, fontWeight: 800, color: LIGHT, fontFamily: F.display, lineHeight: 0.95, letterSpacing: "0.01em" }}>{fmt$(hero.sold)}</span>
                <span style={{ fontSize: FS.sub, fontWeight: 700, color: C.teal, fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.04em" }}>sold this month</span>
                {hero.bestMonth && (
                  <span style={{ background: C.teal, color: C.dark, fontSize: 11, fontWeight: 800, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em", borderRadius: R.chip, padding: "4px 10px" }}>★ Best month this year</span>
                )}
              </div>
              <div style={{ fontSize: 14, color: LIGHT_MUTED, fontFamily: F.body, marginTop: SP.sm }}>
                {hero.soldCount} job{hero.soldCount === 1 ? "" : "s"} closed this month — keep stacking wins.
              </div>
            </>
          )}

          {hero.state === "effort" && (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: SP.md, flexWrap: "wrap" }}>
                <span style={{ fontSize: FS.hero, fontWeight: 800, color: LIGHT, fontFamily: F.display, lineHeight: 0.95 }}>{hero.callsThisMonth}</span>
                <span style={{ fontSize: FS.sub, fontWeight: 700, color: C.teal, fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.04em" }}>calls logged this month</span>
              </div>
              <div style={{ fontSize: 14, color: LIGHT_MUTED, fontFamily: F.body, marginTop: SP.sm }}>
                {hero.bidsOut} bid{hero.bidsOut === 1 ? "" : "s"} out — you're doing the work, it's coming.
              </div>
            </>
          )}

          {hero.state === "fresh" && (
            <div style={{ fontSize: 30, fontWeight: 800, color: LIGHT, fontFamily: F.display, letterSpacing: "0.02em", marginTop: SP.xs, maxWidth: 420 }}>
              Fresh month — your first move sets the tone.
            </div>
          )}
        </div>
      </div>

      {/* ── BOX 2 · MONEY BAR (personal; carries pace) + donut ───────────── */}
      <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
        <BoxLabel>Your Money · Month Progress</BoxLabel>
        <div style={{ display: "flex", gap: SP.xl, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: "1 1 340px", minWidth: 280 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: SP.sm, marginBottom: SP.md }}>
              <span style={{ fontSize: FS.boxNum, fontWeight: 800, color: C.tealDeep, fontFamily: F.display, lineHeight: 1 }}>{fmt$(bar.sold)}</span>
              <span style={{ fontSize: 14, color: C.textMuted, fontFamily: F.body }}>of {fmt$(target)} target</span>
              <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: bar.behind ? C.amber : C.tealDark, fontFamily: F.ui }}>
                {bar.behind ? "behind pace" : "on pace"}
              </span>
            </div>
            {/* labeled pace marker — the line isn't a mystery: it's where an even
                month would have you today (clamp the label so it can't clip an edge). */}
            <div style={{ position: "relative", height: 13 }}>
              <div style={{ position: "absolute", bottom: 0, left: `${Math.min(88, Math.max(12, bar.pacePct))}%`, transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: bar.behind ? C.amber : C.tealDeep, fontFamily: F.ui }}>
                should be here today ▾
              </div>
            </div>
            <div style={{ position: "relative", height: 14, borderRadius: 7, background: C.linenDeep, overflow: "visible" }}>
              <div style={{ width: `${fillPct}%`, height: "100%", background: C.teal, borderRadius: 7, transition: "width 0.4s ease" }} />
              <div title="where you should be by today" style={{ position: "absolute", top: -4, bottom: -4, left: `${Math.min(100, bar.pacePct)}%`, width: 2.5, background: bar.behind ? C.amber : C.tealDeep, borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textBody, fontFamily: F.ui, marginTop: SP.md }}>{paceMove}</div>
          </div>
          <div style={{ flex: "0 0 auto", width: 150 }}>
            <MoneyDonut views={donutViews} />
          </div>
        </div>
      </div>

      {/* ── BOX 3 · THE BUSINESS, IN THE OPEN (shared) ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: SP.lg }}>
        <RunwayBar canManage={canManage} />
        <GoalThermometer sold={thermometer.sold} goal={thermometer.goal} pct={thermometer.pct} />
      </div>

      {/* ── BOX 4 · YOUR BOOK (scoreboard / the doorway) ─────────────────── */}
      <div>
        <BoxLabel>Your Book</BoxLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: SP.lg }}>
          {tiles.map(({ stage, data, note }) => (
            <button key={stage} onClick={() => openTile(stage)}
              style={{ textAlign: "left", background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, cursor: "pointer", boxShadow: "0 2px 8px rgba(28,24,20,0.07)", transition: "transform 0.12s, box-shadow 0.12s" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(28,24,20,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(28,24,20,0.07)"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SP.sm }}>
                <span style={{ fontSize: FS.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>{stage}</span>
                <span style={{ color: C.tealDark, fontSize: 15 }}>→</span>
              </div>
              <div style={{ fontSize: FS.boxNum, fontWeight: 800, color: C.textHead, fontFamily: F.display, lineHeight: 1 }}>{fmt$(data?.amount || 0)}</div>
              <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, marginTop: SP.xs }}>{data?.count || 0} {note}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── BOX 5 · WHAT YOU OWE (full-width) ────────────────────────────── */}
      <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: R.card, padding: SP.xl, boxShadow: "0 2px 8px rgba(28,24,20,0.07)" }}>
        <BoxLabel right={owed.length > 0 && <span style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui }}>{owed.length} open · oldest first</span>}>Where To Dig</BoxLabel>
        {owed.length === 0 ? (
          <div style={{ fontSize: 15, fontWeight: 700, color: C.tealDark, fontFamily: F.body }}>All caught up — go hunt. 🎯</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: SP.sm }}>
            {(showAllOwed ? owed : owed.slice(0, OWED_PREVIEW)).map(item => {
              const overdue = item.date && item.date < new Date().toLocaleDateString("en-CA");
              return (
                <button key={`${item.kind}-${item.id}`} onClick={() => navigate(`/calllog/${item.id}`, { state: { from: "/home" } })}
                  style={{ textAlign: "left", display: "flex", alignItems: "center", gap: SP.md, background: C.linen, border: `1px solid ${C.border}`, borderLeft: `3px solid ${overdue ? C.red : C.amber}`, borderRadius: R.chip, padding: "10px 14px", cursor: "pointer" }}>
                  <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${C.borderStrong}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "45%" }}>{item.title}</span>
                  <span style={{ fontSize: 12, color: C.textMuted, fontFamily: F.body, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sub}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: overdue ? C.red : C.amber, fontFamily: F.ui, whiteSpace: "nowrap" }}>
                    {item.kind === "bid" ? "bid" : "follow-up"} {overdue ? "· overdue" : ""}
                  </span>
                </button>
              );
            })}
            {owed.length > OWED_PREVIEW && (
              <button onClick={() => setShowAllOwed(s => !s)}
                style={{ alignSelf: "flex-start", marginTop: SP.xs, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {showAllOwed ? "Show fewer ▴" : `+ ${owed.length - OWED_PREVIEW} more ▾`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── BOX 6 · WHERE TO HUNT + results companion ────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: SP.lg, alignItems: "start" }}>
        <HuntBox goneQuiet={repGoneQuiet} dormant={repDormant} onGoTo={onGoTo} onLog={setLogTarget} />
        <HuntResultsPanel callsThisWeek={results.callsThisWeek} reengaged={results.reengaged} />
      </div>

      {/* footer · controllables + manual refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: SP.md }}>
        <span style={{ fontSize: 12, color: C.textFaint, fontFamily: F.body, fontStyle: "italic" }}>Control the controllables. Pull the door.</span>
        <button onClick={refresh} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: C.tealDark, fontFamily: F.ui, textTransform: "uppercase", letterSpacing: "0.06em" }}>↻ Refresh</button>
      </div>

      {logTarget && (
        <LogOutcomeModal item={logTarget} loggedBy={displayName} onClose={() => setLogTarget(null)}
          onLogged={(outcome) => {
            const days = SUPPRESSION_WINDOWS[outcome];
            const who = logTarget?.name || "That job";
            setToast(days ? `Logged — ${who} drops off your list, back in ${days} days.` : "Logged.");
            setLogTarget(null);
            refresh();
          }} />
      )}

      {/* confirmation so a logged call never feels like a job vanished */}
      {toast && (
        <div style={{ position: "fixed", bottom: SP.xl, left: "50%", transform: "translateX(-50%)", zIndex: 200,
          background: C.dark, color: C.teal, fontFamily: F.ui, fontSize: 13, fontWeight: 700,
          padding: "12px 20px", borderRadius: R.chip, boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: SP.md }}>
          <span>✓ {toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(48,207,172,0.55)", fontSize: 15, padding: 0 }}>✕</button>
        </div>
      )}
    </div>
  );
}
