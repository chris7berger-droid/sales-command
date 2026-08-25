import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fetchAll } from "../lib/supabaseHelpers";
import { fmtD } from "../lib/utils";
import { useTenantConfig } from "../lib/TenantConfigContext";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";
import NewInquiryWizard from "../components/NewInquiryWizard";

// Leads statuses are stored lowercase in the DB; displayed capitalized.
const STATUS_TABS = ["All", "New", "Contacted", "Qualified", "Converted", "Junk"];
const STATUS_C = {
  New:       { bg: C.tealGlow, text: C.tealDeep, border: C.tealBorder },
  Contacted: { bg: "rgba(249,168,37,0.14)", text: "#8a6200", border: "rgba(249,168,37,0.35)" },
  Qualified: { bg: "rgba(142,68,173,0.12)", text: "#5b2d7a", border: "rgba(142,68,173,0.25)" },
  Converted: { bg: "rgba(67,160,71,0.16)", text: "#2f6d33", border: "rgba(67,160,71,0.3)" },
  Junk:      { bg: C.linenDeep, text: C.textMuted, border: C.borderStrong },
};
const CHANNEL_LABEL = { facebook: "Facebook", google: "Google", twilio: "Twilio", other: "Other" };
const CHANNEL_C = {
  Facebook: { bg: "rgba(66,103,178,0.14)", text: "#2c4a8a", border: "rgba(66,103,178,0.3)" },
  Google:   { bg: "rgba(219,68,55,0.12)", text: "#a3392f", border: "rgba(219,68,55,0.28)" },
  Twilio:   { bg: "rgba(48,207,172,0.14)", text: C.tealDeep, border: C.tealBorder },
  Other:    { bg: C.linenDeep, text: C.textMuted, border: C.borderStrong },
};
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default function Leads({ teamMember }) {
  const cfg = useTenantConfig();
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState("All");
  const [q, setQ]                 = useState("");
  // Deps for the New Inquiry wizard, so "Convert to Job" reuses the real creation path.
  const [team, setTeam]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [allJobs, setAllJobs]     = useState([]);
  const [convertLead, setConvertLead] = useState(null);

  const load = async () => {
    const all = await fetchAll("leads", "*", { order: { column: "received_at", ascending: false } });
    setRows(all);
    setLoading(false);
  };

  const loadDeps = async () => {
    const [{ data: tm }, { data: wt }, allCx, jobs] = await Promise.all([
      supabase.from("team_members").select("*").order("name"),
      supabase.from("work_types").select("*").order("name"),
      fetchAll("customers", "*", { order: "name" }),
      fetchAll("call_log", "id, job_number, display_job_number, job_name, customer_id, customer_name, parent_job_id, co_number, stage", { order: "id" }),
    ]);
    setTeam(tm || []);
    setCustomers(allCx);
    setWorkTypes(wt || []);
    setAllJobs(jobs || []);
  };

  useEffect(() => { load(); loadDeps(); }, []);

  // Wait for tenant config to actually resolve before deciding. DEFAULTS has no
  // id, so cfg.id is the "loaded" signal — without this, a deep-link or refresh
  // to /leads bounces an enabled tenant home before the flag has arrived.
  if (!cfg.id) return <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13, padding: 24 }}>Loading…</div>;
  // Bolt-on guard: this screen only exists for a tenant with the add-on enabled.
  if (!cfg.leads_enabled) return <Navigate to="/home" replace />;

  const setStatus = async (lead, statusLabel) => {
    const status = statusLabel.toLowerCase();
    const { error } = await supabase.from("leads").update({ status }).eq("id", lead.id);
    if (!error) setRows(rs => rs.map(r => (r.id === lead.id ? { ...r, status } : r)));
  };

  const filtered = rows.filter(r => {
    if (filter !== "All" && cap(r.status) !== filter) return false;
    if (q) {
      const hay = `${r.name || ""} ${r.phone || ""} ${r.email || ""} ${r.campaign || ""} ${r.message || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const wizardEl = convertLead ? (
    <NewInquiryWizard
      onClose={() => setConvertLead(null)}
      onSaved={async (newJob) => {
        // Preserve the campaign origin: link the lead to the created job so
        // existing tools can trace lead → paying customer → margin. Then mark it
        // converted so it leaves the "to work" piles.
        const patch = { status: "converted" };
        if (newJob?.id) patch.call_log_id = newJob.id;
        await supabase.from("leads").update(patch).eq("id", convertLead.id);
        setConvertLead(null);
        load();
      }}
      team={team}
      customers={customers}
      allJobs={allJobs}
      workTypes={workTypes}
      initialLead={convertLead}
    />
  ) : null;

  const CAMPAIGN_TAG = (
    <span style={{ fontSize: 9.5, fontWeight: 800, background: C.dark, color: C.teal, padding: "2px 7px", borderRadius: 10, fontFamily: F.ui, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      CAMPAIGN LEAD
    </span>
  );

  return (
    <>
      {wizardEl}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <SectionHeader title="Campaign Leads" />
        <div style={{ fontSize: 13, color: C.textMuted, fontFamily: F.ui, marginTop: -10, maxWidth: 640 }}>
          Leads from your paid marketing campaigns (Facebook, Google, Twilio). Triage them here,
          then convert the real ones into jobs — the campaign source stays attached so you can track
          acquisition cost and which leads become paying customers.
        </div>

        {/* Status tabs */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Search name, phone, campaign…" value={q} onChange={e => setQ(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenLight, fontSize: 13.5, outline: "none", width: 260, color: C.textBody, fontFamily: F.ui }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STATUS_TABS.map(st => {
              const count = st === "All" ? rows.length : rows.filter(r => cap(r.status) === st).length;
              return (
                <button key={st} onClick={() => setFilter(st)} style={{ padding: "7px 16px", borderRadius: 20, border: `1.5px solid ${filter === st ? C.teal : C.border}`, background: filter === st ? C.dark : "transparent", color: filter === st ? C.teal : C.textMuted, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {st} <span style={{ opacity: 0.6, marginLeft: 4 }}>({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <DataTable
              cols={[
                { k: "received_at", l: "Received", r: v => fmtD(v) },
                { k: "name", l: "Lead", r: (v, row) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={{ fontWeight: 600, color: C.textHead, fontFamily: F.ui }}>{v || "—"}</span>
                    <span style={{ fontSize: 12, color: C.textLight, fontFamily: F.ui }}>
                      {[row.phone, row.email].filter(Boolean).join("  ·  ") || "no contact info"}
                    </span>
                  </div>
                )},
                { k: "channel", l: "Source", r: (v, row) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Pill label={CHANNEL_LABEL[v] || "Other"} cm={CHANNEL_C} />
                    {CAMPAIGN_TAG}
                  </span>
                )},
                { k: "campaign", l: "Campaign", r: v => <span style={{ fontFamily: F.ui, color: v ? C.textBody : C.textFaint }}>{v || "—"}</span> },
                { k: "message", l: "Message", r: v => (
                  <span title={v || ""} style={{ fontFamily: F.ui, color: C.textLight, fontSize: 12.5, display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</span>
                )},
                { k: "status", l: "Status", r: v => <Pill label={cap(v)} cm={STATUS_C} /> },
                { k: "_a", l: "", sortable: false, r: (_, row) => (
                  row.status === "converted" ? (
                    // Once converted, the lead is a real job — lock it so its status
                    // can't be flipped back and resurface an already-worked job.
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#2f6d33", fontFamily: F.ui }}>✓ Converted to job</span>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <select value={cap(row.status)} onChange={e => setStatus(row, e.target.value)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 12.5, fontFamily: F.ui, cursor: "pointer" }}>
                        {["New", "Contacted", "Qualified", "Junk"].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <Btn sz="sm" onClick={() => setConvertLead(row)}>Convert to Job</Btn>
                    </div>
                  )
                )},
              ]}
              rows={filtered}
              defaultSort={{ key: "received_at", dir: "desc" }}
            />
            <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
              {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
            </div>
          </>
        )}
      </div>
    </>
  );
}
