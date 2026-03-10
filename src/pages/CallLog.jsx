import { useState } from "react";
import { C, F } from "../lib/tokens";
import { fmtD, over } from "../lib/utils";
import { callLog, STAGES, STAGE_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

export default function CallLog() {
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");

  const rows = callLog.filter(r =>
    (filter === "All" || r.stage === filter) &&
    (r.jobName.toLowerCase().includes(q.toLowerCase()) || String(r.id).includes(q))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Call Log" action={<Btn sz="sm">+ New Inquiry</Btn>} />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Search job # or name…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: `1.5px solid ${C.borderStrong}`,
            background: C.linenLight,
            fontSize: 13.5,
            outline: "none",
            width: 240,
            color: C.textBody,
            fontFamily: F.ui,
          }}
        />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {["All", ...STAGES].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: "5px 13px",
              borderRadius: 20,
              border: `1.5px solid ${filter === s ? C.teal : C.border}`,
              background: filter === s ? C.dark : "transparent",
              color: filter === s ? C.teal : C.textMuted,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: F.display,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        cols={[
          { k: "id",        l: "Job #",     r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
          { k: "jobName",   l: "Job Name",  r: v => <span style={{ fontWeight: 500, maxWidth: 280, display: "block" }}>{v}</span> },
          { k: "date",      l: "Date",      r: v => fmtD(v) },
          { k: "stage",     l: "Stage",     r: v => <Pill label={v} cm={STAGE_C} /> },
          { k: "salesName", l: "Rep" },
          { k: "bidDue",    l: "Bid Due",   r: v => <span style={{ color: over(v) ? C.red : C.textBody, fontWeight: 500 }}>{fmtD(v)}</span> },
          { k: "followUp",  l: "Follow Up", r: v => v ? <span style={{ color: over(v) ? C.red : C.textBody }}>{fmtD(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
          { k: "_a", l: "", r: (_, row) => (
            <div style={{ display: "flex", gap: 5 }}>
              <Btn sz="sm" v="secondary">View</Btn>
              <Btn sz="sm" v="ghost">+ Task</Btn>
            </div>
          )},
        ]}
        rows={rows}
      />
      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
        {rows.length} record{rows.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}