// ── Shared WTC calculation helpers ──────────────────────────────────────
// Single source of truth. Used by WTCCalculator, Proposals, Invoices,
// and PublicSigningPage. Do NOT duplicate these in component files.

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

export function calcWtcBreakdown(wtc) {
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
  const totalPrice = labor.total + mats + trav - (wtc.discount || 0);
  const totalCost = labor.subtotal + matsCost + trav;
  const profit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;
  return { price: totalPrice, cost: totalCost, profit, margin };
}

export function calcWtcPrice(wtc) {
  const rate = wtc.prevailing_wage ? (wtc.pw_rate || 0) : (wtc.burden_rate || 0);
  const otRate = wtc.prevailing_wage ? (wtc.pw_ot_rate || 0) : (wtc.ot_burden_rate || 0);
  const labor = calcLabor({
    regular_hours: wtc.regular_hours,
    ot_hours: wtc.ot_hours,
    markup_pct: wtc.markup_pct,
    burden_rate: rate,
    ot_burden_rate: otRate,
    size: wtc.size,
  });
  const mats = (wtc.materials || []).reduce((s, i) => s + calcMaterialRow(i), 0);
  const trav = calcTravel(wtc.travel);
  return labor.total + mats + trav - (wtc.discount || 0);
}
