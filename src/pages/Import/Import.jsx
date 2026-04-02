import { useState, useCallback } from "react";
import { C, F, GLOBAL_CSS } from "../../lib/tokens";
import { SalesCommandMark } from "../../components/Logo";
import Btn from "../../components/Btn";
import FileUpload, { FilePreview } from "./FileUpload";
import DataTypeSelector from "./DataTypeSelector";
import ColumnMapper from "./ColumnMapper";
import { getMissingRequired } from "./importUtils";
import * as XLSX from "xlsx";

const STEPS = [
  { key: "upload",   label: "Upload" },
  { key: "dataType", label: "Data Type" },
  { key: "mapping",  label: "Column Mapping" },
  { key: "review",   label: "Review & Import" },
];

export default function Import() {
  const [step, setStep] = useState(0);
  const [fileData, setFileData] = useState(null);
  const [dataType, setDataType] = useState(null);
  const [mappings, setMappings] = useState({});

  const canNext = () => {
    if (step === 0) return !!fileData;
    if (step === 1) return !!dataType;
    if (step === 2) return dataType && getMissingRequired(dataType, mappings).length === 0;
    return false;
  };

  const next = () => { if (canNext()) setStep((s) => s + 1); };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const handleParsed = useCallback((data) => {
    setFileData(data);
  }, []);

  const handleSheetChange = useCallback((sheetName) => {
    if (!fileData?._wb) return;
    const sheet = fileData._wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const headers = json.length > 0 ? Object.keys(json[0]) : [];
    setFileData((prev) => ({ ...prev, headers, rows: cleanRowsFromJson(json, headers), activeSheet: sheetName }));
  }, [fileData]);

  const handleReset = useCallback(() => {
    setStep(0);
    setFileData(null);
    setDataType(null);
    setMappings({});
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: C.linen }}>
      {/* Top bar */}
      <div style={{ background: C.dark, padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.darkBorder}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SalesCommandMark size={28} />
          <span style={{ fontSize: 12, fontWeight: 800, color: C.teal, fontFamily: F.display, letterSpacing: "0.08em", textTransform: "uppercase" }}>Data Import Tool</span>
        </div>
        <a href="/" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", textDecoration: "none" }}>
          ← Back to Sales Command
        </a>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 28px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Data Import
          </div>
          <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui, marginTop: 2 }}>
            Migrate spreadsheet data into Sales Command
          </div>
        </div>
        {fileData && (
          <Btn v="ghost" sz="sm" onClick={handleReset}>Start Over</Btn>
        )}
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div
                onClick={() => { if (done) setStep(i); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  cursor: done ? "pointer" : "default",
                  opacity: active ? 1 : done ? 0.85 : 0.4,
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: active ? C.dark : done ? C.tealDeep : C.linenDeep,
                  color: active ? C.teal : done ? "#fff" : C.textFaint,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, fontFamily: F.display,
                  border: active ? `2px solid ${C.teal}` : "2px solid transparent",
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 700, fontFamily: F.display,
                  letterSpacing: "0.05em", textTransform: "uppercase",
                  color: active ? C.textHead : done ? C.tealDeep : C.textFaint,
                  whiteSpace: "nowrap",
                }}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? C.tealDeep : C.borderStrong, margin: "0 12px", borderRadius: 1 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div style={{ background: C.linenCard, borderRadius: 12, padding: 28, border: `1px solid ${C.borderStrong}` }}>
        {step === 0 && (
          <>
            {!fileData && <FileUpload onParsed={handleParsed} />}
            {fileData && <FilePreview data={fileData} onSheetChange={handleSheetChange} />}
          </>
        )}

        {step === 1 && (
          <DataTypeSelector selected={dataType} onSelect={(dt) => { setDataType(dt); setMappings({}); }} />
        )}

        {step === 2 && fileData && dataType && (
          <ColumnMapper
            fileData={fileData}
            dataType={dataType}
            mappings={mappings}
            onMappingsChange={setMappings}
          />
        )}

        {step === 3 && (
          <PlaceholderStep label="Review & Import" desc="Coming in Session 3" />
        )}
      </div>

      {/* Footer navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <div>
          {step > 0 && (
            <Btn v="ghost" sz="md" onClick={back}>← Back</Btn>
          )}
        </div>
        <div>
          {step < STEPS.length - 1 && (
            <Btn v="primary" sz="md" onClick={next} disabled={!canNext()}>
              Next →
            </Btn>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function PlaceholderStep({ label, desc }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 10 }}>
      <div style={{ fontSize: 36 }}>🚧</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13, color: C.textFaint, fontFamily: F.ui }}>{desc}</div>
    </div>
  );
}

/* Re-use the cleaning logic for sheet switches */
function cleanRowsFromJson(rows, headers) {
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
