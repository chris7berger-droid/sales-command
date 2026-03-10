import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmtD } from "../lib/utils";
import { INV_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import StatCard from "../components/StatCard";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("invoices").select("*").order("sent_at", { ascending: false });
      setInvoices(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const drafted = invoices.filter(i => i.status === "New").reduce((a, i) => a + i.amount, 0);
  const pending = invoices.filter(i => ["Sent","Waiting for Payment","Past Due"].includes(i.status)).reduce((a, i) => a + i.amount, 0);
  const paid    = invoices.filter(i => i.status === "Paid").reduce((a, i) => a + i.amount, 0);

  const aging = (inv) => {
    if (!inv.due_date) return null;
    const days = Math.round((new Date() - new Date(inv.due_date)) / 86400000);
    return days;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Invoices" action={<Btn sz="sm">+ New Invoice</Btn>} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatCard label="Total Drafted" value={fmt$(drafted)} accent={C.teal} />
        <StatCard label="Total Pending" value={fmt$(pending)} accent={C.amber} />
        <StatCard label="Total Paid"    value={fmt$(paid)}    accent={C.green} />
      </div>

      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <DataTable
          cols={[
            { k: "id",       l: "Invoice #", r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
            { k: "job_id",   l: "Job #",     r: v => <span style={{ fontWeight: 700, fontFamily: F.display }}>{v}</span> },
            { k: "job_name", l: "Job Name",  r: v => <span style={{ maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span> },
            { k: "status",   l: "Status",    r: v => <Pill label={v} cm={INV_C} /> },
            { k: "amount",   l: "Amount",    r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
            { k: "discount", l: "Discount",  r: v => v > 0 ? <span style={{ color: C.red, fontWeight: 700 }}>−{fmt$(v)}</span> : <span style={{ color: C.textFaint }}>—</span> },
            { k: "sent_at",  l: "Sent",      r: v => fmtD(v) },
            { k: "due_date", l: "Due",       r: v => fmtD(v) },
            { k: "_aging",   l: "Aging",     r: (_, row) => {
              const d = aging(row);
              if (d === null) return <span style={{ color: C.textFaint }}>—</span>;
              return <span style={{ fontWeight: 800, fontFamily: F.display, color: d > 0 ? C.red : d === 0 ? C.amber : C.green }}>
                {d > 0 ? `${d}d overdue` : d === 0 ? "Due today" : `${Math.abs(d)}d`}
              </span>;
            }},
            { k: "_a", l: "", r: () => <Btn sz="sm" v="secondary">View</Btn> },
          ]}
          rows={invoices}
        />
      )}
    </div>
  );
}