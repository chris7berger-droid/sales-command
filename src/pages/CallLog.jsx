import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { supabase, archiveDb } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmtD, fmt$, over, tod } from "../lib/utils";
import { calcProposalTotal, usesExactPricing } from "../lib/calc";
import { creditedSoldMonth, parseArchiveSoldDate } from "../lib/followUp";
import { STAGES, STAGE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import CallLogDetail from "../components/CallLogDetail";
import FilterBar from "../components/FilterBar";
import NewInquiryWizard from "../components/NewInquiryWizard";
import { useAlerts } from "../lib/alerts";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CallLog({ teamMember, setSubPage }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeJobId } = useParams();
  const navState = location.state || {};
  const { refresh: refreshAlerts } = useAlerts();
  const [rows, setRows]           = useState([]);
  const [proposals, setProposals] = useState([]);   // for "Your Pipeline" $ (via calcProposalTotal, not stale total)
  const [propsLoaded, setPropsLoaded] = useState(false);
  const [archiveSoldDateById, setArchiveSoldDateById] = useState(new Map()); // real sold month for archive-lineage jobs (B70)
  const [team, setTeam]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState(navState.stageFilter || "All");
  const [q, setQ]                 = useState("");
  // Seed `sales` from nav-state so a Home "Your Book" tile tap opens THIS rep's
  // own filtered pile, not the company-wide stage list (engagement redesign N1/A2).
  const [filters, setFilters]     = useState({ sales: navState.sales || "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });
  const [showModal, setShowModal] = useState(false);
  const [coParent, setCoParent]   = useState(null);
  const [selJob, setSelJob]       = useState(null);
  const [showOld, setShowOld]     = useState(false);
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
    // One proposals fetch feeds both the multi-GC count (below) and the
    // "Your Pipeline" $ figures. Money is summed via calcProposalTotal over the
    // joined proposal_wtc — NEVER proposals.total (stale, Data Integrity Rule #2).
    const pcData = await fetchAll(
      "proposals",
      "call_log_id, customer_id, id, status, markup_override_pct, created_at, pricing_anchor_at, " +
        "call_log(stage, sales_name), " +
        "proposal_wtc(is_rate_card, prevailing_wage, pw_rate, pw_ot_rate, burden_rate, ot_burden_rate, markup_pct, regular_hours, ot_hours, size, materials, travel, discount)",
      { filters: [["is", "deleted_at", null]] }
    );
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

    // Real sold month for archive-lineage jobs — a proposal built on an imported
    // job carries today's created_at, so "Sold $ this month" must credit it to
    // the job's REAL sold date instead (B70). Archive fetch failure degrades
    // gracefully to created_at bucketing (empty map), never blocks the page.
    const archiveIds = [...new Set(allLog.map(r => r.archive_record_id).filter(Boolean))];
    if (archiveIds.length) {
      const { data: legacy } = await archiveDb.from("legacy_records").select("id, raw_data").in("id", archiveIds);
      const map = new Map();
      for (const r of legacy || []) {
        const sold = parseArchiveSoldDate(r.raw_data?.["job/soldDate"]);
        if (sold) map.set(r.id, sold);
      }
      setArchiveSoldDateById(map);
    }

    setRows(allLog);
    setProposals(pcData);
    setPropsLoaded(true);
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
  const activeRows = rows.filter(r => !r.archived);
  const oldRows = rows.filter(r => r.archived);
  // When searching, search ALL rows so old jobs aren't hidden from search results
  const visibleRows = q ? rows : (showOld ? oldRows : activeRows);
  const filtered = visibleRows.filter(r => {
    if (bidDueFilter && r.bid_due !== todayStr) return false;
    if (!bidDueFilter && filter !== "All" && r.stage !== filter) return false;
    if (q && !((r.display_job_number || r.job_name)?.toLowerCase().includes(q.toLowerCase()) || String(r.job_number || r.id).includes(q) || (r.customer_name || "").toLowerCase().includes(q.toLowerCase()))) return false;
    if (filters.sales && r.sales_name !== filters.sales) return false;
    if (filters.dateFrom && (r.created_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (r.created_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.workType && !(r.job_work_types || []).some(jwt => String(jwt.work_type_id) === filters.workType)) return false;
    if (filters.customer && !(r.customer_name || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !(r.display_job_number || String(r.job_number || "")).toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  // ─── "Your Pipeline" stat row ────────────────────────────────────────────
  // Respects the FilterBar "Sales Rep" dropdown (manager per-rep view, §3.1).
  // Counts come from call_log.stage; $ comes from calcProposalTotal over the
  // joined proposal_wtc (never proposals.total).
  const [thisY, thisM] = todayStr.split("-").map(Number);
  const thisMonth = `${thisY}-${String(thisM).padStart(2, "0")}`;
  const lastMonth = thisM === 1 ? `${thisY - 1}-12` : `${thisY}-${String(thisM - 1).padStart(2, "0")}`;
  const repFilter = filters.sales;
  const scopedJobs = activeRows.filter(r => !repFilter || r.sales_name === repFilter);
  const jobsInStage = st => scopedJobs.filter(r => r.stage === st);
  const pipeAll     = scopedJobs.length;
  const wantsBidNow = jobsInStage("Wants Bid").filter(r => (r.created_at || "").slice(0, 7) === thisMonth).length;
  const wantsBidPrev = jobsInStage("Wants Bid").filter(r => (r.created_at || "").slice(0, 7) === lastMonth).length;
  const wantsTrend  = wantsBidNow - wantsBidPrev;
  const hasBidCount = jobsInStage("Has Bid").length;
  const soldCount   = jobsInStage("Sold").length;
  const scopedProps = proposals.filter(p => !repFilter || p.call_log?.sales_name === repFilter);
  const propTotal   = p => calcProposalTotal(p.proposal_wtc, parseFloat(p.markup_override_pct) || undefined, usesExactPricing(p));
  const hasBidOpen  = scopedProps.filter(p => p.call_log?.stage === "Has Bid").reduce((s, p) => s + propTotal(p), 0);
  // "Sold $ this month" credits archive-lineage sales to their REAL sold month,
  // not the import/proposal-build date (B70) — shared basis via creditedSoldMonth.
  const archiveIdByJob = new Map(rows.map(r => [r.id, r.archive_record_id]));
  const soldMonth   = scopedProps
    .filter(p => p.status === "Sold" && creditedSoldMonth(p, { archiveIdByJob, archiveSoldDateById }) === thisMonth)
    .reduce((s, p) => s + propTotal(p), 0);
  const $badge      = txt => <span style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, fontFamily: F.ui }}>{txt}</span>;

  return (
    <>
      {wizardEl}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Call Log" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Inquiry</Btn>} />
        {/* "Your Pipeline" stat row (§3.1) — Active Jobs assigned to you */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>
            Your Pipeline <span style={{ color: C.textFaint, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>Pipeline shows Active Jobs assigned to you.</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}>
            <StatCard label="All" value={loading ? "…" : pipeAll} sub="Active jobs" accent={C.teal} />
            <StatCard label="Wants Bid" value={loading ? "…" : wantsBidNow} accent={C.amber}
              sub={loading ? "This month" : wantsTrend > 0 ? `↑ ${wantsTrend} vs last month` : wantsTrend < 0 ? `↓ ${Math.abs(wantsTrend)} vs last month` : "This month"} />
            <StatCard label="Has Bid" value={loading ? "…" : hasBidCount} accent={C.purple}
              sub={propsLoaded ? $badge(`${fmt$(hasBidOpen)} open`) : "…"} />
            <StatCard label="Sold" value={loading ? "…" : soldCount} accent={C.green}
              sub={propsLoaded ? $badge(`${fmt$(soldMonth)} this month`) : "…"} />
          </div>
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
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          onClear={() => setQ("")}
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
    </>
  );
}
