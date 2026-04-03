import { C, F } from "../lib/tokens";

const inputStyle = {
  padding: "7px 12px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`,
  background: C.linenDeep, color: C.textBody, fontSize: 12.5, fontFamily: F.ui,
  WebkitAppearance: "none", outline: "none", minWidth: 0,
};

const selectStyle = { ...inputStyle, cursor: "pointer" };

const labelStyle = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: C.textFaint, fontFamily: F.display, marginBottom: 3,
};

export default function FilterBar({ filters, onChange, salesOptions, customerOptions, workTypeOptions }) {
  const { sales, dateFrom, dateTo, workType, customer, jobNumber } = filters;
  const set = (k, v) => onChange({ ...filters, [k]: v });

  const hasFilters = sales || dateFrom || dateTo || workType || customer || jobNumber;

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      {salesOptions && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>Sales Rep</span>
          <select value={sales || ""} onChange={e => set("sales", e.target.value)} style={{ ...selectStyle, width: 150 }}>
            <option value="">All</option>
            {salesOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>From</span>
        <input type="date" value={dateFrom || ""} onChange={e => set("dateFrom", e.target.value)} style={{ ...inputStyle, width: 140 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>To</span>
        <input type="date" value={dateTo || ""} onChange={e => set("dateTo", e.target.value)} style={{ ...inputStyle, width: 140 }} />
      </div>
      {workTypeOptions && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>Work Type</span>
          <select value={workType || ""} onChange={e => set("workType", e.target.value)} style={{ ...selectStyle, width: 170 }}>
            <option value="">All</option>
            {workTypeOptions.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Customer</span>
        <input placeholder="Filter..." value={customer || ""} onChange={e => set("customer", e.target.value)} style={{ ...inputStyle, width: 160 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={labelStyle}>Job #</span>
        <input placeholder="Filter..." value={jobNumber || ""} onChange={e => set("jobNumber", e.target.value)} style={{ ...inputStyle, width: 110 }} />
      </div>
      {hasFilters && (
        <button
          onClick={() => onChange({ sales: "", dateFrom: "", dateTo: "", workType: "", customer: "", jobNumber: "" })}
          style={{
            padding: "7px 14px", borderRadius: 7, border: `1.5px solid ${C.borderStrong}`,
            background: "transparent", color: C.textMuted, fontSize: 11.5, fontWeight: 700,
            cursor: "pointer", fontFamily: F.display, letterSpacing: "0.04em", textTransform: "uppercase",
            marginBottom: 0, alignSelf: "flex-end",
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
