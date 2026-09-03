import { useCallback } from "react";
import * as XLSX from "xlsx";
import { C, F } from "../lib/tokens";
import { parseDetailReport } from "../lib/utils";
import { useAR } from "../lib/ARContext";

export default function Upload() {
  const { importReport } = useAR();

  const handleFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        const dateLine = rows[2] ? String(rows[2][0] || "").replace("As of ", "") : "";
        const { customers, invoices } = parseDetailReport(rows);
        if (!customers.length) { alert("No transactions found in this file."); return; }
        importReport(customers, invoices, dateLine);
      } catch (err) {
        alert("Error reading file: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }, [importReport]);

  const onDrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); };
  const onDragOver = (e) => e.preventDefault();

  return (
    <div style={S.wrap}>
      <div style={S.box}>
        <div style={S.title}>AR <span style={{ color: C.popDeep }}>Command</span></div>
        <div style={S.sub}>QuickBooks A/R Aging Detail Report Analyzer</div>
        <label style={S.area} onDrop={onDrop} onDragOver={onDragOver}>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
          <div style={S.icon}>📊</div>
          <div style={S.text}>Drop your QB report here, or click to browse</div>
          <div style={S.hint}>Accepts .xlsx, .xls, or .csv</div>
        </label>
        <div style={S.privacy}>Your data stays in your browser. Nothing is sent anywhere.</div>
      </div>
    </div>
  );
}

const S = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", zIndex: 1 },
  box: { textAlign: "center", maxWidth: 460 },
  title: { fontFamily: F.display, fontSize: 42, fontWeight: 800, color: C.textHead, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" },
  sub: { fontFamily: F.display, fontSize: 14, color: C.textFaint, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 36 },
  area: { display: "block", border: `2px dashed ${C.borderStrong}`, borderRadius: 14, padding: "44px 28px", background: "rgba(28,24,20,0.03)", cursor: "pointer", transition: "all 0.2s" },
  icon: { fontSize: 44, marginBottom: 14, opacity: 0.5 },
  text: { fontSize: 15, fontWeight: 600, color: C.textBody, marginBottom: 6 },
  hint: { fontSize: 12, color: C.textFaint },
  privacy: { marginTop: 28, fontSize: 11, color: C.textFaint, fontFamily: "monospace" },
};
