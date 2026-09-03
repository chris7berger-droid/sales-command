import { useRef } from "react";
import * as XLSX from "xlsx";
import { C, F } from "../lib/tokens";
import { parseDetailReport, fmtShort } from "../lib/utils";
import { useAR } from "../lib/ARContext";

export default function Topbar({ activeTab, onTabChange, onExport }) {
  const { customers, reportDate, importReport } = useAR();
  const fileRef = useRef();
  const grandTotal = customers.reduce((s, c) => s + c.total, 0);

  const handleNewReport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        const dateLine = rows[2] ? String(rows[2][0] || "").replace("As of ", "") : "";
        const { customers: custs, invoices } = parseDetailReport(rows);
        if (custs.length) importReport(custs, invoices, dateLine);
      } catch {}
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const tabs = [
    { id: "triage", label: "Triage" },
    { id: "aging", label: "Dashboard" },
    { id: "action", label: "Chase" },
    { id: "health", label: "Health Check", rpt: true },
    { id: "cff", label: "Cash Flow", rpt: true },
    { id: "invoices", label: "Invoices", rpt: true },
  ];

  return (
    <>
      <div style={S.bar}>
        <div style={S.left}>
          <span style={S.brand}>AR <span style={{ color: C.pop }}>Command</span></span>
          {reportDate && <span style={S.date}>{reportDate}</span>}
        </div>
        <div style={S.right}>
          <span style={S.total}>Total: <b style={{ color: C.pop }}>{fmtShort(grandTotal)}</b></span>
          <button style={S.btn} onClick={onExport}>
            <svg viewBox="0 0 24 24" style={{ width: 13, height: 13, fill: "currentColor" }}>
              <path d="M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zM8 5h8v3H8V5zm8 14H8v-4h8v4zm2-4v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4h-2z"/>
            </svg>
            {activeTab === "triage" ? "Accountant Review" : "Print / Export"}
          </button>
          <label style={S.btn}>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={handleNewReport} />
            New Report
          </label>
        </div>
      </div>
      <div style={S.tabBar}>
        {tabs.map((t, i) => (
          <span key={t.id}>
            {i === 3 && <div style={S.sep} />}

            <button
              style={{ ...S.tab, ...(activeTab === t.id ? S.tabActive : {}), ...(t.rpt ? S.tabRpt : {}), ...(t.rpt && activeTab === t.id ? S.tabRptActive : {}) }}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          </span>
        ))}
      </div>
    </>
  );
}

const S = {
  bar: { background: C.dark, padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", position: "sticky", top: 0, zIndex: 100 },
  left: { display: "flex", alignItems: "center", gap: 12, padding: "12px 0" },
  brand: { fontFamily: F.display, fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" },
  date: { fontSize: 10, color: C.textFaint, fontFamily: "monospace", background: C.darkRaised, padding: "3px 8px", borderRadius: 4 },
  right: { display: "flex", alignItems: "center", gap: 10, padding: "12px 0" },
  total: { fontFamily: F.display, fontSize: 12, color: C.textFaint, letterSpacing: "0.04em" },
  btn: { background: C.darkRaised, border: `1px solid ${C.darkBorder}`, borderRadius: 6, padding: "5px 12px", color: "rgba(255,255,255,0.5)", fontFamily: F.display, fontSize: 11, cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em", display: "inline-flex", alignItems: "center", gap: 5 },
  tabBar: { background: C.dark, borderTop: `1px solid ${C.darkRaised}`, padding: "0 20px", display: "flex", gap: 0, position: "sticky", top: 44, zIndex: 99 },
  tab: { fontFamily: F.display, padding: "10px 20px", fontSize: 12, fontWeight: 700, color: C.textFaint, cursor: "pointer", border: "none", background: "none", borderBottom: "2px solid transparent", transition: "all 0.15s", letterSpacing: "0.06em", textTransform: "uppercase" },
  tabActive: { color: "#fff", borderBottomColor: C.pop },
  tabRpt: { color: C.popDark },
  tabRptActive: { color: C.pop, borderBottomColor: C.pop },
  sep: { width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "auto 4px", display: "inline-block", verticalAlign: "middle" },
};
