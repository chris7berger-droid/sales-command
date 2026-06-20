export const fmt$ = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const fmt$c = v =>
  v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtD = d =>
  d ? new Date(String(d).includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export const tod = () => new Date().toISOString().slice(0, 10);

export const over = d => d && d < tod();

export const inits = n => n.split(" ").map(x => x[0]).join("").slice(0, 2).toUpperCase();

// Single source of truth for an invoice's kind. A deposit line is byte-identical
// to a regular archive line (both null/null), so type and line-shape disagree —
// this resolves the tie consistently for the badge, the line itemization, and the
// money/rendering paths (T5 root-cause).
//   - Prefer invoices.type when it carries one of the three known kinds.
//   - Fall back to line-shape for legacy rows minted before the type backfill:
//     any line with a billing_schedule_line_id ⇒ 'pay-app'; otherwise 'regular'.
//     ('deposit' is NOT line-shape-derivable — no legacy deposit rows exist, and a
//     deposit line is indistinguishable from a regular archive line.)
export const invoiceKind = (inv, lines = []) => {
  const t = inv?.type;
  if (t === "deposit" || t === "pay-app" || t === "regular") return t;
  if ((lines || []).some(l => l.billing_schedule_line_id != null)) return "pay-app";
  return "regular";
};