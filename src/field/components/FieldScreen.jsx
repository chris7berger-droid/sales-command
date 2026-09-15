import { C, F } from "../../lib/tokens";
import Btn from "../../components/Btn";

// Shared chrome for every Field web screen: titled header + command-board well.
// View-only office screens — no toolbar actions (Manager/Admin corrections come later).
export default function FieldScreen({ title, subtitle, right, children }) {
  return (
    <div style={{ fontFamily: F.body, color: C.textBody }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 26,
              fontWeight: 800,
              color: C.textHead,
              fontFamily: F.display,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <div style={{ marginTop: 4, fontSize: 13.5, color: C.textFaint, fontFamily: F.body }}>{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// Compact KPI row — linen cards, teal/amber/red top edge, Barlow numbers.
export function StatStrip({ items = [] }) {
  if (!items.length) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        gap: 10,
        marginBottom: 14,
      }}
    >
      {items.map((it) => {
        const accent = it.tone === "amber" ? C.amber : it.tone === "red" ? C.red : it.tone === "muted" ? C.textLight : C.teal;
        const clickable = typeof it.onClick === "function";
        const selected = !!it.selected;
        const Tag = clickable ? "button" : "div";
        return (
          <Tag
            key={it.id || it.label}
            type={clickable ? "button" : undefined}
            onClick={clickable ? it.onClick : undefined}
            style={{
              background: selected ? C.linen : C.linenCard,
              border: `1.5px solid ${selected ? C.dark : C.borderStrong}`,
              borderRadius: 10,
              padding: "14px 16px",
              borderTop: `${selected ? 4 : 3}px solid ${accent}`,
              boxShadow: selected ? `0 0 0 1px ${C.dark}, 0 2px 8px rgba(28,24,20,0.12)` : "0 2px 8px rgba(28,24,20,0.08)",
              textAlign: "left",
              width: "100%",
              cursor: clickable ? "pointer" : "default",
              font: "inherit",
              color: "inherit",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: C.textLight,
                fontFamily: F.ui,
                marginBottom: 6,
              }}
            >
              {it.label}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: C.textHead,
                letterSpacing: "-0.02em",
                fontFamily: F.display,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {it.value}
            </div>
            {it.hint ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11.5,
                  color: C.textFaint,
                  fontFamily: F.body,
                }}
              >
                {it.hint}
              </div>
            ) : null}
          </Tag>
        );
      })}
    </div>
  );
}

// Same as CallLog stage chips: dark + teal when on.
export function FilterChips({ options = [], value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              padding: "7px 16px",
              borderRadius: 20,
              border: `1.5px solid ${on ? C.teal : C.border}`,
              background: on ? C.dark : "transparent",
              color: on ? C.teal : C.textMuted,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: F.display,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {o.label}
            {o.count != null && <span style={{ opacity: 0.6, marginLeft: 4 }}>({o.count})</span>}
          </button>
        );
      })}
    </div>
  );
}

const CHIP_TONE = {
  teal: { bg: C.dark, color: C.teal, border: C.teal },
  amber: { bg: C.dark, color: C.amber, border: C.amber },
  red: { bg: C.dark, color: C.red, border: C.red },
  muted: { bg: C.linenDeep, color: C.textMuted, border: C.borderStrong },
};

export function StatusChip({ tone = "muted", children }) {
  const t = CHIP_TONE[tone] || CHIP_TONE.muted;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 6,
        background: t.bg,
        color: t.color,
        border: `1px solid ${t.border}`,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: "0.03em",
        fontFamily: F.ui,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function ErrorNote({ children }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        background: C.linenCard,
        border: `1px solid ${C.red}`,
        color: C.red,
        fontSize: 13,
        fontFamily: F.body,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

export function EmptyNote({ children }) {
  return (
    <div
      style={{
        border: `1px dashed ${C.borderStrong}`,
        borderRadius: 10,
        background: C.linenCard,
        padding: "40px 24px",
        textAlign: "center",
        color: C.textLight,
        fontSize: 14,
        fontFamily: F.body,
      }}
    >
      {children}
    </div>
  );
}

// columns: [{ key, label, align?, render?(row) }]. rows: array of objects.
export function PlainTable({ columns, rows, empty = "Nothing to show.", keyField, compact, rowStyle }) {
  if (!rows || rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  const pad = compact ? "8px 12px" : "12px 15px";
  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: 10,
        border: `1px solid ${C.borderStrong}`,
        boxShadow: "0 2px 10px rgba(28,24,20,0.08)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: F.ui }}>
        <thead>
          <tr style={{ background: C.dark }}>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: c.align || "left",
                  padding: compact ? "9px 12px" : "11px 15px",
                  fontWeight: 700,
                  fontSize: 10.5,
                  color: "rgba(255,255,255,0.45)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  borderBottom: `1px solid ${C.darkBorder}`,
                  fontFamily: F.ui,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyField ? row[keyField] : i}
              style={{
                borderBottom: `1px solid ${C.border}`,
                background: i % 2 === 0 ? C.linenLight : C.linen,
                ...(rowStyle ? rowStyle(row, i) : null),
              }}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align || "left",
                    padding: pad,
                    color: C.textBody,
                    verticalAlign: "middle",
                    fontSize: 13.5,
                    fontFamily: F.ui,
                  }}
                >
                  {c.render ? c.render(row) : row[c.key] ?? <span style={{ color: C.textFaint }}>—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RefreshBtn({ onClick, loading }) {
  return (
    <Btn v="dark" sz="sm" onClick={onClick} disabled={loading}>
      Refresh
    </Btn>
  );
}
