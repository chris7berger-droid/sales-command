// Work-type selection rule (2026-08-04)
//
// Pickers offer tenant-owned work types only. The system-default rows
// (tenant_id IS NULL) are the seeded catalog — they carry no SOW, and reps
// picking them was how the near-duplicate names got created in the first place.
// The rows stay in the database so historical jobs, proposals and WTCs keep
// resolving their names; they just stop being selectable.
//
// keepIds is the escape hatch: any default already tagged on the record being
// edited stays in the list, so an existing selection is never silently dropped.
// Filter bars over historical data deliberately do NOT use this — they need the
// full catalog to filter old records.
export function selectableWorkTypes(all, keepIds = []) {
  const keep = new Set((keepIds || []).filter(id => id != null).map(String));
  return (all || [])
    .filter(wt => wt.tenant_id || keep.has(String(wt.id)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
