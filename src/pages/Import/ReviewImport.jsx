import { useState, useEffect, useMemo } from "react";
import { C, F } from "../../lib/tokens";
import Btn from "../../components/Btn";
import { TARGET_FIELDS } from "./importUtils";
import { buildRows, validateRows, detectDuplicates, importRows } from "./importApi";

const STATUS_COLORS = {
  clean:   { bg: "rgba(67,160,71,0.10)", border: "rgba(67,160,71,0.30)", dot: C.green,  label: "Clean" },
  warning: { bg: "rgba(249,168,37,0.10)", border: "rgba(249,168,37,0.30)", dot: C.amber,  label: "Warning" },
  error:   { bg: "rgba(229,57,53,0.08)",  border: "rgba(229,57,53,0.25)",  dot: C.red,    label: "Error" },
};

export default function ReviewImport({ fileData, dataType, mappings }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const fields = TARGET_FIELDS[dataType] || [];
  const mappedFields = useMemo(() => {
    const targets = new Set();
    for (const m of Object.values(mappings)) {
      if (m.target) targets.add(m.target);
    }
    // Always show enriched fields for customers
    if (dataType === "customers") {
      targets.add("customer_type");
      targets.add("first_name");
      targets.add("last_name");
    }
    return fields.filter(f => targets.has(f.key));
  }, [mappings, fields, dataType]);

  /* Run validation + duplicate detection on mount */
  useEffect(() => {
    async function prepare() {
      setLoading(true);
      const built = buildRows(fileData, dataType, mappings);
      const validated = validateRows(built, dataType);
      const withDupes = await detectDuplicates(validated, dataType);

      // Set default action: skip for errors, merge for dupes, import for clean/warning
      const withActions = withDupes.map(r => ({
        ...r,
        _action: r._status === "error" ? "skip"
               : r._duplicate ? "skip"
               : "import",
      }));

      setRows(withActions);
      setLoading(false);
    }
    prepare();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Summary counts */
  const counts = useMemo(() => {
    const c = { clean: 0, warning: 0, error: 0, duplicate: 0, total: rows.length };
    for (const r of rows) {
      if (r._duplicate) c.duplicate++;
      if (r._status === "clean") c.clean++;
      else if (r._status === "warning") c.warning++;
      else if (r._status === "error") c.error++;
    }
    c.willImport = rows.filter(r => r._action === "import" || r._action === "merge").length;
    return c;
  }, [rows]);

  /* Filtered rows */
  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "duplicate") return rows.filter(r => r._duplicate);
    return rows.filter(r => r._status === filter);
  }, [rows, filter]);

  /* Toggle row action */
  function toggleAction(idx, action) {
    setRows(prev => prev.map(r => r._idx === idx ? { ...r, _action: action } : r));
  }

  /* Run import */
  async function handleImport() {
    setImporting(true);
    setProgress({ done: 0, total: counts.willImport });
    const res = await importRows(rows, dataType, (done, total) => {
      setProgress({ done, total });
    });
    setResult(res);
    setImporting(false);
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Validating rows...
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: F.ui, marginTop: 6 }}>
          Checking for errors and duplicates
        </div>
      </div>
    );
  }

  /* Post-import summary */
  if (result) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>
          {result.errored === 0 ? "\u2705" : "\u26A0\uFE0F"}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.textHead, fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 16 }}>
          Import Complete
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <StatBadge value={result.imported} label="Imported" color={C.green} />
          {result.merged > 0 && <StatBadge value={result.merged} label="Merged" color={C.teal} />}
          <StatBadge value={result.skipped} label="Skipped" color={C.textFaint} />
          {result.errored > 0 && <StatBadge value={result.errored} label="Failed" color={C.red} />}
        </div>

        {result.errors.length > 0 && (
          <div style={{
            textAlign: "left", marginTop: 16, padding: 14,
            background: "rgba(229,57,53,0.08)", border: `1px solid rgba(229,57,53,0.25)`,
            borderRadius: 8, maxHeight: 150, overflowY: "auto",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.red, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
              Errors
            </div>
            {result.errors.map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 3 }}>
                Batch {e.batch}: {e.msg}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <Btn v="primary" sz="md" onClick={() => window.location.href = "/customers"}>
            View Customers
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ fontSize: 14, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
        Review Before Import
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, fontFamily: F.ui, marginBottom: 16, lineHeight: 1.5 }}>
        Check the summary below. Green rows will be imported. Red rows have errors and will be skipped.
        Duplicates are flagged — choose to merge, import as new, or skip each one.
      </div>

      {/* Summary bar */}
      <div style={{
        display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center",
      }}>
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}
          color={C.textBody} count={counts.total} label="All" />
        <FilterPill active={filter === "clean"} onClick={() => setFilter("clean")}
          color={C.green} count={counts.clean} label="Clean" />
        <FilterPill active={filter === "warning"} onClick={() => setFilter("warning")}
          color={C.amber} count={counts.warning} label="Warnings" />
        <FilterPill active={filter === "error"} onClick={() => setFilter("error")}
          color={C.red} count={counts.error} label="Errors" />
        {counts.duplicate > 0 && (
          <FilterPill active={filter === "duplicate"} onClick={() => setFilter("duplicate")}
            color={C.purple} count={counts.duplicate} label="Duplicates" />
        )}

        <div style={{ marginLeft: "auto", fontSize: 12, fontFamily: F.ui, color: C.textMuted }}>
          <strong style={{ color: C.tealDeep }}>{counts.willImport}</strong> rows will be imported
        </div>
      </div>

      {/* Row table */}
      <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${C.borderStrong}`, maxHeight: 400, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: F.ui }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Status</th>
              {mappedFields.map(f => (
                <th key={f.key} style={thStyle}>{f.label}</th>
              ))}
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((row) => {
              const sc = STATUS_COLORS[row._status];
              return (
                <tr key={row._idx} style={{ background: sc.bg }}>
                  <td style={tdStyle}>{row._idx}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc.dot, flexShrink: 0 }} />
                      <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>{sc.label}</span>
                      {row._duplicate && (
                        <span style={{
                          background: C.dark, color: C.purple, padding: "1px 6px",
                          borderRadius: 4, fontSize: 9.5, fontWeight: 700, fontFamily: F.display,
                          letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap",
                        }}>
                          Dupe
                        </span>
                      )}
                    </div>
                    {row._issues.length > 0 && (
                      <div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 2 }}>
                        {row._issues.map((iss, j) => (
                          <div key={j} style={{
                            fontSize: 10.5, color: iss.level === "error" ? C.red : C.amber,
                            background: C.dark, padding: "2px 8px", borderRadius: 4,
                            alignSelf: "flex-start", whiteSpace: "normal",
                          }}>
                            {iss.msg}
                          </div>
                        ))}
                      </div>
                    )}
                    {row._duplicate && (
                      <div style={{ fontSize: 10.5, color: C.purple, marginTop: 2 }}>
                        Matches: {row._duplicate.name}
                      </div>
                    )}
                  </td>
                  {mappedFields.map(f => (
                    <td key={f.key} style={tdStyle}>
                      {row[f.key] ?? ""}
                    </td>
                  ))}
                  <td style={tdStyle}>
                    {row._status === "error" ? (
                      <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Skipped</span>
                    ) : row._duplicate ? (
                      <select
                        value={row._action}
                        onChange={(e) => toggleAction(row._idx, e.target.value)}
                        style={{
                          padding: "3px 6px", borderRadius: 4, fontSize: 11,
                          border: `1px solid ${C.borderStrong}`, background: C.linenDeep,
                          color: C.textBody, fontFamily: F.ui, WebkitAppearance: "none",
                        }}
                      >
                        <option value="skip">Skip</option>
                        <option value="merge">Merge (update existing)</option>
                        <option value="import">Import as new</option>
                      </select>
                    ) : (
                      <select
                        value={row._action}
                        onChange={(e) => toggleAction(row._idx, e.target.value)}
                        style={{
                          padding: "3px 6px", borderRadius: 4, fontSize: 11,
                          border: `1px solid ${C.borderStrong}`, background: C.linenDeep,
                          color: C.textBody, fontFamily: F.ui, WebkitAppearance: "none",
                        }}
                      >
                        <option value="import">Import</option>
                        <option value="skip">Skip</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 100 && (
        <div style={{ fontSize: 11.5, color: C.textFaint, fontFamily: F.ui, marginTop: 6, textAlign: "right" }}>
          Showing 100 of {filtered.length} rows
        </div>
      )}

      {/* Import button + progress */}
      <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 16 }}>
        {!importing ? (
          <Btn v="primary" sz="lg" onClick={handleImport} disabled={counts.willImport === 0}>
            Import {counts.willImport} Rows
          </Btn>
        ) : (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textHead, fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
              Importing... {progress.done} / {progress.total}
            </div>
            <div style={{
              height: 8, background: C.linenDeep, borderRadius: 4, overflow: "hidden",
              border: `1px solid ${C.borderStrong}`,
            }}>
              <div style={{
                height: "100%", background: C.teal, borderRadius: 4,
                width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%`,
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function FilterPill({ active, onClick, color, count, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 12px", borderRadius: 6,
        background: active ? C.dark : "transparent",
        border: active ? `1.5px solid ${color}` : `1.5px solid ${C.borderStrong}`,
        cursor: "pointer", transition: "all 0.12s",
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span style={{
        fontSize: 12, fontWeight: 700, fontFamily: F.display,
        letterSpacing: "0.04em", textTransform: "uppercase",
        color: active ? color : C.textMuted,
      }}>
        {count} {label}
      </span>
    </button>
  );
}

function StatBadge({ value, label, color }) {
  return (
    <div style={{
      background: C.dark, padding: "8px 16px", borderRadius: 8,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: F.display }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", fontFamily: F.display, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

/* ── Table styles ── */

const thStyle = {
  padding: "8px 10px", textAlign: "left", fontWeight: 700, fontSize: 10.5,
  color: C.teal, background: C.dark, whiteSpace: "nowrap",
  letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: F.display,
  position: "sticky", top: 0, zIndex: 1,
};

const tdStyle = {
  padding: "6px 10px", color: C.textBody, whiteSpace: "nowrap",
  maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis",
  borderBottom: `1px solid ${C.border}`,
  verticalAlign: "top",
};
