import { useState, useEffect, useMemo } from "react";
import { C, F } from "../../lib/tokens";
import { TARGET_FIELDS, autoMatch, transformValue, getMissingRequired } from "./importUtils";

const CONFIDENCE_COLORS = {
  high:   { bg: "rgba(67,160,71,0.12)", border: "rgba(67,160,71,0.35)", dot: C.green,  label: "Auto-matched", hint: null },
  medium: { bg: "rgba(249,168,37,0.10)", border: "rgba(249,168,37,0.30)", dot: C.amber,  label: "Best guess", hint: "Check this — change it if wrong" },
  low:    { bg: "rgba(229,57,53,0.08)",  border: "rgba(229,57,53,0.20)",  dot: "#e67e22", label: "Uncertain",  hint: "Probably wrong — pick the right field" },
  manual: { bg: "transparent",           border: C.borderStrong,          dot: C.tealDark, label: "Manual", hint: null },
};

export default function ColumnMapper({ fileData, dataType, mappings, onMappingsChange }) {
  const { headers, rows } = fileData;
  const fields = TARGET_FIELDS[dataType] || [];

  /* Run auto-match on first render (only if mappings are empty) */
  useEffect(() => {
    if (Object.keys(mappings).length > 0) return;
    const auto = autoMatch(headers, dataType);
    const initial = {};
    for (const h of headers) {
      initial[h] = auto[h] || { target: "", confidence: null };
    }
    onMappingsChange(initial);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  /* Which targets are already taken */
  const usedTargets = useMemo(() => {
    const used = new Set();
    for (const m of Object.values(mappings)) {
      if (m.target) used.add(m.target);
    }
    return used;
  }, [mappings]);

  /* Missing required fields */
  const missingRequired = useMemo(
    () => getMissingRequired(dataType, mappings),
    [dataType, mappings]
  );

  /* Preview row — first data row with transformations applied */
  const previewRow = useMemo(() => {
    if (!rows.length) return null;
    const row = rows[0];
    const result = {};
    for (const [header, mapping] of Object.entries(mappings)) {
      if (!mapping.target) continue;
      const field = fields.find(f => f.key === mapping.target);
      if (!field) continue;
      const raw = row[header];
      result[mapping.target] = {
        raw: raw ?? "",
        transformed: transformValue(raw, field.type),
        label: field.label,
      };
    }
    return result;
  }, [mappings, rows, fields]);

  function handleTargetChange(header, targetKey) {
    onMappingsChange({
      ...mappings,
      [header]: {
        target: targetKey,
        confidence: targetKey ? "manual" : null,
      },
    });
  }

  return (
    <div>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Map Your Columns
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui }}>
          {headers.length} source columns &middot; {fields.length} available fields
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 16, lineHeight: 1.5 }}>
        Green rows are good to go. Yellow rows are our best guess — use the dropdown to change them if they're wrong.
        Any column set to "Skip" won't be imported.
      </div>

      {/* Required field warnings */}
      {missingRequired.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "10px 14px",
          background: "rgba(229,57,53,0.08)", border: `1px solid rgba(229,57,53,0.25)`,
          borderRadius: 8, fontSize: 12.5, fontFamily: F.ui, color: C.red, lineHeight: 1.5,
        }}>
          <strong>Required fields not mapped:</strong>{" "}
          {missingRequired.map(f => f.label).join(", ")}
        </div>
      )}

      {/* Mapping rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 32px 1fr", gap: 8, padding: "0 2px", marginBottom: 2 }}>
          <div style={colHeaderStyle}>Your File Column</div>
          <div />
          <div style={colHeaderStyle}>Sales Command Field</div>
        </div>

        {headers.map((header) => {
          const mapping = mappings[header] || { target: "", confidence: null };
          const conf = mapping.confidence ? CONFIDENCE_COLORS[mapping.confidence] : null;

          return (
            <div
              key={header}
              style={{
                display: "grid", gridTemplateColumns: "1fr 32px 1fr", gap: 8, alignItems: "center",
                padding: "8px 10px", borderRadius: 8,
                background: conf ? conf.bg : C.linenDeep,
                border: `1px solid ${conf ? conf.border : C.borderStrong}`,
              }}
            >
              {/* Source header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  background: C.dark, color: C.teal, padding: "3px 10px",
                  borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: F.ui,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220,
                }}>
                  {header}
                </span>
              </div>

              {/* Arrow */}
              <div style={{ textAlign: "center", color: mapping.target ? C.tealDark : C.textFaint, fontSize: 14, fontWeight: 700 }}>
                →
              </div>

              {/* Target dropdown + confidence badge */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={mapping.target}
                    onChange={(e) => handleTargetChange(header, e.target.value)}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6,
                      border: `1px solid ${C.borderStrong}`, background: C.linenDeep,
                      color: mapping.target ? C.textBody : C.textFaint,
                      fontSize: 12.5, fontFamily: F.ui, WebkitAppearance: "none",
                      cursor: "pointer",
                    }}
                  >
                    <option value="">— Skip this column —</option>
                    {fields.map((f) => {
                      const taken = usedTargets.has(f.key) && mapping.target !== f.key;
                      return (
                        <option key={f.key} value={f.key} disabled={taken}>
                          {f.label}{f.required ? " *" : ""}{taken ? " (already mapped)" : ""}
                        </option>
                      );
                    })}
                  </select>

                  {/* Confidence badge */}
                  {mapping.target && conf && (
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                      fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
                      background: conf.dot, color: "#fff", whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {conf.label}
                    </span>
                  )}
                </div>

                {/* Hint text for medium/low confidence */}
                {mapping.target && conf?.hint && (
                  <div style={{
                    fontSize: 11, color: conf.dot, fontFamily: F.ui, fontWeight: 600,
                    background: C.dark, padding: "3px 10px", borderRadius: 6, alignSelf: "flex-start",
                  }}>
                    {conf.hint}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
        {["high", "medium", "low"].map((level) => {
          const c = CONFIDENCE_COLORS[level];
          return (
            <div key={level} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.textMuted, fontFamily: F.ui }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />
              {c.label}
            </div>
          );
        })}
      </div>

      {/* Live preview row */}
      {previewRow && Object.keys(previewRow).length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
            Preview — Row 1 as Sales Command Record
          </div>
          <div style={{
            background: C.linenDeep, borderRadius: 8, padding: 14,
            border: `1px solid ${C.borderStrong}`,
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px",
          }}>
            {Object.entries(previewRow).map(([key, val]) => {
              const changed = String(val.raw) !== String(val.transformed) && val.transformed !== "";
              return (
                <div key={key} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12, fontFamily: F.ui }}>
                  <span style={{ color: C.textFaint, fontWeight: 600, minWidth: 100 }}>{val.label}:</span>
                  <span style={{ color: C.textBody }}>
                    {val.transformed || <span style={{ color: C.textFaint, fontStyle: "italic" }}>empty</span>}
                  </span>
                  {changed && (
                    <span style={{ color: C.tealDark, fontSize: 10.5 }}>
                      (was: {String(val.raw)})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const colHeaderStyle = {
  fontSize: 10.5, fontWeight: 700, color: C.textFaint,
  fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase",
};
