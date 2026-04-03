import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmtD, over } from "../lib/utils";
import { STAGES, STAGE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import CallLogDetail from "../components/CallLogDetail";
import FilterBar from "../components/FilterBar";
import NewInquiryWizard from "../components/NewInquiryWizard";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CallLog({ teamMember, onNewProposal, onNavigateProposal, onNavigateInvoice, onNavigateCustomer, bidDueFilter, onClearBidDueFilter, stageFilter, onClearStageFilter, setSubPage }) {
  const [rows, setRows]           = useState([]);
  const [team, setTeam]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState(stageFilter || "All");
  const [q, setQ]                 = useState("");
  const [filters, setFilters]     = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });
  const [showModal, setShowModal] = useState(false);
  const [selJob, setSelJob]       = useState(null);

  const load = async () => {
    const [{ data: log }, { data: tm }, { data: wt }] = await Promise.all([
      supabase.from("call_log").select("*, job_work_types(*), customers(id, contact_email, contact_phone, first_name, last_name, business_address, business_city, business_state, business_zip, billing_terms, billing_same, billing_name, billing_phone, billing_email)").order("id", { ascending: false }),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("work_types").select("*").order("name"),
    ]);
    // Paginate customers to bypass PostgREST 1000-row limit
    const PAGE = 1000;
    let allCx = [], from = 0;
    while (true) {
      const { data } = await supabase.from("customers").select("*").order("name").range(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      allCx = allCx.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    setRows(log || []);
    setTeam(tm || []);
    setCustomers(allCx);
    setWorkTypes(wt || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (stageFilter) {
      setFilter(stageFilter);
      onClearStageFilter && onClearStageFilter();
    }
  }, [stageFilter]);

  // Track sub-page for TOC
  useEffect(() => {
    if (setSubPage) setSubPage(selJob ? "detail" : showModal ? "new" : null);
  }, [selJob, showModal]);

  // Show detail page when a job is selected
  if (selJob) {
    return (
      <CallLogDetail
        job={selJob}
        teamMembers={team}
        workTypes={workTypes}
        onBack={() => setSelJob(null)}
        onSaved={() => { setSelJob(null); load(); }}
        onDeleted={() => { setSelJob(null); load(); }}
        teamMember={teamMember}
        onNewProposal={onNewProposal ? () => onNewProposal(selJob) : undefined}
        onNavigateProposal={onNavigateProposal}
        onNavigateInvoice={onNavigateInvoice}
        onNavigateCustomer={onNavigateCustomer}
      />
    );
  }

  const tod = new Date().toISOString().slice(0, 10);
  const filtered = rows.filter(r => {
    if (bidDueFilter && r.bid_due !== tod) return false;
    if (!bidDueFilter && filter !== "All" && r.stage !== filter) return false;
    if (q && !((r.display_job_number || r.job_name)?.toLowerCase().includes(q.toLowerCase()) || String(r.job_number || r.id).includes(q))) return false;
    if (filters.sales && r.sales_name !== filters.sales) return false;
    if (filters.dateFrom && (r.created_at || "").slice(0, 10) < filters.dateFrom) return false;
    if (filters.dateTo && (r.created_at || "").slice(0, 10) > filters.dateTo) return false;
    if (filters.workType && !(r.job_work_types || []).some(jwt => String(jwt.work_type_id) === filters.workType)) return false;
    if (filters.customer && !(r.customer_name || "").toLowerCase().includes(filters.customer.toLowerCase())) return false;
    if (filters.jobNumber && !(r.display_job_number || String(r.job_number || "")).toLowerCase().includes(filters.jobNumber.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      {showModal && (
        <NewInquiryWizard
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
          team={team}
          customers={customers}
          allJobs={rows}
          workTypes={workTypes}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Call Log" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Inquiry</Btn>} />
        {bidDueFilter && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(249,168,37,0.12)", border: "1.5px solid rgba(249,168,37,0.4)", borderRadius: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7a5000" }}>⚠ Showing bids due today only</span>
            <button onClick={() => onClearBidDueFilter && onClearBidDueFilter()} style={{ background: "none", border: "1.5px solid rgba(249,168,37,0.5)", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#7a5000", cursor: "pointer", fontFamily: "inherit" }}>✕ Show All</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Search job # or name…" value={q} onChange={e => setQ(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 13.5, outline: "none", width: 240, color: C.textBody, fontFamily: F.ui }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["All", ...STAGES].map(st => {
              const count = st === "All" ? rows.length : rows.filter(r => r.stage === st).length;
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
                    <span style={{ fontFamily: F.display, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} onClick={() => setSelJob(row)}>{(() => { const djn = row.display_job_number || String(v); const idx = djn.indexOf(" - "); return idx > -1 ? (<><span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{djn.slice(0, idx)}</span><span style={{ fontWeight: 500, color: C.textMuted }}>{djn.slice(idx + 3)}</span></>) : <span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{djn}</span>; })()}</span>
                    {row.is_change_order && (
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(142,68,173,0.12)", color: "#5b2d7a", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui }}>CO</span>
                    )}
                    {!row.jobsite_address && (
                      <span title="Job site address missing — required before proposal" style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,168,0,0.13)", color: "#8a6200", padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, border: "1px solid rgba(230,168,0,0.3)", cursor: "default" }}>
                        ⚠ No Site Addr
                      </span>
                    )}
                  </div>
                )},
                { k: "customer_name", l: "Customer", r: (v, row) => <span style={{ fontWeight: 500 }}>{v || row.job_name}</span> },
                { k: "created_at", l: "Date", r: v => fmtD(v) },
                { k: "stage", l: "Stage", r: v => <Pill label={v} cm={STAGE_C} /> },
                { k: "sales_name", l: "Rep" },
                { k: "bid_due", l: "Bid Due", r: v => <span style={{ color: over(v) ? C.red : C.textBody, fontWeight: 500 }}>{fmtD(v)}</span> },
                { k: "follow_up", l: "Follow Up", r: v => v ? <span style={{ color: over(v) ? C.red : C.textBody }}>{fmtD(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
                { k: "_a", l: "", r: (_, row) => (
                  <Btn sz="sm" v="secondary" onClick={() => setSelJob(row)}>View</Btn>
                )},
              ]}
              rows={filtered}
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
