import { useState, useEffect } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import SectionHeader from "../components/SectionHeader";
import CallLogDetail from "../components/CallLogDetail";

const STAGE_FILTERS = ["All", "Wants Bid", "Has Bid", "Sold"];
const stageColor = s => ({ "New Inquiry": C.teal, "Wants Bid": C.amber, "Has Bid": C.purple, Sold: C.green, Lost: C.red }[s] || C.textFaint);

const thStyle = { padding: "11px 15px", textAlign: "left", fontWeight: 700, fontSize: 10.5, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui, whiteSpace: "nowrap" };
const inputStyle = { padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 13.5, outline: "none", color: C.textBody, fontFamily: F.ui, WebkitAppearance: "none" };
const tabStyle = (active) => ({
  padding: "7px 16px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase",
  border: `1.5px solid ${active ? C.teal : C.border}`,
  background: active ? C.dark : "transparent",
  color: active ? C.teal : C.textMuted,
});

export default function Jobs({ teamMember, onNewProposal, onNavigateProposal, onNavigateInvoice }) {
  const [rows, setRows]           = useState([]);
  const [team, setTeam]           = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [q, setQ]                 = useState("");
  const [filter, setFilter]       = useState("All");
  const [selJob, setSelJob]       = useState(null);
  const [drillCustomer, setDrillCustomer] = useState(null); // customer_name to drill into

  const load = async () => {
    const [{ data: log }, { data: tm }, { data: wt }] = await Promise.all([
      supabase.from("call_log").select("*, job_work_types(work_type_id), customers(id, contact_email, contact_phone, first_name, last_name, business_address, business_city, business_state, business_zip, billing_terms)").order("id", { ascending: false }),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("work_types").select("*").order("name"),
    ]);
    setRows(log || []);
    setTeam(tm || []);
    setWorkTypes(wt || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Job detail view
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
      />
    );
  }

  // Customer drill-down view
  if (drillCustomer) {
    const custJobs = rows.filter(r => r.customer_name === drillCustomer);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setDrillCustomer(null)} style={{ background: "none", border: `1.5px solid ${C.borderStrong}`, borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: C.textMuted, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.03em", textTransform: "uppercase" }}>{drillCustomer}</h2>
          <span style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>{custJobs.length} job{custJobs.length !== 1 ? "s" : ""}</span>
        </div>
        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead>
              <tr style={{ background: C.dark }}>
                <th style={thStyle}>Job #</th>
                <th style={thStyle}>Job Name</th>
                <th style={thStyle}>Sales Rep</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {custJobs.map((row, i) => (
                <tr key={row.id} onClick={() => setSelJob(row)}
                  style={{ background: i % 2 === 0 ? C.linenLight : C.linen, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                >
                  <td style={{ padding: "12px 15px", fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{row.display_job_number || row.job_number}</td>
                  <td style={{ padding: "12px 15px", color: C.textBody }}>{row.job_name}</td>
                  <td style={{ padding: "12px 15px", color: C.textMuted }}>{row.sales_name || "—"}</td>
                  <td style={{ padding: "12px 15px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: stageColor(row.stage), fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.06em" }}>{row.stage}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Group jobs by customer — show most recent job per customer
  const customerMap = {};
  for (const row of rows) {
    const name = row.customer_name || "Unknown";
    if (!customerMap[name]) {
      customerMap[name] = { latestJob: row, jobs: [row] };
    } else {
      customerMap[name].jobs.push(row);
    }
  }

  // Apply search
  const searchMatch = (name, entry) =>
    name.toLowerCase().includes(q.toLowerCase()) ||
    (entry.latestJob.display_job_number || entry.latestJob.job_name || "").toLowerCase().includes(q.toLowerCase()) ||
    String(entry.latestJob.job_number || "").includes(q);

  // Apply filter — if a filter is set, only show customers that have at least one job in that stage
  const customerEntries = Object.entries(customerMap)
    .filter(([name, entry]) => {
      if (!searchMatch(name, entry)) return false;
      if (filter === "All") return true;
      return entry.jobs.some(j => j.stage === filter);
    })
    .sort((a, b) => (b[1].latestJob.id || 0) - (a[1].latestJob.id || 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Jobs" />

      {/* Search + Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input placeholder="Search job #, name, or customer..." value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, width: 280 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {STAGE_FILTERS.map(s => {
            const count = s === "All" ? Object.keys(customerMap).length : Object.values(customerMap).filter(e => e.jobs.some(j => j.stage === s)).length;
            return (
              <button key={s} onClick={() => setFilter(s)} style={tabStyle(filter === s)}>
                {s} <span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <div style={{ borderRadius: 10, border: `1px solid ${C.borderStrong}`, overflow: "hidden", boxShadow: "0 2px 10px rgba(28,24,20,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
            <thead>
              <tr style={{ background: C.dark }}>
                <th style={thStyle}>Job #</th>
                <th style={thStyle}>Job Name</th>
                <th style={thStyle}>Customer</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Jobs</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {customerEntries.map(([name, entry], i) => {
                const job = entry.latestJob;
                const count = entry.jobs.length;
                return (
                  <tr key={name}
                    onClick={() => count === 1 ? setSelJob(job) : setDrillCustomer(name)}
                    style={{ background: i % 2 === 0 ? C.linenLight : C.linen, cursor: "pointer", borderBottom: `1px solid ${C.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.tealGlow}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? C.linenLight : C.linen}
                  >
                    <td style={{ padding: "12px 15px", fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>
                      {job.display_job_number || job.job_number}
                    </td>
                    <td style={{ padding: "12px 15px", color: C.textBody }}>{job.job_name}</td>
                    <td style={{ padding: "12px 15px", color: C.textBody, fontWeight: 600 }}>{name}</td>
                    <td style={{ padding: "12px 15px", textAlign: "center" }}>
                      {count > 1 ? (
                        <span style={{ background: C.dark, color: C.teal, padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: F.display, cursor: "pointer" }}
                          onClick={e => { e.stopPropagation(); setDrillCustomer(name); }}
                        >
                          {count}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: C.textFaint }}>1</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 15px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: stageColor(job.stage), fontFamily: F.display, textTransform: "uppercase", letterSpacing: "0.06em" }}>{job.stage}</span>
                    </td>
                  </tr>
                );
              })}
              {customerEntries.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: C.textFaint, fontFamily: F.ui }}>No jobs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
