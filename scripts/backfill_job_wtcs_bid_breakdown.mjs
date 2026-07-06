// One-shot backfill for job_wtcs.bid_breakdown (Budget tab, Loop #40).
//
// Run ONCE after migration 20260706120000_job_wtcs_bid_breakdown deploys.
//
// Why this exists:
//   New sends stamp bid_breakdown at Send-to-Schedule (ProposalDetail.jsx
//   handleSendToSchedule). Rows sent BEFORE that change have NULL, so their
//   Budget tab reads empty. This fills them from the SAME canonical math.
//   Re-sends never re-stamp (job_wtcs upsert ignoreDuplicates), so this backfill
//   is load-bearing for every existing row — get it right once.
//
// Why a JS script and not SQL:
//   The breakdown is computed by calcBidStamp() -> calcWtcBreakdown() in
//   src/lib/calc.js (markup-on-cost, two material sums, prevailing-wage rate
//   swap, era-dependent rounding). Raw SQL cannot reproduce that without
//   forking the logic into a permanent drift surface. This imports the
//   canonical calc directly.
//
// Volume is expected to be small, but the read below PAGINATES anyway: this runs
// with the service-role key, which bypasses RLS and therefore reads job_wtcs
// across EVERY tenant on the shared Command Suite DB — the NULL-breakdown
// population is not bounded by one tenant's send count. A plain fetch would hit
// PostgREST's 1000-row cap and silently stamp only the first 1000 by id; because
// re-sends never re-stamp, the remainder would be stranded NULL forever.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   node scripts/backfill_job_wtcs_bid_breakdown.mjs
//
//   Add --apply to write. Without it this is a DRY RUN: it prints every
//   computed row so you can sanity-check before writing.
//
//   Eyeball note: the printed numbers are recomputed from the CURRENT
//   proposal_wtc. Compare them to the ARCHIVED signed proposal PDF (the true
//   frozen bid) — NOT to the live ProposalDetail:1209 view, which recomputes
//   from the same proposal_wtc and so can never reveal drift. Drift can only
//   occur if a WTC was edited after its send; WTCs lock at approval and, once
//   the pull-back/re-send lock-integrity gap is closed (sales-command backlog
//   F40), cannot be edited while a Schedule job exists — so for stamped rows
//   the recompute equals the signed bid.

import { createClient } from "@supabase/supabase-js";
import { calcBidStamp, usesExactPricing } from "../src/lib/calc.js";

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

// Only rows not yet stamped. bid_breakdown is nullable (legacy default).
// Page past the 1000-row cap (see header note) so a large population is never
// silently truncated.
const PAGE = 1000;
const jobWtcs = [];
for (let from = 0; ; from += PAGE) {
  const { data: page, error: jwErr } = await supabase
    .from("job_wtcs")
    .select("id, job_id, proposal_wtc_id, work_type_name")
    .is("bid_breakdown", null)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (jwErr) {
    console.error("Query job_wtcs failed:", jwErr);
    process.exit(1);
  }
  if (!page || page.length === 0) break;
  jobWtcs.push(...page);
  if (page.length < PAGE) break;
}

console.log(`Found ${jobWtcs.length} job_wtcs rows with NULL bid_breakdown.`);
if (jobWtcs.length === 0) {
  console.log("Nothing to backfill. Done.");
  process.exit(0);
}

const toUpdate = [];
let skipped = 0;

for (const jw of jobWtcs) {
  // Full proposal_wtc row (the same select("*") shape the send path uses at
  // ProposalDetail.jsx:569), plus the proposal's pricing-era columns.
  const { data: pw, error: pwErr } = await supabase
    .from("proposal_wtc")
    .select("*, proposals(created_at, pricing_anchor_at)")
    .eq("id", jw.proposal_wtc_id)
    .single();

  if (pwErr || !pw) {
    console.warn(`SKIP job_wtc ${jw.id}: proposal_wtc ${jw.proposal_wtc_id} not found (${pwErr?.message || "no row"}).`);
    skipped += 1;
    continue;
  }

  const proposal = pw.proposals || null;

  // BLOCKING correctness: created_at is the coalesced era base
  // (usesExactPricing reads pricing_anchor_at ?? created_at). A missing base
  // silently defaults to legacy ceil in Node (the dev-warn is dead), baking a
  // wrong price into a FROZEN row. Gate on created_at — NEVER on
  // pricing_anchor_at, which is NULL for every non-clone proposal (gating on it
  // would strand every normal proposal, Budget empty forever).
  if (!proposal?.created_at) {
    console.warn(`SKIP job_wtc ${jw.id}: proposal ${pw.proposal_id} has NULL created_at — cannot determine pricing era. NOT stamping.`);
    skipped += 1;
    continue;
  }

  const exact = usesExactPricing(proposal); // reads pricing_anchor_at ?? created_at
  const stamp = calcBidStamp(pw, exact);
  toUpdate.push({ id: jw.id, work_type_name: jw.work_type_name, stamp });
}

console.log(`\nComputed breakdowns for ${toUpdate.length} rows; skipped ${skipped}.`);
if (skipped > 0) {
  console.warn(
    `\n⚠️  ACTION REQUIRED: ${skipped} row(s) were SKIPPED (see SKIP lines above) and ` +
    `remain NULL. They will NOT get a Budget breakdown from this run, and re-sends ` +
    `never re-stamp — resolve each before treating this backfill as complete. ` +
    `This run will exit non-zero because of them.`
  );
}
console.log("Eyeball each against the ARCHIVED signed proposal PDF (not the live recompute — see header):");
for (const row of toUpdate) {
  const s = row.stamp;
  console.log(
    `  job_wtc ${row.id} (${row.work_type_name || "?"}): ` +
    `price=$${s.price.toFixed(2)} cost=$${s.total_cost.toFixed(2)} ` +
    `profit=$${s.profit.toFixed(2)} margin=${s.margin_pct.toFixed(1)}% exact=${s.exact} ` +
    `[labor=$${s.labor_cost.toFixed(2)} mats=$${s.material_cost.toFixed(2)} travel=$${s.travel_cost.toFixed(2)}]`
  );
}

if (toUpdate.length === 0) {
  console.log("\nNothing to write. Done.");
  // Skips still mean unstamped rows were left behind — never exit clean on them.
  process.exit(skipped > 0 ? 1 : 0);
}

if (!APPLY) {
  console.log("\nDry run complete. Verify each row above, then re-run with --apply to write.");
  process.exit(0);
}

// Small volume → update one at a time for precise error reporting.
let written = 0;
let failed = 0;
for (const row of toUpdate) {
  const { error } = await supabase
    .from("job_wtcs")
    .update({ bid_breakdown: row.stamp })
    .eq("id", row.id);
  if (error) {
    console.error(`FAILED job_wtc ${row.id}:`, error.message);
    failed += 1;
  } else {
    written += 1;
  }
}

console.log(`\nBackfill complete. Written: ${written}. Failed: ${failed}. Skipped: ${skipped}.`);
// Non-zero on failures OR skips: a skipped row is an unstamped row, and it must
// never be mistaken for a completed backfill.
process.exit(failed > 0 || skipped > 0 ? 1 : 0);
