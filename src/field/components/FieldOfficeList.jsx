import { C, F } from "../../lib/tokens";

// Office-list chrome for Jobs / Crews / Time Clock / Daily Logs only.
// Today and Load-Outs keep FieldScreen — do not import this there.

const CSS = `
.field-office {
  font-family: ${F.ui};
  color: ${C.textBody};
}
.field-office-header {
  background: ${C.dark};
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.field-office-heading { min-width: 0; flex: 1; }
.field-office-title {
  margin: 0;
  font-family: ${F.display};
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${C.teal};
  line-height: 1;
}
.field-office-sub {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.4;
  color: ${C.linen};
}
.field-office-count {
  margin-top: 10px;
  display: inline-block;
  font-family: ${F.display};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${C.teal};
}
.field-office-tools {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  flex-shrink: 0;
}
.field-office-viewonly {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid ${C.teal};
  color: ${C.teal};
  background: ${C.darkRaised};
  font-family: ${F.display};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.field-office-refresh {
  background: ${C.darkRaised};
  color: ${C.teal};
  border: 1px solid ${C.darkBorder};
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  font-family: ${F.ui};
  cursor: pointer;
}
.field-office-refresh:disabled {
  opacity: 0.65;
  cursor: default;
}
.field-office-error {
  padding: 12px 16px;
  border-radius: 8px;
  background: #3a1c1c;
  color: #ef6b6b;
  font-size: 13px;
  margin-bottom: 14px;
}
.field-office-well {
  border: 1px dashed ${C.borderStrong};
  border-radius: 12px;
  background: ${C.linenCard};
  padding: 40px 24px;
  text-align: center;
  color: ${C.textLight};
  font-size: 14px;
}
.field-office-loading {
  border-style: solid;
  color: ${C.textMuted};
  font-weight: 600;
}
.field-office-list { min-width: 0; }
.field-office-cols,
.field-office-row {
  display: grid;
  gap: 12px 18px;
  align-items: start;
}
.field-office-cols {
  padding: 0 16px 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${C.textMuted};
  font-family: ${F.ui};
}
.field-office-row {
  background: ${C.linenCard};
  border: 1px solid ${C.border};
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 8px;
}
.field-office-cell {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.field-office-jobnum {
  display: block;
  font-family: ${F.display};
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: ${C.textMuted};
  margin-bottom: 2px;
}
.field-office-jobname,
.field-office-member {
  font-weight: 700;
  color: ${C.textHead};
  font-size: 15px;
  line-height: 1.3;
}
.field-office-when-date {
  font-weight: 700;
  color: ${C.textHead};
  font-size: 14px;
}
.field-office-when-time {
  margin-top: 2px;
  font-size: 12.5px;
  color: ${C.textMuted};
}
.field-office-notes {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  line-height: 1.45;
  color: ${C.textBody};
  font-size: 13.5px;
}
.field-office-dash { color: ${C.textFaint}; }
.field-office-badge {
  display: inline-block;
  max-width: 100%;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.field-office-badge-quiet {
  background: ${C.linenDeep};
  color: ${C.textMuted};
}
.field-office-badge-in {
  background: ${C.dark};
  color: ${C.teal};
  border: 1px solid ${C.teal};
}
.field-office-badge-out {
  background: ${C.darkRaised};
  color: ${C.linen};
  border: 1px solid ${C.darkBorder};
}
.field-office-badge-punch {
  background: ${C.linenDeep};
  color: ${C.textBody};
}
.field-office-badge-log {
  background: ${C.dark};
  color: ${C.teal};
  border: 1px solid ${C.teal};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-size: 11px;
}
@media (max-width: 760px) {
  .field-office-header { flex-direction: column; }
  .field-office-tools { align-items: flex-start; flex-direction: row; flex-wrap: wrap; }
  .field-office-cols { display: none; }
  .field-office-row {
    grid-template-columns: 1fr !important;
    gap: 10px;
  }
  .field-office-cell[data-label]::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${C.textMuted};
  }
}
`;

export function recordCount(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function FieldOfficeScreen({ title, subtitle, count, loading, onRefresh, children }) {
  return (
    <div className="field-office">
      <style>{CSS}</style>
      <header className="field-office-header">
        <div className="field-office-heading">
          <h1 className="field-office-title">{title}</h1>
          {subtitle && <div className="field-office-sub">{subtitle}</div>}
          {count != null && <div className="field-office-count">{count}</div>}
        </div>
        <div className="field-office-tools">
          <span className="field-office-viewonly">View Only</span>
          <button className="field-office-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : "↻ Refresh"}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}

export function FieldOfficeError({ children }) {
  return <div className="field-office-error">{children}</div>;
}

export function FieldOfficeTable({ columns, rows, empty, loading, keyField, loaded }) {
  if (loading && !loaded) {
    return <div className="field-office-well field-office-loading">Loading…</div>;
  }
  if (!rows || rows.length === 0) {
    return <div className="field-office-well">{empty}</div>;
  }
  const template = columns.map((c) => c.width || "minmax(0, 1fr)").join(" ");
  return (
    <div className="field-office-list">
      <div className="field-office-cols" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => (
          <div key={c.key}>{c.label}</div>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={keyField ? row[keyField] : i}
          className="field-office-row"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c) => (
            <div key={c.key} className="field-office-cell" data-label={c.label}>
              {c.render ? c.render(row) : row[c.key] ?? <span className="field-office-dash">—</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function QuietBadge({ children }) {
  if (!children) return <span className="field-office-dash">—</span>;
  return <span className="field-office-badge field-office-badge-quiet">{children}</span>;
}

export function PunchBadge({ type }) {
  if (!type) return <span className="field-office-dash">—</span>;
  const kind = type === "clock_in" ? "in" : type === "clock_out" ? "out" : "punch";
  return (
    <span className={`field-office-badge field-office-badge-${kind}`}>
      {type.replace(/_/g, " ")}
    </span>
  );
}

export function LogTypeBadge({ type }) {
  if (!type) return <span className="field-office-dash">—</span>;
  return <span className="field-office-badge field-office-badge-log">{type}</span>;
}
