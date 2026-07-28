// ── Shared WTC calculation helpers ──────────────────────────────────────
// Single source of truth. Used by WTCCalculator, Proposals, Invoices,
// and PublicSigningPage. Do NOT duplicate these in component files.

// ── Exact-penny pricing (§exact_penny_pricing plan, amended 2026-07-28) ──
// Exact-penny pricing is a WINDOW, not an open-ended era. A proposal bills to
// the exact penny (Math.round to cent) iff its pricing era falls in
// [EXACT_PRICING_CUTOFF, EXACT_PRICING_END). Outside that window — before it or
// after it — pricing rounds UP to the whole dollar (Math.ceil).
//
// Why the window closed: the 6/26 change treated round-UP as the defect, but the
// real defect was that the customer-facing proposal PDF printed its own raw,
// un-rounded sum (ProposalPDFModal computed the total by hand instead of using
// calcWtcPrice) while the invoice billed the rounded figure. Customers paid what
// the proposal said and came up cents short. With the PDF fixed to print the
// same number the invoice bills, round-UP is coherent again — and it is the
// house preference for customer-facing numbers.
//
// The window is CLOSED, not deleted: proposals quoted between 6/26 and 7/29 were
// quoted, sent, and in some cases signed at penny-exact prices. Moving them now
// would change contract amounts on committed work. They keep penny pricing
// forever.
//
// The era is `pricing_anchor_at ?? created_at`: normally created_at, but a
// multi-GC clone inherits its SOURCE's era via pricing_anchor_at so a clone
// never silently flips ceil↔exact. That field is also the hook for a future
// per-job "bill to the exact penny" switch — anchoring a proposal inside the
// window opts it back into penny pricing without a new column.
export const EXACT_PRICING_CUTOFF = Date.parse("2026-06-26T12:00:00-05:00");
// Midnight Central 2026-07-29 — deliberately AFTER the two proposals quoted on
// 7/28 (one already Sent to a customer at $27,443.47). An earlier boundary would
// have repriced a proposal already in a customer's hands.
export const EXACT_PRICING_END = Date.parse("2026-07-29T00:00:00-05:00");

// Shared SELECT fragment — the pricing-era columns. Splice into EVERY
// `from("proposals").select(...)` and `proposals(...)` embed so the column set
// can never drift. Dropping pricing_anchor_at here silently mis-bills clones,
// and the dev-warn is BLIND to a missing nullable column (null reads identical
// to absent), so this fragment is a contract, not a convenience.
export const PROPOSAL_ERA = "created_at, pricing_anchor_at";

// Decide whether a proposal prices to the exact penny. SAFE DEFAULT = ceil:
// any missing/unparseable era, wrong object, or thin embed returns false, so no
// unwired path can silently produce exact (which would under-bill).
export function usesExactPricing(proposal) {
  // (a) wrong-object guard — a WTC row carries `proposal_id`; a proposal does
  // not (it has `id`). Never read a WTC's own created_at.
  if (proposal && proposal.proposal_id != null) {
    if (import.meta.env?.DEV) {
      console.warn(
        "[usesExactPricing] got a WTC-shaped object (has proposal_id); expected a proposal. Returning false (legacy ceil).",
        proposal
      );
    }
    return false;
  }
  const era = proposal?.pricing_anchor_at ?? proposal?.created_at;
  const ts = era ? Date.parse(era) : NaN;
  if (Number.isNaN(ts)) {
    // (b) thin-proposal guard — looks like a proposal embed (has call_log_id,
    // no proposal_id) but the era cols were never SELECTed. Warn loudly so a
    // missing PROPOSAL_ERA fragment screams in dev instead of silently ceiling.
    if (import.meta.env?.DEV && proposal?.call_log_id != null && proposal?.proposal_id == null) {
      console.warn(
        "[usesExactPricing] proposal missing created_at/pricing_anchor_at — add the PROPOSAL_ERA fragment to this SELECT. Returning false (legacy ceil).",
        proposal
      );
    }
    return false;
  }
  return ts >= EXACT_PRICING_CUTOFF && ts < EXACT_PRICING_END;
}

// Round a raw dollar figure: exact → nearest cent (kills float dust), legacy →
// round UP to the whole dollar (unchanged behavior).
export function roundPrice(raw, exact) {
  return exact ? Math.round(raw * 100) / 100 : Math.ceil(raw);
}

export function calcLabor({ regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate, size }) {
  const regularCost = (regular_hours || 0) * (burden_rate || 0);
  const otCost = (ot_hours || 0) * (ot_burden_rate || 0);
  const subtotal = regularCost + otCost;
  const markupAmt = subtotal * ((markup_pct || 0) / 100);
  const total = subtotal + markupAmt;
  const sqftPrice = (size || 0) > 0 ? total / size : 0;
  const profitMargin = total > 0 ? (markupAmt / total) * 100 : 0;
  return { regularCost, otCost, subtotal, markupAmt, total, sqftPrice, profitMargin };
}

export function calcMaterialRow(item) {
  const price = parseFloat(item.price_per_unit) || 0;
  const qty = parseFloat(item.qty) || 0;
  const base = price * qty;
  const tax = base * ((parseFloat(item.tax) || 0) / 100);
  const freight = parseFloat(item.freight) || 0;
  const subtotal = base + tax + freight;
  const markup = subtotal * ((parseFloat(item.markup_pct) || 0) / 100);
  return subtotal + markup;
}

export function calcTravel(t) {
  if (!t) return 0;
  const drive    = (t.drive_rate || 0) * (t.drive_miles || 0);
  const fly      = (t.fly_rate || 0) * (t.fly_tickets || 0);
  const stay     = (t.stay_rate || 0) * (t.stay_nights || 0);
  const per_diem = (t.per_diem_rate || 0) * (t.per_diem_days || 0) * (t.per_diem_crew || 0);
  return drive + fly + stay + per_diem;
}

export function calcWtcBreakdown(wtc, exact = false) {
  const rate = wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours, ot_hours: wtc.ot_hours,
    markup_pct: wtc.markup_pct, burden_rate: rate, ot_burden_rate: otRate, size: wtc.size,
  });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const matsCost = (wtc.materials || []).reduce((s, i) => {
    const price = parseFloat(i.price_per_unit) || 0;
    const qty = parseFloat(i.qty) || 0;
    const base = price * qty;
    const tax = base * ((parseFloat(i.tax) || 0) / 100);
    const freight = parseFloat(i.freight) || 0;
    return s + base + tax + freight;
  }, 0);
  const trav = calcTravel(wtc.travel);
  const totalPrice = roundPrice(labor.total + mats + trav - (wtc.discount || 0), exact);
  const totalCost = labor.subtotal + matsCost + trav;
  const profit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
  // laborCost/materialCost/travelCost are the same locals that build totalCost
  // above — surfaced (not re-derived) so labor+materials+travel === cost by
  // construction. Additive: existing callers ignore the extra keys.
  return {
    price: totalPrice, cost: totalCost, profit, margin, discount: wtc.discount || 0,
    laborCost: labor.subtotal, materialCost: matsCost, travelCost: trav,
  };
}

// calcBidStamp — the frozen bid breakdown stamped onto job_wtcs.bid_breakdown at
// Send-to-Schedule. A THIN shaper over ONE calcWtcBreakdown call plus raw WTC
// inputs; the PW rate swap and material-cost formula live in calcWtcBreakdown,
// once. Payload drops `discount` (never rendered by the cost layout) and keeps
// `price` (the roll-up margin needs Σprofit/Σprice). Versioned via `v`.
export function calcBidStamp(wtc, exact = false) {
  const bd = calcWtcBreakdown(wtc, exact);
  const rate   = wtc.prevailing_wage ? (wtc.pw_rate || 0)    : (wtc.burden_rate || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  return {
    v: 1,
    regular_hours: wtc.regular_hours || 0,
    ot_hours: wtc.ot_hours || 0,
    burden_rate: rate,          // effective (PW-swapped) rate — for the panel header
    ot_burden_rate: otRate,     // effective (PW-swapped) OT rate — for the panel header
    labor_cost: bd.laborCost,
    material_cost: bd.materialCost,
    travel_cost: bd.travelCost,
    total_cost: bd.cost,
    price: bd.price,
    profit: bd.profit,
    margin_pct: bd.margin,
    exact,
  };
}

export function calcWtcPrice(wtc, markup_override_pct, exact = false) {
  const rate = wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const effectiveMarkup = markup_override_pct != null
    ? Math.max(0, (wtc.markup_pct || 0) + markup_override_pct)
    : (wtc.markup_pct || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours,
    ot_hours: wtc.ot_hours,
    markup_pct: effectiveMarkup,
    burden_rate: rate,
    ot_burden_rate: otRate,
    size: wtc.size,
  });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const trav = calcTravel(wtc.travel);
  return roundPrice(labor.total + mats + trav - (wtc.discount || 0), exact);
}

export function calcProposalTotal(wtcs, markup_override_pct, exact = false) {
  return (wtcs || []).reduce((sum, w) => sum + calcWtcPrice(w, markup_override_pct, exact), 0);
}
