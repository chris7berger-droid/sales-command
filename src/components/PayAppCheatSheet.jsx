import { useState } from "react";
import { C, F } from "../lib/tokens";
import { fmt$ } from "../lib/utils";

const rowStyle = {
  display: "grid", gridTemplateColumns: "40px 1fr 160px",
  alignItems: "center", gap: 10, padding: "10px 14px",
  borderBottom: `1px solid ${C.border}`,
};

const numStyle = {
  fontSize: 15, fontWeight: 800, color: C.textHead, fontFamily: F.display,
  textAlign: "right", cursor: "pointer", padding: "6px 10px",
  background: C.linenDeep, borderRadius: 6, border: `1px solid ${C.borderStrong}`,
  userSelect: "all",
};

function CopyField({ value, raw }) {
  const [copied, setCopied] = useState(false);
  const handleClick = () => {
    navigator.clipboard.writeText(raw ?? value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div style={{ position: "relative" }}>
      <div style={numStyle} onClick={handleClick}>{value}</div>
      {copied && (
        <div style={{ position: "absolute", top: -6, right: 0, fontSize: 9, fontWeight: 700, color: C.teal, fontFamily: F.display, letterSpacing: "0.06em" }}>COPIED</div>
      )}
    </div>
  );
}

export default function PayAppCheatSheet({
  originalContract, changeOrders, contractToDate,
  completedToDate, retainagePct, retainageAmount,
  lessRetention, previousApps, currentPaymentDue,
  appNumber, periodFrom, periodTo, invoiceNumber,
  jobNumber, typeOfWork, coBreakdown,
}) {
  const formatDate = (iso) => {
    if (!iso) return "—";
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const lines = [
    { num: "1", label: "Original Contract Sum", value: fmt$(originalContract), raw: originalContract?.toFixed(2) },
    { num: "2", label: "Net Change by Change Orders", value: fmt$(changeOrders), raw: changeOrders?.toFixed(2) },
    { num: "3", label: "Contract Sum to Date (1 ± 2)", value: fmt$(contractToDate), raw: contractToDate?.toFixed(2), bold: true },
    { num: "4", label: "Total Completed & Stored to Date", value: fmt$(completedToDate), raw: completedToDate?.toFixed(2) },
    { num: "5", label: `Less ${retainagePct}% Retainage`, value: fmt$(retainageAmount), raw: retainageAmount?.toFixed(2) },
    { num: "6", label: "Total Earned Less Retainage (4 − 5)", value: fmt$(lessRetention), raw: lessRetention?.toFixed(2) },
    { num: "7", label: "Less Previous Certificates for Payment", value: fmt$(previousApps), raw: previousApps?.toFixed(2) },
    { num: "8", label: "Current Payment Due", value: fmt$(currentPaymentDue), raw: currentPaymentDue?.toFixed(2), highlight: true },
  ];

  const allText = lines.map(l => `${l.num}. ${l.label}: ${l.value}`).join("\n");
  const [copiedAll, setCopiedAll] = useState(false);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.display }}>
          G702 Application Summary
        </div>
        <div style={{ fontSize: 11, color: C.textFaint, fontFamily: F.ui, marginTop: 4 }}>
          Click any value to copy it, then paste into the GC's pay app.
        </div>
      </div>

      {/* Metadata */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <MetaField label="Application #" value={appNumber || "—"} />
        <MetaField label="Period" value={`${formatDate(periodFrom)} – ${formatDate(periodTo)}`} />
        <MetaField label="Invoice #" value={invoiceNumber || "—"} />
        <MetaField label="Job / Subcontract #" value={jobNumber || "—"} />
        <MetaField label="Type of Work" value={typeOfWork || "—"} />
      </div>

      {/* G702 Lines */}
      <div style={{ border: `1px solid ${C.borderStrong}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ ...rowStyle, background: C.dark, borderBottom: "none", padding: "8px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: F.display, letterSpacing: "0.08em" }}>#</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Description</div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.4)", fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "right" }}>Amount</div>
        </div>
        {lines.map((l, i) => (
          <div key={i} style={{
            ...rowStyle,
            background: l.highlight ? "rgba(44,160,28,0.06)" : (l.bold ? C.linen : C.linenCard),
            borderBottom: i === lines.length - 1 ? "none" : `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: l.highlight ? C.teal : C.textFaint, fontFamily: F.display }}>{l.num}</div>
            <div style={{ fontSize: 13, fontWeight: l.bold || l.highlight ? 700 : 500, color: C.textBody, fontFamily: F.ui }}>{l.label}</div>
            <CopyField value={l.value} raw={l.raw} />
          </div>
        ))}
      </div>

      {/* Change Order breakdown */}
      {coBreakdown?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textFaint, fontFamily: F.display, marginBottom: 6 }}>
            Change Order Breakdown (Line 2)
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
            {coBreakdown.map((co, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 14px", borderBottom: i < coBreakdown.length - 1 ? `1px solid ${C.border}` : "none", background: C.linenLight, fontSize: 12, fontFamily: F.ui }}>
                <span style={{ color: C.textBody }}>
                  <span style={{ background: C.dark, color: C.teal, fontSize: 9, padding: "1px 5px", borderRadius: 4, marginRight: 6, fontFamily: F.display }}>CO{co.number ?? ""}</span>
                  {co.description || "—"}
                </span>
                <span style={{ fontWeight: 700, color: C.textHead }}>{fmt$(co.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Copy All */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => { navigator.clipboard.writeText(allText); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500); }}
          style={{ fontSize: 10, fontWeight: 700, color: C.dark, background: C.teal, border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}
        >
          {copiedAll ? "Copied!" : "Copy All Values"}
        </button>
      </div>
    </div>
  );
}

function MetaField({ label, value }) {
  return (
    <div style={{ background: C.linen, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: C.textFaint, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textHead, fontFamily: F.ui }}>{value}</div>
    </div>
  );
}
