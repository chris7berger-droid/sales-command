import { useState, useEffect } from "react";
import { C, F } from "../../lib/tokens";
import { supabase } from "../../lib/supabase";

const DATA_TYPES = [
  {
    id: "customers",
    label: "Customers",
    icon: "🏢",
    desc: "Import customer names, addresses, phones, and emails.",
    table: "customers",
    requires: null,
    requiredFields: ["name"],
  },
  {
    id: "call_log",
    label: "Call Log",
    icon: "📋",
    desc: "Import call log entries (jobs). Can auto-create customers from the file.",
    table: "call_log",
    requires: "customers",
    requiredFields: ["customer_name", "jobsite_address"],
  },
  {
    id: "proposals",
    label: "Proposals",
    icon: "📄",
    desc: "Import proposals linked to existing call log entries.",
    table: "proposals",
    requires: "call_log",
    requiredFields: ["proposal_number", "call_log_ref"],
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: "💵",
    desc: "Import invoices linked to existing proposals.",
    table: "invoices",
    requires: "proposals",
    requiredFields: ["invoice_number", "proposal_ref"],
  },
];

export default function DataTypeSelector({ selected, onSelect }) {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCounts() {
      const tables = ["customers", "call_log", "proposals", "invoices"];
      const results = {};
      for (const t of tables) {
        const { count } = await supabase.from(t).select("id", { count: "exact", head: true });
        results[t] = count || 0;
      }
      setCounts(results);
      setLoading(false);
    }
    fetchCounts();
  }, []);

  function getWarning(dt) {
    if (!dt.requires) return null;
    const reqCount = counts[dt.requires] || 0;
    if (reqCount > 0) return null;

    const reqLabel = DATA_TYPES.find((d) => d.id === dt.requires)?.label || dt.requires;
    if (dt.id === "call_log") {
      return `No ${reqLabel.toLowerCase()} in the database yet. You can include customer columns in your call log file to auto-create them, or import ${reqLabel.toLowerCase()} first.`;
    }
    return `Import ${reqLabel} first — no ${reqLabel.toLowerCase()} records exist yet.`;
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 16 }}>
        What are you importing?
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {DATA_TYPES.map((dt) => {
          const isSelected = selected === dt.id;
          const warning = getWarning(dt);
          const blocked = warning && dt.id !== "call_log";

          return (
            <button
              key={dt.id}
              onClick={() => !blocked && onSelect(dt.id)}
              disabled={blocked}
              style={{
                padding: "18px 16px",
                borderRadius: 10,
                border: isSelected ? `2px solid ${C.teal}` : `1.5px solid ${C.borderStrong}`,
                background: isSelected ? C.tealGlow : C.linenDeep,
                cursor: blocked ? "not-allowed" : "pointer",
                opacity: blocked ? 0.5 : 1,
                textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>{dt.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: isSelected ? C.tealDeep : C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  {dt.label}
                </span>
                {!loading && (
                  <span style={{ marginLeft: "auto", background: C.dark, color: C.teal, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: F.ui }}>
                    {counts[dt.table] ?? 0} existing
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: C.textMuted, fontFamily: F.ui, lineHeight: 1.4 }}>
                {dt.desc}
              </div>
              {warning && (
                <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(249,168,37,0.10)", border: `1px solid rgba(249,168,37,0.25)`, borderRadius: 6, fontSize: 11.5, color: "#7a5000", fontFamily: F.ui, lineHeight: 1.4 }}>
                  {warning}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection confirmation */}
      {selected && (
        <div style={{
          marginTop: 16, padding: "10px 14px",
          background: C.tealGlow, border: `1px solid ${C.tealBorder}`,
          borderRadius: 8, fontSize: 13, fontFamily: F.ui, color: C.tealDeep,
          fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 15 }}>&#10003;</span>
          Importing <strong style={{ margin: "0 3px" }}>{DATA_TYPES.find(d => d.id === selected)?.label}</strong> — click <strong style={{ margin: "0 3px" }}>Next</strong> to map your columns.
        </div>
      )}
    </div>
  );
}

export { DATA_TYPES };
