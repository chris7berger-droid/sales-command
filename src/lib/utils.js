export const fmt$ = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const fmt$c = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// F44: a rate card carries no fixed contract price — it prints as an hourly T&M
// rate ("$105/hr · Overtime"), never a line total, on the proposal detail and
// on customer-facing surfaces (PDF + signing page). Cents shown only when the
// rate has them. Pure formatting — safe to import on the public signing page
// (no pricing/cost logic, per Audit H6).
export const RATE_CLASS_LABEL = { regular: "Regular", ot: "Overtime", dt: "Double time" };
export const rateCardLabel = w => {
  const amt = Number(w?.rate_amount || 0);
  const money = "$" + amt.toLocaleString("en-US", { minimumFractionDigits: amt % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const cls = w?.rate_class ? ` · ${RATE_CLASS_LABEL[w.rate_class] || w.rate_class}` : "";
  return `${money}/hr${cls}`;
};

export const fmtD = d =>
  d ? new Date(String(d).includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// Today as YYYY-MM-DD in the *browser's* timezone. Must NOT go through
// toISOString() — that yields the UTC date, so anything stamped after 5pm
// Pacific lands on tomorrow. DB `date` columns (invoices.sent_at, due_date,
// call_log.bid_due/follow_up) hold wall-clock dates, so they compare against
// this, never against a UTC instant.
export const tod = () => new Date().toLocaleDateString("en-CA");

export const over = d => d && d < tod();

// Whole days between a DB `date` column and today, both as wall-clock dates.
// Positive = past due. Subtracting `new Date()` from `new Date("2026-08-07")`
// mixes a local instant with a UTC midnight and drifts a day after 5pm PT.
export const dayDiff = (dateStr, from = tod()) =>
  Math.round((Date.parse(from + "T00:00:00Z") - Date.parse(dateStr + "T00:00:00Z")) / 86400000);

export const inits = n => n.split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();