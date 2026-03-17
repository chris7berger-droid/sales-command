import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const C = {
  bg: "#0f0f1a", card: "#16161f", border: "#2a2a3d", borderStrong: "#3a3a52",
  teal: "#4fc3a1", amber: "#f59e0b", red: "#ef4444", blue: "#60a5fa",
  textHead: "#e8e8f0", textBody: "#a0a0b8", textFaint: "#5a5a7a",
  green: "#4caf50", purple: "#a78bfa",
};
const F = { display: "'DM Mono', monospace", ui: "'DM Sans', sans-serif" };

const STAGE_ORDER = ["Lead","Quoted","Follow-Up","Negotiating","Won","Lost","On Hold"];
const STAGE_COLOR = {
  Lead: C.blue, Quoted: C.amber, "Follow-Up": C.purple,
  Negotiating: C.teal, Won: C.green, Lost: C.red, "On Hold": C.textFaint,
};

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.textHead, fontFamily: F.display, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12, marginTop: 28 }}>{children}</div>
  );
}

function JobRow({ job }) {
  const today = new Date().toISOString().slice(0, 10);
  const bidOverdue = job.bid_due && job.bid_due < today;
  const followOverdue = job.follow_up && job.follow_up < today;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: STAGE_COLOR[job.stage] || C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", minWidth: 90, textTransform: "uppercase" }}>{job.stage}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{job.display_job_number || job.job_name}</div>
        <div style={{ fontSize: 11, color: C.textBody, fontFamily: F.ui }}>{job.customer_name}</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {job.bid_due && <div style={{ fontSize: 11, color: bidOverdue ? C.red : C.textFaint, fontFamily: F.ui }}>Bid {job.bid_due}</div>}
        {job.follow_up && <div style={{ fontSize: 11, color: followOverdue ? C.amber : C.textFaint, fontFamily: F.ui }}>F/U {job.follow_up}</div>}
      </div>
    </div>
  );
}

function ProposalRow({ proposal }) {
  const STATUS_COLOR = { Sent: C.blue, Viewed: C.purple, Approved: C.green, "Approved Internally": C.teal, Draft: C.textFaint, Declined: C.red };
  const total = proposal.total ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLOR[proposal.status] || C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", minWidth: 120, textTransform: "uppercase" }}>{proposal.status}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.ui }}>{proposal.call_log?.display_job_number || "—"}</div>
        <div style={{ fontSize: 11, color: C.textBody, fontFamily: F.ui }}>{proposal.customer}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, fontFamily: F.display }}>${total.toLocaleString()}</div>
    </div>
  );
}

export default function SalesDash({ displayName }) {
  const [jobs, setJobs] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    async function load() {
      const [{ data: jobData }, { data: propData }] = await Promise.all([
        supabase.from("call_log").select("id, display_job_number, job_name, customer_name, stage, bid_due, follow_up, created_at")
          .eq("sales_name", displayName)
          .not("stage", "in", '("Won","Lost")')
          .order("created_at", { ascending: false }),
        supabase.from("proposals").select("id, status, total, customer, created_at, approved_at, call_log(display_job_number)")
          .order("created_at", { ascending: false })
      ]);

      // Filter proposals to only this rep's jobs
      const myJobIds = new Set((jobData || []).map(j => j.id));
      const allProps = (propData || []);

      // Get all proposals including won jobs for stats
      const { data: allMyJobs } = await supabase.from("call_log")
        .select("id").eq("sales_name", displayName);
      const allMyJobIds = new Set((allMyJobs || []).map(j => j.id));

      const { data: allMyProps } = await supabase.from("proposals")
        .select("id, status, total, customer, created_at, approved_at, call_log_id, call_log(display_job_number)")
        .in("call_log_id", allMyJobIds.size > 0 ? [...allMyJobIds] : ["none"]);

      setJobs(jobData || []);
      setProposals(allMyProps || []);
      setLoading(false);
    }
    if (displayName) load();
  }, [displayName]);

  const openJobs = jobs.filter(j => !["Won","Lost"].includes(j.stage));
  const followUpsToday = jobs.filter(j => j.follow_up === today);
  const bidsToday = jobs.filter(j => j.bid_due === today);
  const overdueFollowUps = jobs.filter(j => j.follow_up && j.follow_up < today);
  const overdueBids = jobs.filter(j => j.bid_due && j.bid_due < today);

  const year = new Date().getFullYear().toString();
  const sentProps = proposals.filter(p => ["Sent","Viewed","Approved Internally","Approved"].includes(p.status));
  const wonProps = proposals.filter(p => p.status === "Approved" && p.approved_at?.startsWith(year));
  const totalBid = sentProps.reduce((s, p) => s + (p.total ?? 0), 0);
  const totalWon = wonProps.reduce((s, p) => s + (p.total ?? 0), 0);
  const convRate = sentProps.length > 0 ? Math.round((wonProps.length / sentProps.length) * 100) : 0;

  const jobsByStage = STAGE_ORDER.reduce((acc, stage) => {
    const s = openJobs.filter(j => j.stage === stage);
    if (s.length) acc[stage] = s;
    return acc;
  }, {});

  const propsByStatus = ["Draft","Sent","Viewed","Approved Internally","Approved","Declined"].reduce((acc, status) => {
    const s = proposals.filter(p => p.status === status);
    if (s.length) acc[status] = s;
    return acc;
  }, {});

  if (loading) return (
    <div style={{ padding: 40, color: C.textFaint, fontFamily: F.display, fontSize: 13, letterSpacing: "0.08em" }}>LOADING…</div>
  );

  return (
    <div style={{ padding: "28px 32px", background: C.bg, minHeight: "100vh", fontFamily: F.ui }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "-0.02em", marginBottom: 4 }}>
        {displayName}
      </div>
      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.06em", marginBottom: 24 }}>SALES DASHBOARD</div>

      {/* Stat cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Open Jobs" value={openJobs.length} color={C.blue} />
        <StatCard label="$ Bid (Active)" value={`$${Math.round(totalBid / 1000)}k`} color={C.teal} />
        <StatCard label="$ Won YTD" value={`$${Math.round(totalWon / 1000)}k`} color={C.green} />
        <StatCard label="Conv. Rate" value={`${convRate}%`} sub={`${wonProps.length} of ${sentProps.length} sent`} color={convRate >= 50 ? C.green : C.amber} />
      </div>

      {/* Today alerts */}
      {(followUpsToday.length > 0 || bidsToday.length > 0 || overdueFollowUps.length > 0 || overdueBids.length > 0) && (
        <>
          <SectionTitle>⚠ Needs Attention Today</SectionTitle>
          {overdueBids.map(j => (
            <div key={j.id} style={{ padding: "10px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, marginBottom: 6, fontSize: 13, color: C.red, fontFamily: F.ui }}>
              🔴 Bid overdue — {j.display_job_number} · {j.customer_name} · was due {j.bid_due}
            </div>
          ))}
          {overdueFollowUps.map(j => (
            <div key={j.id} style={{ padding: "10px 16px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, marginBottom: 6, fontSize: 13, color: C.amber, fontFamily: F.ui }}>
              🟡 Follow-up overdue — {j.display_job_number} · {j.customer_name} · was due {j.follow_up}
            </div>
          ))}
          {bidsToday.map(j => (
            <div key={j.id} style={{ padding: "10px 16px", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 8, marginBottom: 6, fontSize: 13, color: C.blue, fontFamily: F.ui }}>
              📋 Bid due today — {j.display_job_number} · {j.customer_name}
            </div>
          ))}
          {followUpsToday.map(j => (
            <div key={j.id} style={{ padding: "10px 16px", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: 8, marginBottom: 6, fontSize: 13, color: C.purple, fontFamily: F.ui }}>
              📞 Follow-up today — {j.display_job_number} · {j.customer_name}
            </div>
          ))}
        </>
      )}

      {/* My open jobs by stage */}
      <SectionTitle>My Open Jobs</SectionTitle>
      {Object.keys(jobsByStage).length === 0 && (
        <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>No open jobs.</div>
      )}
      {Object.entries(jobsByStage).map(([stage, stageJobs]) => (
        <div key={stage} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: STAGE_COLOR[stage], fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {stage} · {stageJobs.length}
          </div>
          {stageJobs.map(j => <JobRow key={j.id} job={j} />)}
        </div>
      ))}

      {/* My proposals by status */}
      <SectionTitle>My Proposals</SectionTitle>
      {Object.keys(propsByStatus).length === 0 && (
        <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>No proposals yet.</div>
      )}
      {Object.entries(propsByStatus).map(([status, statusProps]) => (
        <div key={status} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {status} · {statusProps.length}
          </div>
          {statusProps.map(p => <ProposalRow key={p.id} proposal={p} />)}
        </div>
      ))}
    </div>
  );
}