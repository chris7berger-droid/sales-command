import { useEffect, useState } from "react";
import { C, F } from "../lib/tokens";
import { supabase } from "../lib/supabase";
import { fmt$, fmtD } from "../lib/utils";
import { PROP_C } from "../lib/mockData";
import SectionHeader from "../components/SectionHeader";
import DataTable from "../components/DataTable";
import Pill from "../components/Pill";
import Btn from "../components/Btn";

function ProposalDetail({ p, onBack }) {
  const checks = [
    { l: "Proposal created",              done: true  },
    { l: "Introduction completed",        done: false },
    { l: "Attachments added",             done: false },
    { l: "Recipients assigned",           done: true  },
    { l: "Work Type Calculator verified", done: false },
  ];
  const pct = Math.round((checks.filter(c => c.done).length / checks.length) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: C.tealDark, fontWeight: 800, fontSize: 12.5, padding: 0, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ← Back
        </button>
        <div style={{ width: 1, height: 18, background: C.border }} />
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Proposal {p.id}
        </h2>
        <Pill label={p.status} cm={PROP_C} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Btn sz="sm" v="ghost">Generate PDF</Btn>
          <Btn sz="sm">Send via DocuSeal</Btn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Work Type Calculators</div>
            <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: C.textHead, fontFamily: F.display }}>Demo – WTC 1</div>
                  <div style={{ fontSize: 12, color: C.textFaint, marginTop: 3, fontFamily: F.ui }}>Created {fmtD(p.created_at?.slice(0,10))}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 18, color: C.tealDark, fontFamily: F.display }}>{fmt$(p.total)}</div>
                  <div style={{ fontSize: 11, color: C.textFaint }}>No discount</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <Btn sz="sm" v="secondary">Edit WTC</Btn>
                <span style={{ fontSize: 12, color: C.amber, fontWeight: 700, fontFamily: F.ui }}>⏳ In Progress</span>
              </div>
            </div>
            <Btn sz="sm" v="ghost">+ Add Work Type</Btn>
          </div>

          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Recipients</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[["Role", "Signer"], ["Name", "—"], ["Email", "—"]].map(([k, val]) => (
                <div key={k}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F.ui }}>{k}</div>
                  <div style={{ marginTop: 4, fontSize: 13.5, fontWeight: 600, color: k === "Email" ? C.tealDark : C.textHead, fontFamily: F.ui }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.linenCard, border: `1px solid ${C.borderStrong}`, borderRadius: 10, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 12.5, color: C.textHead, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Checklist</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: pct === 100 ? C.green : C.amber, fontFamily: F.display }}>{pct}%</div>
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 4, marginBottom: 16 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? C.green : C.teal, borderRadius: 4 }} />
            </div>
            {checks.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < checks.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: c.done ? C.teal : C.linen, border: `1.5px solid ${c.done ? C.teal : C.borderStrong}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {c.done && <span style={{ fontSize: 11, color: C.dark, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: 13.5, color: c.done ? C.textBody : C.textFaint, fontWeight: c.done ? 600 : 400, fontFamily: F.ui }}>{c.l}</span>
              </div>
            ))}
          </div>

          <div style={{ background: C.dark, border: `1px solid ${C.tealBorder}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, color: C.teal, fontFamily: F.display, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Summary</div>
            {[["Customer", p.customer], ["Total", fmt$(p.total)], ["Created", fmtD(p.created_at?.slice(0,10))], ["Status", p.status]].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}` }}>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: F.ui }}>{k}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: F.ui }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Proposals() {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("proposals").select("*").order("created_at", { ascending: false });
      setProposals(data || []);
      setLoading(false);
    }
    load();
  }, []);

  if (sel) return <ProposalDetail p={sel} onBack={() => setSel(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader title="Proposals" action={<Btn sz="sm">+ New Proposal</Btn>} />
      {loading ? (
        <div style={{ color: C.textFaint, fontFamily: F.ui, fontSize: 13 }}>Loading...</div>
      ) : (
        <DataTable
          cols={[
            { k: "id",         l: "Proposal #", r: v => <span style={{ fontWeight: 800, color: C.tealDark, fontFamily: F.display }}>{v}</span> },
            { k: "customer",   l: "Customer" },
            { k: "status",     l: "Status",     r: v => <Pill label={v} cm={PROP_C} /> },
            { k: "total",      l: "Total",      r: v => <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: F.display }}>{fmt$(v)}</span> },
            { k: "created_at", l: "Created",    r: v => fmtD(v?.slice(0,10)) },
            { k: "approved_at",l: "Approved",   r: v => v ? fmtD(v?.slice(0,10)) : <span style={{ color: C.textFaint }}>—</span> },
            { k: "_a", l: "", r: (_, row) => (
              <div style={{ display: "flex", gap: 5 }}>
                <Btn sz="sm" v="secondary" onClick={() => setSel(row)}>Open</Btn>
                <Btn sz="sm" v="ghost">PDF</Btn>
              </div>
            )},
          ]}
          rows={proposals}
          onRow={setSel}
        />
      )}
    </div>
  );
}