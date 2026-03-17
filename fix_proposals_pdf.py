
path = "src/pages/Proposals.jsx"
with open(path, "r") as f:
    src = f.read()

old2 = "    const trav = Object.values(wtc.travel || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);"
new2 = "    const trav = calcTravelLocal(wtc.travel || {});"

if old2 in src:
    src = src.replace(old2, new2, 1)
    print("travel calc fixed")
else:
    print("MISS: travel line not found")

insert_after = '''  return { regularCost, otCost, subtotal, markupAmt, total };
}'''

travel_fn = '''

function calcTravelLocal(t) {
  const drive    = (t.drive_rate || 0) * (t.drive_miles || 0);
  const fly      = (t.fly_rate || 0) * (t.fly_tickets || 0);
  const stay     = (t.stay_rate || 0) * (t.stay_nights || 0);
  const per_diem = (t.per_diem_rate || 0) * (t.per_diem_days || 0) * (t.per_diem_crew || 0);
  return drive + fly + stay + per_diem;
}'''

if insert_after in src and "calcTravelLocal" not in src:
    src = src.replace(insert_after, insert_after + travel_fn, 1)
    print("calcTravelLocal added")
elif "calcTravelLocal" in src:
    print("calcTravelLocal already present")
else:
    print("MISS: insert point not found")

with open(path, "w") as f:
    f.write(src)

print("done")
