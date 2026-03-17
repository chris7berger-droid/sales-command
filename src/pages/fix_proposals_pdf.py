cat > fix_proposals_pdf.py << 'ENDOFSCRIPT'
import re

path = "src/pages/Proposals.jsx"
with open(path, "r") as f:
    src = f.read()

old = '''function calcMaterialRowLocal(item) {
  const price = parseFloat(item.price_per_unit) || 0;
  const qty   = parseFloat(item.qty) || 0;
  const base  = price * qty;
  const tax   = base * ((parseFloat(item.tax) || 0) / 100);
  const freight = parseFloat(item.freight) || 0;
  const subtotal = base + tax + freight;
  const markup = subtotal * ((parseFloat(item.markup_pct) || 0) / 100);
  return subtotal + markup;
}

function calcLaborLocal({ regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate }) {
  const regularCost = (regular_hours || 0) * (burden_rate || 0);
  const otCost = (ot_hours || 0) * (ot_burden_rate || 0);
  const subtotal = regularCost + otCost;
  const markupAmt = subtotal * ((markup_pct || 0) / 100);
  const total = subtotal + markupAmt;
  return { regularCost, otCost, subtotal, markupAmt, total };
}'''

new = '''function calcMaterialRowLocal(item) {
  const price = parseFloat(item.price_per_unit) || 0;
  const qty   = parseFloat(item.qty) || 0;
  const base  = price * qty;
  const tax   = base * ((parseFloat(item.tax) || 0) / 100);
  const freight = parseFloat(item.freight) || 0;
  const subtotal = base + tax + freight;
  const markup = subtotal * ((parseFloat(item.markup_pct) || 0) / 100);
  return subtotal + markup;
}

function calcLaborLocal({ regular_hours, ot_hours, markup_pct, burden_rate, ot_burden_rate }) {
  const regularCost = (regular_hours || 0) * (burden_rate || 0);
  const otCost = (ot_hours || 0) * (ot_burden_rate || 0);
  const subtotal = regularCost + otCost;
  const markupAmt = subtotal * ((markup_pct || 0) / 100);
  const total = subtotal + markupAmt;
  return { regularCost, otCost, subtotal, markupAmt, total };
}

function calcTravelLocal(t) {
  const drive    = (t.drive_rate || 0) * (t.drive_miles || 0);
  const fly      = (t.fly_rate || 0) * (t.fly_tickets || 0);
  const stay     = (t.stay_rate || 0) * (t.stay_nights || 0);
  const per_diem = (t.per_diem_rate || 0) * (t.per_diem_days || 0) * (t.per_diem_crew || 0);
  return drive + fly + stay + per_diem;
}'''

if old in src:
    src = src.replace(old, new, 1)
    print("calcTravelLocal added")
else:
    print("MISS: calcMaterialRowLocal block not found")

old2 = "    const trav = Object.values(wtc.travel || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);"
new2 = "    const trav = calcTravelLocal(wtc.travel || {});"

if old2 in src:
    src = src.replace(old2, new2, 1)
    print("travel calc fixed")
else:
    print("MISS: travel reducer line not found")

with open(path, "w") as f:
    f.write(src)

print("File written — step 1 done")
ENDOFSCRIPT