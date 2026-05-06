// One-shot backfill for proposal_wtc.locked_line_total (audit H6).
//
// Run ONCE after migration 20260505190200 deploys to prod.
//
// Why this exists:
//   The H6 RPC reads locked_line_total to give the public signing page
//   per-WTC totals without exposing cost basis. handleLock() in
//   ProposalDetail.jsx now writes locked_line_total going forward,
//   but rows locked BEFORE that change have NULL.
//
// Why a JS script and not a SQL migration:
//   The total is computed by calcWtcPrice() in src/lib/calc.js — the
//   single source of truth for proposal pricing logic in this app.
//   A SQL recompute would mirror the JS bit-for-bit and become a
//   silent-drift surface forever (per CLAUDE.md fmt$/calcMaterialRow
//   quirks). This script imports the canonical calc directly.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   node scripts/backfill_locked_line_total.mjs
//
//   Add --apply to actually write. Without it the script does a
//   dry run and prints what it would change.

import { createClient } from "@supabase/supabase-js";
import { calcWtcPrice } from "../src/lib/calc.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log(`Mode: ${APPLY ? "APPLY (writes will happen)" : "DRY RUN (use --apply to write)"}`);

// Fetch all locked WTC rows whose locked_line_total is still NULL.
// Page through to bypass the 1000-row default limit.
const PAGE = 1000;
let from = 0;
let scanned = 0;
let toUpdate = [];

while (true) {
  const { data, error } = await supabase
    .from("proposal_wtc")
    .select("*")
    .eq("locked", true)
    .is("locked_line_total", null)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);

  if (error) {
    console.error("Query failed:", error);
    process.exit(1);
  }

  if (!data || data.length === 0) break;

  scanned += data.length;
  for (const wtc of data) {
    const computed = calcWtcPrice(wtc);
    if (Number.isFinite(computed)) {
      toUpdate.push({ id: wtc.id, locked_line_total: computed });
    } else {
      console.warn(`Skipping wtc ${wtc.id}: calcWtcPrice returned ${computed}`);
    }
  }

  if (data.length < PAGE) break;
  from += PAGE;
}

console.log(`Scanned ${scanned} locked WTCs with NULL locked_line_total.`);
console.log(`Computed totals for ${toUpdate.length} rows.`);

if (toUpdate.length === 0) {
  console.log("Nothing to backfill. Done.");
  process.exit(0);
}

// Print a sample so a human can sanity-check before --apply.
const sample = toUpdate.slice(0, 5);
console.log("Sample (first 5):");
for (const row of sample) {
  console.log(`  wtc ${row.id} → $${row.locked_line_total.toFixed(2)}`);
}

if (!APPLY) {
  console.log("\nDry run complete. Re-run with --apply to write.");
  process.exit(0);
}

// Update one at a time to keep error reporting precise. Volume is
// small (one tenant's locked-proposal history) — batching isn't
// worth the lost diagnostics.
let written = 0;
let failed = 0;
for (const row of toUpdate) {
  const { error } = await supabase
    .from("proposal_wtc")
    .update({ locked_line_total: row.locked_line_total })
    .eq("id", row.id);
  if (error) {
    console.error(`FAILED wtc ${row.id}:`, error.message);
    failed += 1;
  } else {
    written += 1;
  }
}

console.log(`\nBackfill complete. Written: ${written}. Failed: ${failed}.`);
process.exit(failed > 0 ? 1 : 0);
