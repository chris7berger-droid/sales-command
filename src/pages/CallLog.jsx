import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmtD, fmt$, over, tod } from "../lib/utils";
import { pipelineStats, OWED_STAGES } from "../lib/followUp";
import { STAGES, STAGE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import PipelinePanel from "../components/PipelinePanel";
import SalesIntelligence from "../components/followup/SalesIntelligence";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import CallLogDetail from "../components/CallLogDetail";
import FilterBar from "../components/FilterBar";
import NewInquiryWizard from "../components/NewInquiryWizard";
import { useAlerts } from "../lib/alerts";
import { useTenantConfig } from "../lib/TenantConfigContext";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CallLog({ teamMember, setSubPage }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeJobId } = useParams();
  const navState = location.state || {};
  const { snapshot, refresh: refreshAlerts } = useAlerts();
  const cfg = useTenantConfig();
  const [leadCount, setLeadCount] = useState(0); // open campaign lead count (bolt-on)
  const [rows, setRows]           = useState([]);
  const [team, setTeam]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState(navState.stageFilter || "All");
  const [digFilter, setDigFilter] = useState(null); // null | "dueToday" | "overdue" | "followups" — Where-to-Dig lens
  const [pipeFilter, setPipeFilter] = useState(null); // { key, ids:Set } — exact jobs behind a clicked pipeline stat
  const [q, setQ]                 = useState("");
  const [atList, setAtList]       = useState(false); // scroll position: true once the ALL JOBS section reaches the top
  const commandRef = useRef(null); // top of the command center
  const listRef = useRef(null);    // the "ALL JOBS" divider — start of the list workspace
  // Seed `sales` from nav-state so a Home "Your Book" tile tap opens THIS rep's
  // own filtered pile, not the company-wide stage list (engagement redesign N1/A2).
  const [filters, setFilters]     = useState({ sales: navState.sales || "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });
  const [showModal, setShowModal] = useState(false);
  const [coParent, setCoParent]   = useState(null);
  const [selJob, setSelJob]       = useState(null);
  const [showOld, setShowOld]     = useState(false);
  const [intelScope, setIntelScope] = useState("me"); // manager toggle: "me" | "company" (action cards scope)
  const [archiveBanner, setArchiveBanner] = useState(null);
  const bidDueFilter = !!navState.bidDueFilter;

  const CACHE_KEY = "sc_calllog_cache";

  const load = async () => {
    // Show cached data instantly if available
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const c = JSON.parse(cached);
        if (c.rows?.length) { setRows(c.rows); setTeam(c.team || []); setCustomers(c.customers || []); setWorkTypes(c.workTypes || []); setLoading(false); }
      }
    } catch {}

    // Fetch fresh data in background
    const [{ data: tm }, { data: wt }, allCx, { data: config }] = await Promise.all([
      supabase.from("team_members").select("*").order("name"),
      supabase.from("work_types").select("*").order("name"),
      fetchAll("customers", "*", { order: "name" }),
      supabase.from("tenant_config").select("archive_after_months, archive_stages").limit(1).single(),
    ]);

    // Auto-archive: mark old jobs matching tenant criteria
    const months = config?.archive_after_months ?? 12;
    const stages = config?.archive_stages ?? ["Lost"];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    if (stages.length > 0) {
      const { data: toArchive } = await supabase
        .from("call_log")
        .select("id")
        .eq("archived", false)
        .in("stage", stages)
        .lt("created_at", cutoffStr);
      if (toArchive && toArchive.length > 0) {
        const ids = toArchive.map(r => r.id);
        await supabase.from("call_log").update({ archived: true }).in("id", ids);
        setArchiveBanner(toArchive.length);
      }
    }

    // Paginate call_log with joins (PostgREST caps at 1000 rows)
    const PAGE = 500;
    let allLog = [], from = 0;
    while (true) {
      const { data } = await supabase
        .from("call_log")
        .select("*, job_work_types(*), customers(id, contact_email, contact_phone, first_name, last_name, business_address, business_city, business_state, business_zip, billing_terms, billing_same, billing_name, billing_phone, billing_email, requires_pay_app)")
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      allLog = allLog.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    // Proposals — just call_log_id + customer_id, to count distinct GCs per job
    // (the multi-GC chip). Pipeline $ now comes from the shared pipelineStats
    // selector over the useAlerts snapshot, not a second fetch here.
    const pcData = await fetchAll("proposals", "call_log_id, customer_id", {
      filters: [["is", "deleted_at", null]],
    });
    const clById = new Map(allLog.map(cl => [cl.id, cl]));
    const gcsByJob = new Map(allLog.map(cl => [cl.id, new Set()]));
    for (const row of pcData) {
      const set = gcsByJob.get(row.call_log_id);
      if (!set) continue;
      const effective = row.customer_id || clById.get(row.call_log_id)?.customer_id;
      if (effective) set.add(effective);
    }
    for (const cl of allLog) {
      cl._gcCount = gcsByJob.get(cl.id)?.size || 0;
    }

    // Open campaign lead count (bolt-on) — surfaced as a tagged band above the job
    // list. Count-only (head:true) so it isn't capped by the 1000-row page limit.
    if (cfg.leads_enabled) {
      const { count } = await supabase
        .from("leads").select("id", { count: "exact", head: true })
        .not("status", "in", "(converted,junk)");
      setLeadCount(count || 0);
    }

    setRows(allLog);
    setTeam(tm || []);
    setCustomers(allCx);
    setWorkTypes(wt || []);
    setLoading(false);

    // Cache for next visit
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ rows: allLog, team: tm || [], customers: allCx, workTypes: wt || [] })); } catch {}
  };

  useEffect(() => { load(); }, []);

  // Keep selected job in sync with the URL :id param
  useEffect(() => {
    if (!routeJobId) { setSelJob(null); return; }
    if (rows.length === 0) return;
    const job = rows.find(r => String(r.id) === String(routeJobId));
    if (job) setSelJob(job);
  }, [routeJobId, rows]);

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(selJob ? "detail" : showModal ? "new" : null);
  }, [selJob, showModal]);

  // Scroll position → which section (command center vs list) is in view, so the
  // page nav + floating button can reflect it. Listens on the app content
  // scroller ([data-app-content]); the "ALL JOBS" divider (listRef) is the line.
  useEffect(() => {
    const scroller = document.querySelector("[data-app-content]") || window;
    const onScroll = () => {
      const el = listRef.current;
      if (el) setAtList(el.getBoundingClientRect().top <= 160);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [selJob, loading]);

  const wizardEl = (showModal || coParent) ? (
    <NewInquiryWizard
      onClose={() => { setShowModal(false); setCoParent(null); }}
      onSaved={() => { setShowModal(false); setCoParent(null); load(); }}
      team={team}
      customers={customers}
      allJobs={rows}
      workTypes={workTypes}
      initialJobType={coParent ? "co" : null}
      initialParentJobId={coParent ? coParent.id : null}
    />
  ) : null;

  // Show detail page when a job is selected
  if (selJob) {
    return (
      <>
        {wizardEl}
        <CallLogDetail
          job={selJob}
          teamMembers={team}
          workTypes={workTypes}
          onBack={() => navigate(navState.from === "/home" ? "/home" : "/calllog")}
          onSaved={() => { refreshAlerts(); navigate(navState.from === "/home" ? "/home" : "/calllog"); load(); }}
          onJobRefresh={() => load()}
          onDeleted={() => { navigate("/calllog"); load(); }}
          teamMember={teamMember}
          onNewProposal={() => navigate("/proposals", { state: { newJob: selJob } })}
          onAddCO={() => setCoParent(selJob)}
          onNavigateProposal={id => navigate(`/proposals/${id}`)}
          onNavigateInvoice={id => navigate(`/invoices/${id}`)}
          onNavigateCustomer={custId => navigate(`/customers/${custId}`)}
        />
      </>
    );
  }

  const todayStr = tod();
  const woDate = new Date(); woDate.setDate(woDate.getDate() + 7);
  const weekOutStr = woDate.toLocaleDateString("en-CA");
  const matchesDig = (r) => {
    if (digFilter === "dueToday") return r.stage === "Wants Bid" && r.bid_due === todayStr;
    if (digFilter === "overdue")  return r.stage === "Wants Bid" && r.bid_due && r.bid_due < todayStr;
    if (digFilter === "followups") return r.follow_up && r.follow_up <= weekOutStr && OWED_STAGES.has(r.stage);
    return true;
  };
  const activeRows = rows.filter(r => !r.archived);
  const oldRows = rows.filter(r => r.archived);
  // When searching, search ALL rows so old jobs aren't hidden from search results
  const visibleRows = q ? rows : (showOld ? oldRows : activeRows);
  const filtered = visibleRows.filter(r => {
    if (bidDueFilter && r.bid_due !== todayStr) return false;
    if (pipeFilter && !pipeFilter.ids.has(r.id)) return false;
    if (digFilter && !matchesDig(r)) return false;
    if (!bidDueFilter && !digFilter && !pipeFilter && filter !== "All" && r.stage !== filter) return false;
    if (q && !((r.display_job_number || r.job_name)?.toLowerCase().includes(q.toLowerCase()) || String(r.job_number || r.id).includes(q) || (r.customer_name || "").toLowerCase().includes(q.toLowerCase()))) return false;
    if (filters.sales && r.sales_name !== filters.sales) return false;
    if (filters.dateFrom && (r.created_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (r.created_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.workType && !(r.job_work_types || []).some(jwt => String(jwt.work_type_id) === filters.workType)) return false;
    if (filters.customer && !(r.customer_name || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !(r.display_job_number || String(r.job_number || "")).toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  // ─── "Your Pipeline" dark hero panel (§3.1) ──────────────────────────────
  // Numbers come from the ONE shared selector (followUp.pipelineStats over the
  // useAlerts snapshot) — the SAME source as Home's "Your Book" cards, so the two
  // screens can never disagree (de-duped bids, real WTC math, Sold = this month).
  // Scope = the FilterBar Sales Rep dropdown, else the logged-in rep (matches
  // Home). Cards click → filter the table below.
  const myName = teamMember?.name || "";
  const scopeName = filters.sales || myName;
  const pipe = snapshot ? pipelineStats(snapshot, { repName: scopeName }) : null;
  const pLoad = !pipe;

  // "↑ N this week" trend — same snapshot + scope as the numbers.
  const wa = new Date(); wa.setDate(wa.getDate() - 7);
  const weekAgo = wa.toLocaleDateString("en-CA");
  const scopedActive = snapshot ? snapshot.callLog.filter(c => !c.archived && (!scopeName || c.sales_name === scopeName)) : [];
  const since = (stage) => scopedActive.filter(c => (!stage || c.stage === stage) && (c.created_at || "").slice(0, 10) >= weekAgo).length;
  const addedThisWeek = since(null);
  const wbThisWeek = since("Wants Bid");

  // Stage tabs (below the table) — plain stage filter; clears the pipe/dig lenses.
  const pickStage = (st) => {
    setFilter(st);
    setDigFilter(null);
    setPipeFilter(null);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // Pipeline stat click → filter the table to the EXACT jobs that stat counted
  // (id set from the same snapshot/scope), so the list matches the number — incl.
  // Sold = this-month, not the all-time Sold stage.
  const scopedIds = st => new Set(scopedActive.filter(c => c.stage === st).map(c => c.id));
  const soldMonthIds = new Set(pipe ? pipe.soldProps.map(p => p.call_log_id) : []);
  const PIPE_LABEL = { All: "All active", "Wants Bid": "Wants Bid", "Has Bid": "Has Bid", Sold: "Sold this month" };
  const pickPipe = (key, ids) => {
    setPipeFilter({ key, ids });
    setFilter("All");
    setDigFilter(null);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const SUB_MUTED = "rgba(243,237,225,0.55)";
  const STAGE_COLOR = { "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red };
  const pipelineItems = [
    { key: "All", glyph: "✳", color: C.teal, value: pLoad ? "…" : pipe.all, label: "All",
      sub: pLoad ? "" : addedThisWeek > 0 ? `↑ ${addedThisWeek} this week` : "Active jobs",
      subColor: addedThisWeek > 0 ? C.teal : SUB_MUTED, onClick: () => pickPipe("All", new Set(scopedActive.map(c => c.id))), active: pipeFilter?.key === "All" },
    { key: "Wants Bid", glyph: "🔍", color: C.amber, value: pLoad ? "…" : pipe.wantsBid.count, label: "Wants Bid",
      sub: pLoad ? "" : wbThisWeek > 0 ? `↑ ${wbThisWeek} this week` : "In pipeline",
      subColor: wbThisWeek > 0 ? C.teal : SUB_MUTED, onClick: () => pickPipe("Wants Bid", scopedIds("Wants Bid")), active: pipeFilter?.key === "Wants Bid" },
    { key: "Has Bid", glyph: "📋", color: C.purple, value: pLoad ? "…" : pipe.hasBid.count, label: "Has Bid",
      sub: pLoad ? "…" : `${fmt$(pipe.hasBid.amount)} open`, subColor: C.teal,
      onClick: () => pickPipe("Has Bid", scopedIds("Has Bid")), active: pipeFilter?.key === "Has Bid" },
    { key: "Sold", glyph: "✓", color: C.green, value: pLoad ? "…" : pipe.sold.count, label: "Sold",
      sub: pLoad ? "…" : `${fmt$(pipe.sold.amount)} this month`, subColor: C.teal,
      onClick: () => pickPipe("Sold", soldMonthIds), active: pipeFilter?.key === "Sold" },
  ];
  const pipelineSegments = STAGES.map(s => ({ color: STAGE_COLOR[s], value: scopedActive.filter(c => c.stage === s).length }));

  // Relocated intelligence scope: reps see their own; a manager can toggle to the
  // whole company (Chris, 2026-08-22). Empty repName = company-wide.
  const isManager = ["Admin", "Manager"].includes(teamMember?.role);
  const intelRepName = isManager && intelScope === "company" ? "" : myName;

  // A Where-to-Dig card click → filter the table to that bucket + scroll to it.
  // Scope the table to the same rep the card counted, so the number matches.
  const onDig = (bucket) => {
    setDigFilter(bucket);
    setPipeFilter(null);
    setFilter("All");
    setFilters(f => ({ ...f, sales: intelRepName || "" }));
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const DIG_LABEL = { dueToday: "Bids due today", overdue: "Bids overdue", followups: "Follow-ups this week" };

  const scrollToCommand = () => commandRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const scrollToList = () => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const navPill = (label, active, onClick) => (
    <button onClick={onClick} style={{
      padding: "6px 16px", borderRadius: 20,
      border: `1.5px solid ${active ? C.teal : C.border}`,
      background: active ? C.dark : "transparent",
      color: active ? C.teal : C.textMuted,
      fontSize: 12, fontWeight: 700, cursor: "pointer",
      fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
    }}>{label}</button>
  );

  return (
    <>
      {wizardEl}
      <div ref={commandRef} style={{ display: "flex", flexDirection: "column", gap: 20, scrollMarginTop: 12 }}>
        <SectionHeader title="Call Log" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Inquiry</Btn>} />
        {/* Page-level nav: Command Center (top) ↔ All Jobs (list). Active reflects scroll. */}
        <div style={{ display: "flex", gap: 8, marginTop: -8 }}>
          {navPill("Command Center", !atList, scrollToCommand)}
          {navPill(`All Jobs · ${activeRows.length}`, atList, scrollToList)}
        </div>
        <PipelinePanel
          label={`Pipeline · ${scopeName || "All Reps"}`}
          footnote={scopeName ? `Active jobs assigned to ${scopeName}` : "Active jobs — all reps"}
          items={pipelineItems}
          segments={pipelineSegments}
        />
        {/* Relocated sales intelligence (Where to Dig / Where to Hunt / Sleepers) */}
        {snapshot && (
          <>
            {isManager && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {[["me", "Just me"], ["company", "Whole company"]].map(([v, l]) => (
                  <button key={v} onClick={() => setIntelScope(v)} style={{
                    padding: "6px 14px", borderRadius: 20,
                    border: `1.5px solid ${intelScope === v ? C.teal : C.border}`,
                    background: intelScope === v ? C.dark : "transparent",
                    color: intelScope === v ? C.teal : C.textMuted,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
                  }}>{l}</button>
                ))}
              </div>
            )}
            <SalesIntelligence repName={intelRepName} displayName={myName} onDig={onDig} />
          </>
        )}
        {/* Campaign Leads band (bolt-on) — leads live in one place but show here,
            uniquely tagged, so paid-campaign inquiries surface alongside the pipeline. */}
        {cfg.leads_enabled && leadCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", background: C.dark, border: `1.5px solid ${C.teal}`, borderRadius: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, background: C.teal, color: C.dark, padding: "3px 9px", borderRadius: 10, fontFamily: F.ui, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>CAMPAIGN LEADS</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(243,237,225,0.92)", fontFamily: F.ui }}>
              {leadCount} open lead{leadCount !== 1 ? "s" : ""} from paid marketing waiting to be worked
            </span>
            <button onClick={() => navigate("/leads")} style={{ marginLeft: "auto", background: C.teal, color: C.dark, border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Review Leads →
            </button>
          </div>
        )}
        {/* ── Strong break: this is the ALL JOBS workspace, a deliberate second section ── */}
        <div ref={listRef} style={{ display: "flex", alignItems: "baseline", gap: 12, borderTop: `2px solid ${C.borderStrong}`, paddingTop: 18, marginTop: 8, scrollMarginTop: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>All Jobs</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.tealDeep, fontFamily: F.ui, letterSpacing: "0.06em", textTransform: "uppercase" }}>{activeRows.length} Active</span>
        </div>
        {/* Active / Old Jobs toggle */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setShowOld(false)} style={{
            padding: "7px 18px", borderRadius: 20,
            border: `1.5px solid ${!showOld ? C.teal : C.border}`,
            background: !showOld ? C.dark : "transparent",
            color: !showOld ? C.teal : C.textMuted,
            fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Active Jobs <span style={{ opacity: 0.6, marginLeft: 4 }}>({activeRows.length})</span>
          </button>
          <button onClick={() => setShowOld(true)} style={{
            padding: "7px 18px", borderRadius: 20,
            border: `1.5px solid ${showOld ? C.teal : C.border}`,
            background: showOld ? C.dark : "transparent",
            color: showOld ? C.teal : C.textMuted,
            fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            Old Jobs <span style={{ opacity: 0.6, marginLeft: 4 }}>({oldRows.length})</span>
          </button>
        </div>
        {/* Archive banner — shown once when auto-archive runs */}
        {archiveBanner && !showOld && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(48,207,172,0.10)", border: `1.5px solid ${C.tealBorder}`, borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.tealDeep, fontFamily: F.ui }}>
              {archiveBanner} old job{archiveBanner !== 1 ? "s" : ""} moved to Old Jobs. You can find them anytime by tapping "Old Jobs" above.
            </span>
            <button onClick={() => setArchiveBanner(null)} style={{ background: "none", border: `1.5px solid ${C.tealBorder}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: C.tealDeep, cursor: "pointer", fontFamily: "inherit" }}>OK</button>
          </div>
        )}
        {bidDueFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(249,168,37,0.12)", border: "1.5px solid rgba(249,168,37,0.4)", borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7a5000" }}>⚠ Showing bids due today only</span>
            <button onClick={() => navigate("/calllog", { replace: true })} style={{ background: "none", border: "1.5px solid rgba(249,168,37,0.5)", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#7a5000", cursor: "pointer", fontFamily: "inherit" }}>✕ Show All</button>
          </div>
        )}
        {digFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(48,207,172,0.10)", border: `1.5px solid ${C.tealBorder}`, borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.tealDeep, fontFamily: F.ui }}>Showing: {DIG_LABEL[digFilter]} ({filtered.length})</span>
            <button onClick={() => setDigFilter(null)} style={{ background: "none", border: `1.5px solid ${C.tealBorder}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: C.tealDeep, cursor: "pointer", fontFamily: "inherit" }}>✕ Show All</button>
          </div>
        )}
        {pipeFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(48,207,172,0.10)", border: `1.5px solid ${C.tealBorder}`, borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.tealDeep, fontFamily: F.ui }}>Showing: {PIPE_LABEL[pipeFilter.key]} ({filtered.length})</span>
            <button onClick={() => setPipeFilter(null)} style={{ background: "none", border: `1.5px solid ${C.tealBorder}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: C.tealDeep, cursor: "pointer", fontFamily: "inherit" }}>✕ Show All</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Search job # or name…" value={q} onChange={e => setQ(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 13.5, outline: "none", width: 240, color: C.textBody, fontFamily: F.ui }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["All", ...STAGES].map(st => {
              const count = st === "All" ? visibleRows.length : visibleRows.filter(r => r.stage === st).length;
              return (
                <button key={st} onClick={() => setFilter(st)} style={{ padding: "7px 16px", borderRadius: 20, border: `1.5px solid ${filter === st ? C.teal : C.border}`, background: filter === st ? C.dark : "transparent", color: filter === st ? C.teal : C.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {st} <span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
                </button>
              );
            })}
          </div>
          {/* One Clear for the whole job list — resets the search, the stage tab,
              the dig/pipe lenses, and the FilterBar dropdowns. Shows whenever any
              of them is active. (Restored after the engagement redesign moved the
              search + stage row out and left the old FilterBar-only Clear hidden.) */}
          {(q || filter !== "All" || digFilter || pipeFilter ||
            filters.sales || filters.dateFrom || filters.dateTo || filters.workType || filters.customer || filters.jobNumber) && (
            <button
              onClick={() => {
                setQ("");
                setFilter("All");
                setDigFilter(null);
                setPipeFilter(null);
                setFilters({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });
              }}
              style={{ padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`, background: "transparent", color: C.textMuted, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}
            >
              Clear
            </button>
          )}
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onClear={() => setQ("")}
          hideClear
          salesOptions={[...new Set(rows.map(r => r.sales_name).filter(Boolean))].sort()}
          workTypeOptions={workTypes}
        />
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <>
            <DataTable
              cols={[
                { k: "job_number", l: "Job #", r: (v, row) => (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: F.display, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} onClick={() => navigate(`/calllog/${row.id}`)}>{(() => { const djn = row.display_job_number || String(v); const idx = djn.indexOf(" - "); return idx > -1 ? (<><span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{djn.slice(0, idx)}</span><span style={{ fontWeight: 500, color: C.textMuted }}>{djn.slice(idx + 3)}</span></>) : <span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{djn}</span>; })()}</span>
                    {row.is_change_order && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui }}>CO</span>
                    )}
                    {row.archived && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: C.linenDeep, color: C.textMuted, padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: `1px solid ${C.borderStrong}` }}>Old Job</span>
                    )}
                    {!row.jobsite_address && (
                      <span title="Job site address missing — required before proposal" style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,168,0,0.13)", color: "#8a6200", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(230,168,0,0.3)", cursor: "default" }}>
                        ⚠ No Site Addr
                      </span>
                    )}
                    {row._gcCount >= 2 && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(48,207,172,0.12)", color: C.tealDeep, padding: "2px 7px", borderRadius: 10, fontFamily: F.ui }}>{row._gcCount} GCS</span>
                    )}
                  </div>
                )},
                { k: "customer_name", l: "Customer", r: (v, row) => <span style={{ fontWeight: 500 }}>{v || row.job_name}</span> },
                { k: "created_at", l: "Date", r: v => fmtD(v) },
                { k: "stage", l: "Stage", r: (v, row) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Pill label={v} cm={STAGE_C} />
                    {row.archive_record_id && (
                      <span title="Imported from archive — no proposal exists. Build a proposal before invoicing." style={{ fontSize: 10, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(142,68,173,0.25)", cursor: "help" }}>
                        ARCHIVE
                      </span>
                    )}
                  </span>
                )},
                { k: "sales_name", l: "Rep" },
                { k: "bid_due", l: "Bid Due", r: v => <span style={{ color: over(v) ? C.red : C.textBody, fontWeight: 500 }}>{fmtD(v)}</span> },
                { k: "follow_up", l: "Follow Up", r: v => v ? <span style={{ color: over(v) ? C.red : C.textBody }}>{fmtD(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
                { k: "_a", l: "", sortable: false, r: (_, row) => (
                  <Btn sz="sm" v="secondary" onClick={() => navigate(`/calllog/${row.id}`)}>View</Btn>
                )},
              ]}
              rows={filtered}
              defaultSort={{ key: "created_at", dir: "desc" }}
            />
            <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
              {filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </div>
          </>
        )}
      </div>
      {/* Floating cue — flips direction with scroll: down to the list, up to the center */}
      <button
        onClick={atList ? scrollToCommand : scrollToList}
        title={atList ? "Back to the command center" : "Jump to your job list"}
        style={{
          position: "fixed", right: 24, bottom: 24, zIndex: 150,
          display: "flex", alignItems: "center", gap: 8,
          background: C.dark, color: C.teal, border: `1.5px solid ${C.teal}`,
          borderRadius: 24, padding: "10px 18px", cursor: "pointer",
          fontFamily: F.display, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
          boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
        }}>
        {atList
          ? <><span style={{ fontSize: 15 }}>↑</span> Command Center</>
          : <><span style={{ fontSize: 15 }}>↓</span> All Jobs · {activeRows.length}</>}
      </button>
    </>
  );
}
