// §4.3 Ship-time backfill: re-lock the existing unlocked-committed WTC population.
//
// WHY THIS EXISTS (lock-at-sold, docs/plans/lock_at_sold_enforcement.md §4.3):
//   The sign door (mark_proposal_signed RPC) stays ungated in this build, so any
//   Sent/Signed proposal that still carries unlocked WTCs could walk through it and
//   recreate the 10019 incident state (Sold + unlocked + stale SOV). This script
//   re-locks every unlocked WTC on a committed proposal and snapshots its
//   locked_line_total, closing that door by eliminating the reachable population.
//
// SEQUENCING (round-2 A — NON-NEGOTIABLE):
//   Run this BEFORE the UI deploy goes live. Gate: after --apply, the §0 count query
//   must return 0, THEN promote the build. The Sent/Signed rows hold live signing
//   tokens; running after deploy leaves a window where a customer signature recreates
//   the incident. Backfill first, always. Executed at the DEPLOY GATE (buildvsplan →
//   deploy terminal), NOT by the build session.
//
// MATH PARITY (round-2 B):
//   Reuses src/lib/calc.js — the single source of truth — and byte-matches what
//   handleLock / toggleWtcLock write: pricing-era columns per proposal drive
//   usesExactPricing(); markup_override_pct is passed undefined (never the sister's
//   proposal-level override).
//
// WRITES (Chris-ratified X + full disclosure):
//   Per selected WTC: locked = true, locked_line_total = <computed>.
//   Per proposal: proposals.total is recomputed ONLY for Sent rows (matching what a
//   lock in the app would do). Sold and Signed rows keep their existing total — a
//   signed contract's number is immutable, and skipping the write avoids mass-firing
//   trg_sync_job_amount across the sold jobs. The trigger fires only for Sent rows.
//
// RUN PROTOCOL (bf-2):
//   1. Dry run (no flag): prints per-proposal era flag + per-WTC computed totals,
//      and writes an updated_at snapshot to scripts/.backfill_relock_snapshot.json.
//   2. Human review.
//   3. Live run (--apply), back-to-back: reloads the snapshot and asserts every
//      target WTC's updated_at is unchanged since the dry run (catches an edit landing
//      between runs — the trigger side effects are never exercised in dry-run, so
//      parity depends on nothing moving). Then writes.
//
// AUTH (established backfill pattern — memory: service_role Bearer fails for context):
//   Authenticated as Chris's admin user via GoTrue, so RLS, tenant context, and any
//   trigger reading auth.uid() resolve correctly.
//
// Run:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   BACKFILL_ADMIN_EMAIL=<chris admin email> \
//   BACKFILL_ADMIN_PASSWORD=<password> \
//   node scripts/backfill_relock_committed_wtcs.mjs [--apply]

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { calcWtcPrice, calcProposalTotal, usesExactPricing } from "../src/lib/calc.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.BACKFILL_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.BACKFILL_ADMIN_PASSWORD;
const APPLY = process.argv.includes("--apply");

const COMMITTED = ["Sent", "Signed", "Sold"];
const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, ".backfill_relock_snapshot.json");

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("ERROR: SUPABASE_URL, SUPABASE_ANON_KEY, BACKFILL_ADMIN_EMAIL, BACKFILL_ADMIN_PASSWORD must be set.");
  process.exit(1);
}

console.log(`Mode: ${APPLY ? "APPLY (writes will happen)" : "DRY RUN (use --apply to write)"}`);

// ── Mint a user JWT via GoTrue (Chris's admin user) ─────────────────────────
const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({
  email: ADMIN_EMAIL,
  password: ADMIN_PASSWORD,
});
if (signInErr || !signIn?.session?.access_token) {
  console.error("ERROR: admin sign-in failed:", signInErr?.message || "no session");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
});
console.log(`Authenticated as ${ADMIN_EMAIL}.`);

// ── Selection (bf-1): per-WTC WHERE ─────────────────────────────────────────
// proposal_wtc.locked = false, joined (!inner) to proposals with
// status IN ('Sent','Signed','Sold') AND deleted_at IS NULL — so a partially-locked
// proposal contributes only its unlocked rows. Page past the 1000-row limit.
const PAGE = 1000;
let from = 0;
const targets = [];
while (true) {
  const { data, error } = await supabase
    .from("proposal_wtc")
    .select("*, proposals!inner(id, status, deleted_at, is_archive_proposal, created_at, pricing_anchor_at)")
    .eq("locked", false)
    .in("proposals.status", COMMITTED)
    .is("proposals.deleted_at", null)
    .order("id", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error("Query failed:", error); process.exit(1); }
  if (!data || data.length === 0) break;
  targets.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}

// ── Archive assert-zero ─────────────────────────────────────────────────────
// Archive proposals have no WTCs, so this should never select any. Assert it.
const archiveRows = targets.filter(w => w.proposals?.is_archive_proposal);
if (archiveRows.length > 0) {
  console.error(`ABORT: selected ${archiveRows.length} WTC(s) on archive proposals — must be zero.`);
  console.error(archiveRows.map(w => `  wtc ${w.id} (proposal ${w.proposals?.id})`).join("\n"));
  process.exit(1);
}

if (targets.length === 0) {
  console.log("No unlocked WTCs on committed proposals. Nothing to backfill. Done.");
  process.exit(0);
}

// ── Compute per-WTC locked_line_total + resolve era per proposal ────────────
const byStatus = { Sent: 0, Signed: 0, Sold: 0 };
const computed = []; // { id, proposal_id, status, exact, locked_line_total, updated_at }
for (const wtc of targets) {
  const proposal = wtc.proposals;
  const exact = usesExactPricing(proposal); // era columns → exact vs legacy ceil
  const total = calcWtcPrice(wtc, undefined, exact); // markup_override_pct = undefined
  if (!Number.isFinite(total)) {
    console.error(`ABORT: calcWtcPrice returned ${total} for wtc ${wtc.id} — refusing to write a bad snapshot.`);
    process.exit(1);
  }
  byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
  computed.push({
    id: wtc.id,
    proposal_id: proposal.id,
    status: proposal.status,
    exact,
    locked_line_total: total,
    updated_at: wtc.updated_at,
  });
}

// ── Dry-run print (bf: per proposal era flag + per-WTC computed totals) ──────
console.log(`\nSelected ${targets.length} unlocked WTC(s) on committed proposals: ` +
  `${byStatus.Sent} Sent / ${byStatus.Signed} Signed / ${byStatus.Sold} Sold.`);
const byProposal = new Map();
for (const c of computed) {
  if (!byProposal.has(c.proposal_id)) byProposal.set(c.proposal_id, []);
  byProposal.get(c.proposal_id).push(c);
}
for (const [pid, rows] of byProposal) {
  console.log(`\n  proposal ${pid} [${rows[0].status}] exactPricing=${rows[0].exact}`);
  for (const r of rows) console.log(`    wtc ${r.id} → locked_line_total $${r.locked_line_total.toFixed(2)}`);
}

if (!APPLY) {
  const snapshot = Object.fromEntries(computed.map(c => [c.id, c.updated_at]));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\nDry run complete. Wrote updated_at snapshot for ${computed.length} rows to ${SNAPSHOT_PATH}.`);
  console.log("Review the above, then re-run with --apply (back-to-back) to write.");
  process.exit(0);
}

// ── Live run: updated_at parity assert (bf-2) ───────────────────────────────
if (!existsSync(SNAPSHOT_PATH)) {
  console.error(`ABORT: no dry-run snapshot at ${SNAPSHOT_PATH}. Run the dry run first, review, then --apply.`);
  process.exit(1);
}
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
const snapIds = new Set(Object.keys(snapshot));
const nowIds = new Set(computed.map(c => String(c.id)));
// Target set must be identical to the dry run's.
const added = [...nowIds].filter(id => !snapIds.has(id));
const removed = [...snapIds].filter(id => !nowIds.has(id));
if (added.length || removed.length) {
  console.error("ABORT: target set changed since the dry run.");
  if (added.length) console.error(`  new WTCs not in snapshot: ${added.join(", ")}`);
  if (removed.length) console.error(`  snapshot WTCs no longer selected: ${removed.join(", ")}`);
  process.exit(1);
}
// Each target's updated_at must be unchanged since the snapshot.
const moved = computed.filter(c => snapshot[c.id] !== c.updated_at);
if (moved.length > 0) {
  console.error("ABORT: these WTCs were edited between the dry run and now (updated_at moved):");
  console.error(moved.map(c => `  wtc ${c.id}: ${snapshot[c.id]} → ${c.updated_at}`).join("\n"));
  console.error("Re-run the dry run to capture a fresh snapshot before applying.");
  process.exit(1);
}

// ── Writes ──────────────────────────────────────────────────────────────────
let written = 0, failed = 0;
for (const c of computed) {
  const { error } = await supabase
    .from("proposal_wtc")
    .update({ locked: true, locked_line_total: c.locked_line_total })
    .eq("id", c.id);
  if (error) { console.error(`FAILED wtc ${c.id}:`, error.message); failed += 1; }
  else written += 1;
}
console.log(`\nWTC re-lock complete. Written: ${written}. Failed: ${failed}.`);

// ── proposals.total recompute — Sent rows ONLY ──────────────────────────────
// Sold/Signed totals stay untouched (immutable contract; avoids mass-firing
// trg_sync_job_amount). Recompute from ALL of the proposal's WTCs, matching a lock.
let totalsWritten = 0;
for (const [pid, rows] of byProposal) {
  if (rows[0].status !== "Sent") continue;
  const exact = rows[0].exact;
  const { data: allWtcs, error: fErr } = await supabase.from("proposal_wtc").select("*").eq("proposal_id", pid);
  if (fErr) { console.error(`FAILED refetch for proposal ${pid}:`, fErr.message); failed += 1; continue; }
  const proposalTotal = calcProposalTotal(allWtcs, undefined, exact); // excludes rate cards (F44)
  const { error: uErr } = await supabase.from("proposals").update({ total: proposalTotal }).eq("id", pid);
  if (uErr) { console.error(`FAILED total update for proposal ${pid}:`, uErr.message); failed += 1; }
  else { totalsWritten += 1; console.log(`  proposal ${pid} [Sent] total → $${proposalTotal.toFixed(2)}`); }
}
console.log(`\nSent-only proposals.total recomputed: ${totalsWritten}. (Sold/Signed totals untouched.)`);
console.log(`\nBackfill complete. WTC writes: ${written}, total writes: ${totalsWritten}, failures: ${failed}.`);
console.log("Next: run the §0 count query — it must return 0 before promoting the UI deploy.");
process.exit(failed > 0 ? 1 : 0);
