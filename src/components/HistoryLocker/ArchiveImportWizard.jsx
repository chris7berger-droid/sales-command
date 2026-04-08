import { useState, useCallback, useMemo } from "react";
import { C, F } from "../../lib/tokens";
import { supabase, archiveDb } from "../../lib/supabase";
import FileUpload, { FilePreview } from "../../pages/Import/FileUpload";
import Btn from "../Btn";

const SOURCES = [
  { id: "glide", label: "Glide" },
  { id: "buildertrend", label: "Buildertrend" },
  { id: "quickbooks", label: "QuickBooks" },
  { id: "other", label: "Other" },
];

const RECORD_TYPES = [
  { id: "call_log", label: "Call Log / Jobs" },
  { id: "customer", label: "Customers" },
  { id: "invoice", label: "Invoices" },
  { id: "proposal", label: "Proposals" },
  { id: "other", label: "Other" },
];

const EXTRACT_FIELDS = [
  { key: "legacy_id", label: "Original ID / Job #" },
  { key: "customer_name", label: "Customer Name" },
  { key: "job_address", label: "Job Address" },
  { key: "job_name", label: "Job Name / Description" },
  { key: "record_date", label: "Date" },
  { key: "amount", label: "Amount ($)" },
  { key: "status", label: "Status" },
];

const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "source", label: "Source & Type" },
  { key: "mapping", label: "Field Mapping" },
  { key: "review", label: "Review & Import" },
];

const inputStyle = {
  padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 12.5, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none",
};

export default function ArchiveImportWizard({ tenantId, onDone }) {
  const [step, setStep] = useState(0);
  const [fileData, setFileData] = useState(null);
  const [source, setSource] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [recordType, setRecordType] = useState("");
  const [mappings, setMappings] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const canNext = () => {
    if (step === 0) return !!fileData;
    if (step === 1) return !!source && !!recordType;
    if (step === 2) return true; // mappings are optional for archive
    return false;
  };

  const handleParsed = useCallback((data) => setFileData(data), []);

  // Auto-match on step 2 entry
  const initMappings = useCallback(() => {
    if (!fileData) return;
    const auto = {};
    for (const h of fileData.headers) {
      const lower = h.toLowerCase().replace(/[_\-/]/g, " ");
      let matched = "";
      for (const f of EXTRACT_FIELDS) {
        const fLower = f.label.toLowerCase();
        const fKey = f.key.replace(/_/g, " ");
        if (lower === fKey || lower === fLower || lower.includes(fKey) || lower.includes(fLower)) {
          matched = f.key;
          break;
        }
      }
      // Fallback heuristics
      if (!matched) {
        if (/\b(id|number|num|job ?#|job ?no)\b/i.test(h)) matched = "legacy_id";
        else if (/\bcustomer\b/i.test(h) && /\bname\b/i.test(h)) matched = "customer_name";
        else if (/\baddress\b/i.test(h)) matched = "job_address";
        else if (/\b(project|job)\b/i.test(h) && /\bname\b/i.test(h)) matched = "job_name";
        else if (/\b(date|created)\b/i.test(h) && !/\bdue\b/i.test(h)) matched = "record_date";
        else if (/\b(amount|total|price)\b/i.test(h)) matched = "amount";
        else if (/\b(status|stage)\b/i.test(h)) matched = "status";
      }
      auto[h] = matched;
    }
    setMappings(auto);
  }, [fileData]);

  const usedTargets = useMemo(() => {
    const used = new Set();
    for (const v of Object.values(mappings)) {
      if (v) used.add(v);
    }
    return used;
  }, [mappings]);

  const handleImport = async () => {
    if (!fileData || !tenantId) return;
    setImporting(true);

    try {
      // Build legacy_records from rows
      const records = fileData.rows.map(row => {
        const rec = {
          tenant_id: tenantId,
          source_system: source,
          record_type: recordType,
          raw_data: row,
        };
        // Extract mapped fields
        for (const [header, target] of Object.entries(mappings)) {
          if (!target || row[header] == null || row[header] === "") continue;
          const val = String(row[header]).trim();
          if (!val) continue;

          if (target === "amount") {
            const num = parseFloat(val.replace(/[$,\s]/g, ""));
            if (!isNaN(num)) rec.amount = num;
          } else if (target === "record_date") {
            const d = parseDate(val);
            if (d) rec.record_date = d;
          } else {
            rec[target] = val;
          }
        }
        return rec;
      });

      // Create import batch
      const { data: batch, error: batchErr } = await archiveDb
        .from("import_batches")
        .insert({
          tenant_id: tenantId,
          source_system: source,
          source_label: sourceLabel || null,
          record_type: recordType,
          file_name: fileData.fileName,
          row_count: records.length,
          field_mapping: mappings,
        })
        .select()
        .single();

      if (batchErr) throw batchErr;

      // Upload source file to storage
      const safeName = fileData.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${tenantId}/${batch.id}/${safeName}`;
      // We don't have the raw file blob here, but we store the CSV representation
      const csvBlob = new Blob([rowsToCsv(fileData.headers, fileData.rows)], { type: "text/csv" });
      await supabase.storage.from("archive-source-files").upload(storagePath, csvBlob);

      // Update batch with storage path
      await archiveDb
        .from("import_batches")
        .update({ file_storage_path: storagePath })
        .eq("id", batch.id);

      // Insert records in batches of 500
      let inserted = 0;
      for (let i = 0; i < records.length; i += 500) {
        const chunk = records.slice(i, i + 500).map(r => ({
          ...r,
          import_batch_id: batch.id,
        }));
        const { error: insertErr } = await archiveDb
          .from("legacy_records")
          .insert(chunk);
        if (insertErr) throw insertErr;
        inserted += chunk.length;
      }

      setResult({ success: true, count: inserted, batchId: batch.id });
    } catch (err) {
      setResult({ success: false, error: err.message });
    }

    setImporting(false);
  };

  // Step navigation
  const next = () => {
    if (step === 1) initMappings();
    if (canNext()) setStep(s => s + 1);
  };
  const back = () => setStep(s => Math.max(0, s - 1));

  // Done screen
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        {result.success ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
              Import Complete
            </div>
            <div style={{ fontSize: 14, color: C.textMuted, fontFamily: F.ui, marginBottom: 24 }}>
              {result.count.toLocaleString()} records archived from {fileData?.fileName}
            </div>
            <Btn v="primary" sz="md" onClick={onDone}>Back to History Locker</Btn>
          </>
        ) : (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#10007;</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.red, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
              Import Failed
            </div>
            <div style={{ fontSize: 14, color: C.textMuted, fontFamily: F.ui, marginBottom: 24 }}>
              {result.error}
            </div>
            <Btn v="ghost" sz="md" onClick={() => { setResult(null); setStep(2); }}>Try Again</Btn>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28 }}>
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div onClick={() => { if (done) setStep(i); }} style={{ display: "flex", alignItems: "center", gap: 8, cursor: done ? "pointer" : "default", opacity: active ? 1 : done ? 0.85 : 0.4 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: active ? C.dark : done ? C.tealDeep : C.linenDeep,
                  color: active ? C.teal : done ? "#fff" : C.textFaint,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, fontFamily: F.display,
                  border: active ? `2px solid ${C.teal}` : "2px solid transparent",
                }}>
                  {done ? "\u2713" : i + 1}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: F.display, letterSpacing: "0.05em", textTransform: "uppercase", color: active ? C.textHead : done ? C.tealDeep : C.textFaint, whiteSpace: "nowrap" }}>
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

      {/* Step content */}
      <div style={{ background: C.linenCard, borderRadius: 12, padding: 28, border: `1px solid ${C.borderStrong}` }}>

        {/* Step 0: Upload */}
        {step === 0 && (
          <>
            {!fileData && <FileUpload onParsed={handleParsed} />}
            {fileData && <FilePreview data={fileData} onSheetChange={() => {}} />}
          </>
        )}

        {/* Step 1: Source & Type */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 16 }}>
              Where is this data from?
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={labelStyle}>Source System</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {SOURCES.map(s => (
                    <button key={s.id} onClick={() => setSource(s.id)} style={{
                      padding: "8px 16px", borderRadius: 8,
                      border: `1.5px solid ${source === s.id ? C.teal : C.borderStrong}`,
                      background: source === s.id ? C.dark : C.linenDeep,
                      color: source === s.id ? C.teal : C.textBody,
                      fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.04em", textTransform: "uppercase",
                    }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={labelStyle}>Record Type</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {RECORD_TYPES.map(t => (
                    <button key={t.id} onClick={() => setRecordType(t.id)} style={{
                      padding: "8px 16px", borderRadius: 8,
                      border: `1.5px solid ${recordType === t.id ? C.teal : C.borderStrong}`,
                      background: recordType === t.id ? C.dark : C.linenDeep,
                      color: recordType === t.id ? C.teal : C.textBody,
                      fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: F.display,
                      letterSpacing: "0.04em", textTransform: "uppercase",
                    }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={labelStyle}>Label (optional)</div>
              <input
                placeholder="e.g. HDSP Call Log 2019-2025"
                value={sourceLabel}
                onChange={e => setSourceLabel(e.target.value)}
                style={{ ...inputStyle, width: "100%", maxWidth: 400 }}
              />
            </div>
          </div>
        )}

        {/* Step 2: Field Mapping */}
        {step === 2 && fileData && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
              Map Searchable Fields
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 16, lineHeight: 1.5 }}>
              All columns are preserved in the archive automatically. Map the fields below to make them searchable and filterable. Any unmapped columns are still stored in the raw record.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 32px 1fr", gap: 8, padding: "0 2px", marginBottom: 2 }}>
                <div style={colHeaderStyle}>Your File Column</div>
                <div />
                <div style={colHeaderStyle}>Searchable Field</div>
              </div>

              {fileData.headers.map(header => {
                const target = mappings[header] || "";
                return (
                  <div key={header} style={{
                    display: "grid", gridTemplateColumns: "1fr 32px 1fr", gap: 8, alignItems: "center",
                    padding: "8px 10px", borderRadius: 8,
                    background: target ? "rgba(67,160,71,0.08)" : C.linenDeep,
                    border: `1px solid ${target ? "rgba(67,160,71,0.25)" : C.borderStrong}`,
                  }}>
                    <span style={{ background: C.dark, color: C.teal, padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: F.ui, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240 }}>
                      {header}
                    </span>
                    <div style={{ textAlign: "center", color: target ? C.tealDark : C.textFaint, fontSize: 14, fontWeight: 700 }}>
                      &rarr;
                    </div>
                    <select
                      value={target}
                      onChange={e => setMappings(prev => ({ ...prev, [header]: e.target.value }))}
                      style={{
                        padding: "6px 10px", borderRadius: 6,
                        border: `1px solid ${C.borderStrong}`, background: C.linenDeep,
                        color: target ? C.textBody : C.textFaint,
                        fontSize: 12.5, fontFamily: F.ui, WebkitAppearance: "none", cursor: "pointer",
                      }}
                    >
                      <option value="">— Stored only (not searchable) —</option>
                      {EXTRACT_FIELDS.map(f => {
                        const taken = usedTargets.has(f.key) && target !== f.key;
                        return (
                          <option key={f.key} value={f.key} disabled={taken}>
                            {f.label}{taken ? " (already mapped)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Review & Import */}
        {step === 3 && fileData && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 16 }}>
              Review & Import
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <SummaryItem label="File" value={fileData.fileName} />
              <SummaryItem label="Records" value={`${fileData.rows.length.toLocaleString()} rows`} />
              <SummaryItem label="Source" value={SOURCES.find(s => s.id === source)?.label || source} />
              <SummaryItem label="Type" value={RECORD_TYPES.find(t => t.id === recordType)?.label || recordType} />
              {sourceLabel && <SummaryItem label="Label" value={sourceLabel} />}
              <SummaryItem label="Searchable Fields" value={Object.values(mappings).filter(Boolean).length + " of " + EXTRACT_FIELDS.length} />
            </div>

            {/* Preview first 5 rows */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
              Preview (first 5 rows)
            </div>
            <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.borderStrong}`, marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.ui }}>
                <thead>
                  <tr>
                    {EXTRACT_FIELDS.filter(f => usedTargets.has(f.key)).map(f => (
                      <th key={f.key} style={thStyle}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fileData.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? C.linenLight : C.linen }}>
                      {EXTRACT_FIELDS.filter(f => usedTargets.has(f.key)).map(f => {
                        const header = Object.entries(mappings).find(([, v]) => v === f.key)?.[0];
                        return (
                          <td key={f.key} style={tdStyle}>{header ? row[header] ?? "" : ""}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Btn v="primary" sz="lg" onClick={handleImport} disabled={importing}>
              {importing ? "Importing..." : `Archive ${fileData.rows.length.toLocaleString()} Records`}
            </Btn>
          </div>
        )}
      </div>

      {/* Footer nav */}
      {step < 3 && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
          <div>{step > 0 && <Btn v="ghost" sz="md" onClick={back}>&larr; Back</Btn>}</div>
          <div><Btn v="primary" sz="md" onClick={next} disabled={!canNext()}>Next &rarr;</Btn></div>
        </div>
      )}
      {step === 3 && (
        <div style={{ marginTop: 20 }}>
          <Btn v="ghost" sz="md" onClick={back}>&larr; Back</Btn>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div style={{ background: C.linenDeep, borderRadius: 8, padding: "10px 14px", border: `1px solid ${C.borderStrong}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textFaint, fontFamily: F.display, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textHead, fontFamily: F.ui }}>{value}</div>
    </div>
  );
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{5}$/.test(s)) {
    const d = new Date((parseInt(s) - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (s instanceof Date) return s.toISOString().slice(0, 10);
  if (/\d/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10);
  }
  return null;
}

function rowsToCsv(headers, rows) {
  const escaped = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escaped).join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escaped(row[h])).join(","));
  }
  return lines.join("\n");
}

const labelStyle = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: C.textFaint, fontFamily: F.display, marginBottom: 6,
};
const colHeaderStyle = {
  fontSize: 10.5, fontWeight: 700, color: C.textFaint,
  fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase",
};
const thStyle = {
  padding: "8px 12px", textAlign: "left", fontWeight: 700, fontSize: 11,
  color: C.teal, background: C.dark, whiteSpace: "nowrap", letterSpacing: "0.04em",
  textTransform: "uppercase", fontFamily: F.display,
};
const tdStyle = {
  padding: "6px 12px", color: C.textBody, whiteSpace: "nowrap", maxWidth: 200,
  overflow: "hidden", textOverflow: "ellipsis",
};
