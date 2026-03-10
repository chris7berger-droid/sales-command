import { C, F } from "../lib/tokens";
import { fmt$, fmtD } from "../lib/utils";
import { invoices, INV_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

export default function Invoices() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Invoices" action={<Btn sz="sm">+ New Invoice</Btn>} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatCard label="Total Drafted" value={fmt$(447840)}  accent={C.teal} />
        <StatCard label="Total Pending" value={fmt$(1560000)} accent={C.amber} />
        <StatCard label="Total Paid"    value={fmt$(6790000)} accent={C.green} />
      </div>

      <DataTable
        cols={[
          { k: "id",       l: "Invoice #", r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
          { k: "jobId",    l: "Job #",     r: v => <span style={{ fontWeight: 700, fontFamily: F.display }}>{v}</span> },
          { k: "jobName",  l: "Job Name",  r: v => <span style={{ maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span> },
          { k: "status",   l: "Status",    r: v => <Pill label={v} cm={INV_C} /> },
          { k: "amount",   l: "Amount",    r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
          { k: "discount", l: "Discount",  r: v => v > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
          { k: "sent",     l: "Sent",      r: v => fmtD(v) },
          { k: "due",      l: "Due",       r: v => fmtD(v) },
          { k: "aging",    l: "Aging",     r: v => (
            <span style={{ fontWeight: 800, fontFamily: F.display, color: v < 0 ? C.red : v === 0 ? C.amber : C.green }}>
              {v < 0 ? `${Math.abs(v)}d overdue` : v === 0 ? "Due today" : `${v}d`}
            </span>
          )},
          { k: "_a", l: "", r: () => <Btn sz="sm" v="secondary">View</Btn> },
        ]}
        rows={invoices}
      />
    </div>
  );
}