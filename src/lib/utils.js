export const fmt$ = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const fmt$c = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtD = d =>
  d ? new Date(String(d).includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const tod = () => new Date().toISOString().slice(0, 10);

export const over = d => d && d < tod();

export const inits = n => n.split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();