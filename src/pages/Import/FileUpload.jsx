import { useState, useRef, useCallback } from "react";
import { C, F } from "../../lib/tokens";
import Papa from "papaparse";
import * as XLSX from "xlsx";

export default function FileUpload({ onParsed }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const parseFile = useCallback(async (file) => {
    setError(null);
    setParsing(true);
    const ext = file.name.split(".").pop().toLowerCase();

    try {
      if (ext === "csv") {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: "greedy",
          complete(results) {
            const headers = results.meta.fields || [];
            const rows = cleanRows(results.data, headers);
            setParsing(false);
            onParsed({ fileName: file.name, fileType: "csv", headers, rows, sheets: null, activeSheet: null });
          },
          error(err) {
            setParsing(false);
            setError("Failed to parse CSV: " + err.message);
          },
        });
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const sheetNames = wb.SheetNames;
        const sheet = wb.Sheets[sheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const headers = json.length > 0 ? Object.keys(json[0]) : [];
        const rows = cleanRows(json, headers);
        setParsing(false);
        onParsed({ fileName: file.name, fileType: "xlsx", headers, rows, sheets: sheetNames, activeSheet: sheetNames[0], _wb: wb });
      } else {
        setParsing(false);
        setError("Unsupported file type. Please upload a .csv or .xlsx file.");
      }
    } catch (e) {
      setParsing(false);
      setError("Error reading file: " + e.message);
    }
  }, [onParsed]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  const handleSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? C.teal : C.borderStrong}`,
          borderRadius: 12,
          padding: "48px 32px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? C.tealGlow : C.linenDeep,
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {parsing ? "Parsing file…" : "Drop a file here or click to browse"}
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginTop: 6 }}>
          CSV or Excel (.xlsx) — any size
        </div>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleSelect} style={{ display: "none" }} />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(229,57,53,0.08)", border: `1px solid rgba(229,57,53,0.25)`, borderRadius: 8, color: C.red, fontSize: 13, fontFamily: F.ui }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function FilePreview({ data, onSheetChange }) {
  const { fileName, fileType, headers, rows, sheets, activeSheet } = data;
  const preview = rows.slice(0, 10);

  return (
    <div style={{ marginTop: 20 }}>
      {/* File info bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ background: C.dark, color: C.teal, padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {fileType}
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textHead, fontFamily: F.ui }}>{fileName}</span>
        <span style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>{rows.length} rows detected</span>

        {sheets && sheets.length > 1 && (
          <select
            value={activeSheet}
            onChange={(e) => onSheetChange(e.target.value)}
            style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.borderStrong}`, background: C.linenDeep, color: C.textBody, fontSize: 12, fontFamily: F.ui }}
          >
            {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* Header chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {headers.map((h) => (
          <span key={h} style={{ background: C.dark, color: C.teal, padding: "3px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, fontFamily: F.ui }}>
            {h}
          </span>
        ))}
      </div>

      {/* Preview table */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.borderStrong}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.ui }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              {headers.map((h) => <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? C.linenLight : C.linenCard }}>
                <td style={tdStyle}>{i + 1}</td>
                {headers.map((h) => <td key={h} style={tdStyle}>{row[h] ?? ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginTop: 8, textAlign: "right" }}>
          Showing 10 of {rows.length} rows
        </div>
      )}
    </div>
  );
}

/* ── Helpers ── */

function cleanRows(rows, headers) {
  return rows
    .map((row) => {
      const cleaned = {};
      for (const h of headers) {
        let v = row[h];
        if (typeof v === "string") {
          v = v.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        }
        cleaned[h] = v;
      }
      return cleaned;
    })
    .filter((row) => headers.some((h) => row[h] !== "" && row[h] != null));
}

const thStyle = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 11,
  color: C.teal,
  background: C.dark,
  whiteSpace: "nowrap",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  fontFamily: F.display,
};

const tdStyle = {
  padding: "6px 12px",
  color: C.textBody,
  whiteSpace: "nowrap",
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
};
