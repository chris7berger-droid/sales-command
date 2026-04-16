import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmt$, fmtD } from "../lib/utils";
import { PROP_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import FilterBar from "../components/FilterBar";
import NewProposalModal from "../components/NewProposalModal";
import ProposalDetail from "../components/ProposalDetail";

export default function Proposals({ teamMember, initialProposal, onClearInitial, setSubPage, onNavigateInvoice }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sel, setSel]             = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [preselectedJob, setPreselectedJob] = useState(null);
  const [statusFilter, setStatusFilter]     = useState("All");
  const [workTypes, setWorkTypes]           = useState([]);
  const [filters, setFilters]               = useState({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" });

  useEffect(() => {
    if (initialProposal?.job) {
      setPreselectedJob(initialProposal.job);
      setShowModal(true);
      onClearInitial && onClearInitial();
    } else if (initialProposal?.openId) {
      (async () => {
        const { data } = await supabase
          .from("proposals")
          .select("*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, customers(email, contact_email, business_address, business_city, business_state, business_zip))")
          .eq("id", initialProposal.openId)
          .maybeSingle();
        if (data) setSel(data);
      })();
      onClearInitial && onClearInitial();
    }
  }, [initialProposal]);

  const load = async () => {
    const [data, invData, { data: wtData }] = await Promise.all([
      fetchAll(
        "proposals",
        "*, call_log(jobsite_address, jobsite_city, jobsite_state, jobsite_zip, display_job_number, customer_name, sales_name, job_name, customer_id, show_cents, customers(email, contact_email, business_address, business_city, business_state, business_zip)), proposal_wtc(start_date, end_date, work_type_id)",
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

  const STATUS_TABS = ["All", "Draft", "Sent", "Sold", "Lost"];
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

  if (sel) return <ProposalDetail p={sel} onBack={() => setSel(null)} onDeleted={() => { setSel(null); load(); }} teamMember={teamMember} />;

  return (
    <>
      {showModal && (
        <NewProposalModal
          onClose={() => { setShowModal(false); setPreselectedJob(null); }}
          onCreated={(newProposal) => { setShowModal(false); setPreselectedJob(null); setSel(newProposal); load(); }}
          preselectedJob={preselectedJob}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Proposals" action={<Btn sz="sm" onClick={() => setShowModal(true)}>+ New Proposal</Btn>} />
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
              { k: "id",         l: "Proposal #", r: (v, row) => { const djn = row.call_log?.display_job_number || String(v); const idx = djn.indexOf(" - "); const num = idx > -1 ? djn.slice(0, idx) : djn; const name = idx > -1 ? djn.slice(idx + 3) : ""; return <span style={{ fontFamily: F.display, display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 600, color: C.teal, background: C.dark, padding: "3px 10px", borderRadius: 6, fontSize: 13, letterSpacing: "0.08em" }}>{num} P{row.proposal_number || 1}</span>{name && <span style={{ fontWeight: 500, color: C.textMuted }}>{name}</span>}</span>; } },
              { k: "customer",   l: "Customer" },
              { k: "status",     l: "Status",     r: v => <Pill label={v} cm={PROP_C} /> },
              { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
              { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
              { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
              { k: "proposal_wtc", l: "WTCs", r: v => {
                const count = (v || []).length;
                return <span style={{ fontWeight: 700, fontFamily: F.display }}>{count || "—"}</span>;
              }},
              { k: "proposal_wtc", l: "Job Start", r: v => {
                const dates = (v || []).map(w => w.start_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "proposal_wtc", l: "Job End", r: v => {
                const dates = (v || []).map(w => w.end_date).filter(Boolean);
                if (dates.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                if (dates.length > 1) return <span style={{ color: C.textFaint, fontStyle: "italic" }}>Multiple</span>;
                return fmtD(dates[0]);
              }},
              { k: "invoices", l: "Invoice", r: (v, row) => {
                const invs = v || [];
                if (invs.length === 0) return <span style={{ color: C.textFaint }}>—</span>;
                return (
                  <span onClick={e => { e.stopPropagation(); if (onNavigateInvoice) onNavigateInvoice(invs[0].id); }}
                    style={{ background: C.dark, color: C.teal, borderRadius: 6, padding: "3px 10px", fontSize: 12, fontWeight: 700, fontFamily: F.ui, cursor: "pointer" }}>
                    {invs[0].status || "View"}
                  </span>
                );
              }},
              { k: "_a", l: "", r: (_, row) => (
                <div style={{ display: "flex", gap: 5 }}>
                  <Btn sz="sm" v="secondary" onClick={() => setSel(row)}>Open</Btn>
                  <Btn sz="sm" v="ghost">PDF</Btn>
                </div>
              )},
            ]}
            rows={filteredProposals}
            onRow={setSel}
          />
        )}
      </div>
    </>
  );
}
