// ── Shared WTC calculation helpers ──────────────────────────────────────
// Single source of truth. Used by WTCCalculator, Proposals, Invoices,
// and PublicSigningPage. Do NOT duplicate these in component files.

// ── Exact-penny pricing (§exact_penny_pricing plan) ─────────────────────
// Proposals whose pricing era is at/after noon Central 2026-06-26 bill to the
// exact penny (Math.round to cent). Everything created before keeps the legacy
// round-UP (Math.ceil). The era is `pricing_anchor_at ?? created_at`: normally
// created_at, but a multi-GC clone inherits its SOURCE's era via
// pricing_anchor_at so a clone never silently flips ceil↔exact.
export const EXACT_PRICING_CUTOFF = Date.parse("2026-06-26T12:00:00-05:00");

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
  return ts >= EXACT_PRICING_CUTOFF;
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
  return { price: totalPrice, cost: totalCost, profit, margin, discount: wtc.discount || 0 };
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
