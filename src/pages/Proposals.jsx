import { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmt$, fmtD } from "../lib/utils";
import { calcProposalTotal, usesExactPricing } from "../lib/calc";
import { PROP_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import FilterBar from "../components/FilterBar";
import NewProposalModal from "../components/NewProposalModal";
import ProposalDetail from "../components/ProposalDetail";

// Top-row buckets (§2.3) — EXHAUSTIVE: every live proposal status maps to
// exactly one bucket, so Σ(buckets) === All. A status not listed here lands in
// an explicit "Other" remainder (rendered + dev-warned), never silently dropped.
const PROP_BUCKETS = {
  Draft: ["Draft", "New", "In Progress", "Parked"],
  Sent:  ["Sent", "Viewed", "Approved Internally", "Approved"],
  Sold:  ["Signed", "Sold"],
  Lost:  ["Lost"],
};
const STATUS_BUCKET = Object.fromEntries(
  Object.entries(PROP_BUCKETS).flatMap(([b, ss]) => ss.map(s => [s, b]))
);

export default function Proposals({ teamMember, setSubPage }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeProposalId } = useParams();
  const navState = location.state || {};
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sel, setSel]             = useState(null);
  const [lastViewedId, setLastViewedId] = useState(null);
  const [showModal, setShowModal] = useState(!!navState.newJob);

  const [preselectedJob, setPreselectedJob] = useState(navState.newJob || null);
  const [statusFilter, setStatusFilter]     = useState("All");
  const [workTypes, setWorkTypes]           = useState([]);
  const [filters, setFilters]               = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });

  useEffect(() => {
    if (!routeProposalId) { setSel(null); return; }
    (async () => {
      const { data } = await supabase
        .from("proposals")
        .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, qb_skip_sync, qb_customer_id, archive_record_id, customers(email, contact_email, business_address, business_city, business_state, business_zip))")
        .eq("id", routeProposalId)
        .maybeSingle();
      if (data) setSel(data);
    })();
  }, [routeProposalId]);

  const load = async () => {
    const [data, invData, { data: wtData }] = await Promise.all([
      fetchAll(
        "proposals",
        "*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, qb_skip_sync, qb_customer_id, archive_record_id, customers(email, contact_email, business_address, business_city, business_state, business_zip)), proposal_wtc(start_date, end_date, work_type_id, is_rate_card, prevailing_wage, pw_rate, pw_ot_rate, burden_rate, ot_burden_rate, markup_pct, regular_hours, ot_hours, size, materials, travel, discount), proposal_recipients(viewed_at, role)",
        { filters: [["is", "deleted_at", null]], order: { column: "created_at", ascending: false } }
      ),
      fetchAll("invoices", "id, status, proposal_id"),
      supabase.from("work_types").select("*").order("name"),
    ]);
    setWorkTypes(wtData || []);
    const invByProposal = {};
    invData.forEach(inv => {
      if (inv.proposal_id) {
        if (!invByProposal[inv.proposal_id]) invByProposal[inv.proposal_id] = [];
        invByProposal[inv.proposal_id].push(inv);
      }
    });
    setProposals((data || []).map(p => ({ ...p, invoices: invByProposal[p.id] || [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const STATUS_TABS = ["All", "Draft", "Sent", "Signed", "Sold", "Lost"];
  const filteredProposals = proposals.filter(p => {
    if (statusFilter !== "All" && p.status !== statusFilter) return false;
    if (filters.sales && p.call_log?.sales_name !== filters.sales) return false;
    if (filters.dateFrom && (p.created_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (p.created_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.workType && !(p.proposal_wtc || []).some(w => String(w.work_type_id) === filters.workType)) return false;
    if (filters.customer && !(p.customer || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !(p.call_log?.display_job_number || "").toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(sel ? "detail" : null);
  }, [sel]);

  // Remember the proposal you were just in so the list highlights + scrolls to it on the way back
  useEffect(() => { if (sel?.id) setLastViewedId(sel.id); }, [sel?.id]);

  if (sel) return <ProposalDetail
    p={sel}
    onBack={() => { setSel(null); navigate("/proposals"); }}
    onDeleted={() => { setSel(null); navigate("/proposals"); load(); }}
    teamMember={teamMember}
    onNavigateJob={id => navigate(`/calllog/${id}`)}
    onNavigateInvoice={id => navigate(`/invoices/${id}`)}
  />;

  // ─── "Proposals" stat row + Needs-Attention (§2.3 / §3.2) ────────────────
  // Global counts (matches the existing status-tab convention on this page).
  const bucketCounts = { Draft: 0, Sent: 0, Sold: 0, Lost: 0, Other: 0 };
  const otherStatuses = new Set();
  for (const p of proposals) {
    const b = STATUS_BUCKET[p.status];
    if (b) bucketCounts[b]++;
    else { bucketCounts.Other++; otherStatuses.add(p.status || "(none)"); }
  }
  const allCount = proposals.length;
  // Build assertion: Σ(named buckets) === All (nothing fell through). In dev,
  // scream the unmapped status set so a new status gets bucketed, not dropped.
  const bucketSum = bucketCounts.Draft + bucketCounts.Sent + bucketCounts.Sold + bucketCounts.Lost;
  if (import.meta.env?.DEV && bucketSum !== allCount) {
    console.error(`[Proposals] bucket leak: Σ(Draft+Sent+Sold+Lost)=${bucketSum} ≠ All=${allCount}; unmapped statuses:`, [...otherStatuses]);
  }

  // Needs-Attention (opened-aware, via embedded proposal_recipients.viewed_at).
  const opened = p => (p.proposal_recipients || []).some(r => r.viewed_at);
  const sentNotOpened  = proposals.filter(p => p.status === "Sent" && !opened(p)).length;
  const openedNoResp   = proposals.filter(p => opened(p) && !["Signed", "Sold", "Lost"].includes(p.status)).length;
  const draftsToFinish = bucketCounts.Draft;
  // $ potential = winnable pipeline $ (Draft + Sent buckets — not yet resolved),
  // summed via calcProposalTotal over proposal_wtc (excludes rate cards, F44),
  // never proposals.total (stale, Data Integrity Rule #2).
  const dollarPotential = proposals
    .filter(p => STATUS_BUCKET[p.status] === "Draft" || STATUS_BUCKET[p.status] === "Sent")
    .reduce((s, p) => s + calcProposalTotal(p.proposal_wtc, parseFloat(p.markup_override_pct) || undefined, usesExactPricing(p)), 0);
  const naLabel = t => <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textLight, fontFamily: F.ui }}>{t}</div>;

  return (
    <>
      {showModal && (
        <NewProposalModal
          onClose={() => { setShowModal(false); setPreselectedJob(null); }}
          onCreated={(newProposal) => { setShowModal(false); setPreselectedJob(null); navigate(`/proposals/${newProposal.id}`); load(); }}
          preselectedJob={preselectedJob}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Proposals" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Proposal</Btn>} />
        {/* Top stat row (§2.3) — mutually-exclusive buckets that sum to All */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16 }}>
          <StatCard label="All"   value={loading ? "…" : allCount}            accent={C.teal} />
          <StatCard label="Draft" value={loading ? "…" : bucketCounts.Draft}  accent={C.textLight} />
          <StatCard label="Sent"  value={loading ? "…" : bucketCounts.Sent}   accent={C.purple} />
          <StatCard label="Sold"  value={loading ? "…" : bucketCounts.Sold}   accent={C.green} />
          <StatCard label="Lost"  value={loading ? "…" : bucketCounts.Lost}   accent={C.red} />
          {bucketCounts.Other > 0 && (
            <StatCard label="Other" value={bucketCounts.Other} sub={[...otherStatuses].join(", ")} accent={C.amber} />
          )}
        </div>
        {/* Needs-Attention (opened-aware) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {naLabel("Needs Attention")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16 }}>
            <StatCard label="Sent – not opened"    value={loading ? "…" : sentNotOpened}   sub="No open yet"        accent={C.amber} />
            <StatCard label="Opened – no response" value={loading ? "…" : openedNoResp}     sub="Opened, unresolved" accent={C.teal} />
            <StatCard label="Drafts to finish"     value={loading ? "…" : draftsToFinish}   sub="Not yet sent"       accent={C.amber} />
            <StatCard label="$ Potential"          value={loading ? "…" : fmt$(dollarPotential)} sub="Draft + Sent (winnable)" accent={C.purple} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {STATUS_TABS.map(tab => {
            const active = statusFilter === tab;
            const count = tab === "All" ? proposals.length : proposals.filter(p => p.status === tab).length;
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: `1.5px solid ${active ? C.teal : C.borderStrong}`,
                  background: active ? C.dark : "transparent",
                  color: active ? C.teal : C.textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: F.display,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab} <span style={{ opacity: 0.6, marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          salesOptions={[...new Set(proposals.map(p => p.call_log?.sales_name).filter(Boolean))].sort()}
          workTypeOptions={workTypes}
        />
        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
        ) : (
          <DataTable
            cols={[
              { k: "id",         l: "Proposal #", r: (v, row) => { const djn = row.call_log?.display_job_number || String(v); const idx = djn.indexOf(" - "); const num = idx > -1 ? djn.slice(0, idx) : djn; const name = idx > -1 ? djn.slice(idx + 3) : ""; return <span style={{ fontFamily: F.display, display: "flex", alignItems: "center", gap: 8 }}>{row.cloned_from_proposal_id && <span style={{ color: C.teal, fontSize: 14, marginRight: -2 }}>↳</span>}<span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{num} P{row.proposal_number || 1}</span>{row.cloned_from_proposal_id && <span style={{ background: C.dark, color: C.teal, border: `1px solid ${C.teal}`, borderRadius: 10, padding: "2px 7px", fontSize: 10, fontWeight: 700, fontFamily: F.ui, letterSpacing: "0.04em" }}>GC COPY</span>}{name && <span style={{ fontWeight: 500, color: C.textMuted }}>{name}</span>}</span>; } },
              { k: "customer",   l: "Customer" },
              { k: "status",     l: "Status",     r: (v, row) => (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Pill label={v} cm={PROP_C} />
                  {row.is_archive_proposal && (
                    <span title="Archive Job Proposal — no WTC. Invoice with a flat amount." style={{ fontSize: 10, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(142,68,173,0.25)", cursor: "help" }}>ARCHIVE</span>
                  )}
                  {row.call_log?.qb_customer_id && (
                    <span title={`Linked to QuickBooks customer ${row.call_log.qb_customer_id}`} style={{ fontSize: 10, fontWeight: 700, background: C.dark, color: C.teal, padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: `1px solid ${C.teal}`, cursor: "help", letterSpacing: "0.04em" }}>LINKED</span>
                  )}
                  {(row.call_log?.qb_skip_sync || (row.is_archive_proposal && !row.call_log?.qb_customer_id)) && (
                    <span title={row.call_log?.qb_skip_sync ? "QuickBooks auto-sync skipped — job flagged" : "QuickBooks auto-sync skipped — archive proposal not linked to a QB customer"} style={{ fontSize: 10, fontWeight: 700, background: C.dark, color: C.teal, padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: `1px solid ${C.teal}`, cursor: "help", letterSpacing: "0.04em" }}>QB SKIP</span>
                  )}
                </span>
              ) },
              { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
              { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
              { k: "proposal_wtc", l: "WTCs",
                sortVal: row => (row.proposal_wtc || []).length,
                r: v => {
                  const count = (v || []).length;
                  return <span style={{ fontWeight: 700, fontFamily: F.display }}>{count || "—"}</span>;
                }},
              { k: "proposal_wtc", l: "Job Start",
                sortVal: row => {
                  const dates = (row.proposal_wtc || []).map(w => w.start_date).filter(Boolean).sort();
                  return dates[0] || null;
                },
                r: v => {
                  const dates = (v || []).map(w => w.start_date).filter(Boolean);
                  if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                  if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                  return fmtD(dates[0]);
                }},
              { k: "proposal_wtc", l: "Job End",
                sortVal: row => {
                  const dates = (row.proposal_wtc || []).map(w => w.end_date).filter(Boolean).sort();
                  return dates[0] || null;
                },
                r: v => {
                  const dates = (v || []).map(w => w.end_date).filter(Boolean);
                  if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                  if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                  return fmtD(dates[0]);
                }},
              { k: "invoices", l: "Invoice",
                sortVal: row => (row.invoices && row.invoices[0]?.status) || null,
                r: (v, row) => {
                  const invs = v || [];
                  if (invs.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                  return (
                    <span onClick={e => { e.stopPropagation(); if (onNavigateInvoice) onNavigateInvoice(invs[0].id); }}
                      style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, fontFamily: F.ui, cursor: "pointer" }}>
                      {invs[0].status || "View"}
                    </span>
                  );
                }},
              { k: "_a", l: "", sortable: false, r: (_, row) => (
                <div style={{ display: "flex", gap: 5 }}>
                  <Btn sz="sm" v="secondary" onClick={() => navigate(`/proposals/${row.id}`)}>Open</Btn>
                  <Btn sz="sm" v="ghost">PDF</Btn>
                </div>
              )},
            ]}
            rows={filteredProposals}
            onRow={setSel}
            focusKey={lastViewedId}
            defaultSort={{ key: "created_at", dir: "desc" }}
          />
        )}
      </div>
    </>
  );
}
