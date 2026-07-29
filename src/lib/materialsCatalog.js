import { supabase } from "./supabase";

// Text spec columns on materials_catalog (Phase-1 migration 20260714120000).
// coverage + kit_size already existed; both are freshness-bearing (a coverage-rate
// correction is DMS-1 §2's floor-failure scenario), so they count as "specs" for the
// stamp decision below.
const SPEC_COLS = ["coverage", "kit_size", "mils", "mix_time", "mix_speed", "cure_time", "unit"];

const trimOrNull = v => (v == null ? null : (String(v).trim() || null));

// Build the persisted column set from the editor's field values.
function toClean(values) {
  return {
    name:      String(values.name || "").trim(),
    kit_size:  trimOrNull(values.kit_size),
    price:     parseFloat(values.price) || 0,
    coverage:  trimOrNull(values.coverage),
    supplier:  trimOrNull(values.supplier),
    mils:      trimOrNull(values.mils),
    mix_time:  trimOrNull(values.mix_time),
    mix_speed: trimOrNull(values.mix_speed),
    cure_time: trimOrNull(values.cure_time),
    unit:      trimOrNull(values.unit),
  };
}

async function resolveTenantId(override) {
  if (override) return override;
  const { data: tc } = await supabase.from("tenant_config").select("id").single();
  if (!tc?.id) throw new Error("Could not resolve tenant");
  return tc.id;
}

// Single write path for BOTH catalog editors (WTCCalculator MaterialsTab + Settings).
// Handles three cases from one call:
//   • brand-new material (original null / original.isNew) → INSERT tenant row
//   • editing a system-default row (original.tenant_id == null) → FORK: RLS makes a
//     system-row UPDATE a silent 0-row no-op, so INSERT a tenant copy instead. The
//     (tenant, lower(name), lower(kit_size)) dedupe then shadows the default in every
//     picker (Phase-0 §4.1 [C1], amendment A1).
//   • editing an existing tenant row → UPDATE (the DB trigger stamps specs_updated_at).
//
// INSERT-stamp contract [D1] (build-amendment A2 — the trigger stamps on UPDATE ONLY):
// every INSERT/fork path sets specs_updated_at by hand — now() when a spec was typed,
// the source row's value when forking on a price-only edit (never now() on inherited
// data). Surfaces the silent-RLS-no-op as a real error; re-throws 23505 so callers can
// show "already in your catalog".
export async function saveCatalogRow({ original = null, values, tenantId } = {}) {
  const clean = toClean(values);
  if (!clean.name) throw new Error("Material name is required");

  const isNew   = !original || original.isNew;
  const isFork  = !isNew && original.tenant_id == null;

  if (isNew) {
    const tid = await resolveTenantId(tenantId);
    // New material → typed data, stamp now() when it carries any spec, else null.
    const typed = SPEC_COLS.some(k => clean[k] != null);
    const { data, error } = await supabase.from("materials_catalog")
      .insert({ ...clean, tenant_id: tid, active: true, specs_updated_at: typed ? new Date().toISOString() : null })
      .select("id");
    if (error) throw error;
    return { mode: "insert", id: data?.[0]?.id };
  }

  if (isFork) {
    const tid = await resolveTenantId(tenantId);
    // Typed iff any spec column differs from the system default being forked from.
    const specsTyped = SPEC_COLS.some(k => (clean[k] ?? null) !== (original[k] ?? null));
    const { data, error } = await supabase.from("materials_catalog")
      .insert({ ...clean, tenant_id: tid, active: true, specs_updated_at: specsTyped ? new Date().toISOString() : (original.specs_updated_at ?? null) })
      .select("id");
    if (error) throw error;
    return { mode: "fork", id: data?.[0]?.id };
  }

  // Existing tenant row → UPDATE; the UPDATE trigger stamps specs_updated_at on change.
  const { data, error } = await supabase.from("materials_catalog")
    .update(clean).eq("id", original.id).select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    // RLS filtered the write to 0 rows with no error — surface it instead of the
    // silent no-op that made "enter specs once" quietly fail on system rows.
    throw new Error("No rows updated — you may not have permission to edit this material.");
  }
  return { mode: "update", id: original.id };
}

// Friendly message for the unique-index collision (23505) the fork can hit.
export function catalogErrorMessage(e) {
  if (e?.code === "23505") return "That material is already in your catalog.";
  return e?.message || String(e);
}
