#!/usr/bin/env node
/**
 * GUARD RAIL — public page anon-column grants
 * ===========================================
 *
 * WHAT THIS PROTECTS
 * The customer-facing pages (salescommand.app/invoice/:token) run as the
 * anonymous Postgres role. If such a page's .select() names a column that the
 * `anon` role is NOT granted, Postgres returns 42501 "permission denied", the
 * page's read throws, and the customer sees a generic "Invoice not found" — a
 * SILENT, TOTAL outage of every link. It has bitten us three times:
 *   - Jun 2026: viewing_token_expires_at / call_log_id ungranted
 *   - Aug 2026: sent_at added to the select, never granted
 * The anon grant is a deliberate allow-list (it hides the stripe / qb pay-link
 * secrets — the #SEC1 boundary), so EVERY new column a public page selects must
 * be granted, or the whole page breaks.
 *
 * WHAT THIS CHECK DOES
 * Parses each `.from(table).select(...)` issued through the public/anon client
 * (createPublicClient) and compares the columns it names against the anon
 * column grants read live from the database. Any selected column anon cannot
 * read is a hard failure, with instructions on how to honor the guard.
 *
 * It reads the LIVE anon grants (not the migration files) because the grant
 * history includes REVOKE-all-then-regrant and a column-level-revoke no-op
 * trap that make static computation unreliable. The live grant table is the
 * one true answer.
 *
 * Run: npm run check:public-grants   (also runs from the pre-push hook)
 * Requires: this repo linked to Supabase (`supabase link`) so it can read grants.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// Public pages that query tables directly through the anon client. (Pages that
// only go through RPCs — e.g. PublicSigningPage — are immune: an RPC is
// SECURITY DEFINER and returns a fixed shape, so column grants don't apply.)
const PUBLIC_PAGES = ["src/pages/PublicInvoicePage.jsx"];

const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

// ─── 1. Extract every (table, [columns]) the public client selects ──────────

/**
 * Pull the full select-argument string out of a `.select( ... )` call starting
 * at `startIdx` (index of the char after "select("). Walks characters tracking
 * whether we're inside a string literal, concatenating the CONTENTS of adjacent
 * string literals (so `"a, " + "b"` becomes `a, b`), and stops at the first `)`
 * that is not inside a string literal. Returns { text, endIdx } or null.
 */
function extractSelectArg(src, startIdx) {
  let i = startIdx, out = "", inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }          // skip escaped char
      if (c === inStr) { inStr = null; continue; } // close string
      out += c;
    } else {
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === ")") return { text: out, endIdx: i }; // end of select(...)
      // whitespace / + concatenation between literals — ignore
    }
  }
  return null;
}

/** Split a PostgREST select list on top-level commas (depth 0 w.r.t. parens). */
function splitTopLevel(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const c of s) {
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Given a select list belonging to `table`, collect (table, column) pairs for
 * plain columns, and recurse one level into `embed(cols)` forms (the embed name
 * is treated as the related table). Anything we can't confidently classify
 * (functions, hints, aliases) is recorded as `unverified` and never fails.
 */
function collectRefs(table, selectList, refs, unverified) {
  for (const raw of splitTopLevel(selectList)) {
    const tok = raw.trim();
    if (!tok || tok === "*") continue;
    const embed = tok.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (embed) {
      collectRefs(embed[1], embed[2], refs, unverified); // related table
      continue;
    }
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tok)) {
      refs.push({ table, column: tok });
    } else {
      unverified.push(`${table}: ${tok}`); // e.g. renamed:col, fn(...), json->>
    }
  }
}

function scanPage(relPath) {
  const src = readFileSync(join(REPO, relPath), "utf8");
  const refs = [], unverified = [];
  // Find each `.from("table")` and pair it with the NEXT `.select(` after it.
  const fromRe = /\.from\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    const table = m[1];
    const selIdx = src.indexOf(".select(", m.index);
    if (selIdx === -1) continue;
    const arg = extractSelectArg(src, selIdx + ".select(".length);
    if (!arg) continue;
    collectRefs(table, arg.text, refs, unverified);
  }
  return { refs, unverified };
}

// ─── 2. Read live anon column grants from the DB ────────────────────────────

function fetchAnonGrants(tables) {
  const list = tables.map((t) => `'${t}'`).join(", ");
  const sql =
    `SELECT table_name, column_name FROM information_schema.role_column_grants ` +
    `WHERE grantee='anon' AND privilege_type='SELECT' AND table_schema='public' ` +
    `AND table_name IN (${list});`;
  let out;
  try {
    out = execSync(`supabase db query --linked ${JSON.stringify(sql)}`, {
      cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return { ok: false, error: (e.stderr || e.stdout || e.message || "").toString().trim() };
  }
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  let rows;
  try { rows = JSON.parse(json).rows; } catch { return { ok: false, error: "could not parse db output" }; }
  const grants = {}; // table -> Set(columns)
  for (const r of rows) (grants[r.table_name] ??= new Set()).add(r.column_name);
  return { ok: true, grants };
}

// ─── 3. Diff and report ─────────────────────────────────────────────────────

function fail(missing) {
  const lines = missing.map((x) => `    ${x.page}  →  ${x.table}.${x.column}`).join("\n");
  console.error(`
${RED}${BOLD}🛑 GUARD RAIL: public invoice page selects a column 'anon' can't read${OFF}

A customer-facing page's anonymous query names column(s) that the 'anon'
database role is NOT granted. Shipping this breaks EVERY link the page serves:

${RED}${lines}${OFF}

${BOLD}WHY THIS GUARD EXISTS${OFF}
The public invoice page (salescommand.app/invoice/:token) runs as 'anon'. If it
selects a column anon can't read, Postgres returns "permission denied" and the
customer sees "Invoice not found" — a silent, total outage of every link. This
exact bug has shipped three times. The anon grant is an allow-list on purpose:
it hides the stripe_*/qb_* pay-link secrets (#SEC1).

${BOLD}HOW TO HONOR IT${OFF} (do NOT delete the guard, and do NOT bypass the push)
For each column above, decide:

  • Customer does NOT need to see it →  remove it from the .select() in the page.

  • Customer DOES need to see it →  grant it to anon with a migration in the DB repo:

      1. cd ../command-suite-db
      2. create supabase/migrations/<UTC-timestamp>_anon_<table>_grant_<col>.sql :

           GRANT SELECT (<column>) ON public.<table> TO anon;
           NOTIFY pgrst, 'reload schema';

         ${YEL}⚠  Grant ONLY non-sensitive columns. NEVER grant stripe_*/qb_*/
            stripe_checkout_url — those are the pay-link secrets the allow-list
            exists to hide (#SEC1).${OFF}
      3. npm run db:push   (from command-suite-db)

Then re-run this check — it reads grants live and passes the moment the grant is
applied. This is not a block on the column; it's a block on shipping the column
BEFORE its grant is live.
`);
}

function main() {
  let allRefs = [], allUnverified = [];
  for (const page of PUBLIC_PAGES) {
    const { refs, unverified } = scanPage(page);
    allRefs.push(...refs.map((r) => ({ ...r, page })));
    allUnverified.push(...unverified.map((u) => `${page}  ${u}`));
  }

  const tables = [...new Set(allRefs.map((r) => r.table))];
  if (tables.length === 0) { console.log(`${GRN}✓${OFF} No public-client table selects found.`); return; }

  const res = fetchAnonGrants(tables);
  if (!res.ok) {
    // Can't verify — never a silent pass, never a hard dead-end. Explain the
    // two ways forward.
    console.error(`
${YEL}${BOLD}⚠ GUARD RAIL could not verify anon column grants${OFF}
${res.error.split("\n").slice(0, 3).map((l) => "  " + l).join("\n")}

This check reads live grants from Supabase and needs the repo linked.
Two ways forward:
  • Recommended:  ${BOLD}supabase link${OFF} , then push again (the guard runs and confirms).
  • If you're certain no public-page column changed:  push with ${BOLD}git push --no-verify${OFF}.
`);
    process.exit(2);
  }

  const missing = allRefs.filter((r) => !(res.grants[r.table]?.has(r.column)));
  if (missing.length) { fail(missing); process.exit(1); }

  console.log(`${GRN}✓${OFF} Guard rail passed — all ${allRefs.length} public-selected columns across ${tables.length} table(s) are granted to anon.`);
  if (allUnverified.length) {
    console.log(`${YEL}note${OFF} — not auto-verified (check by hand if you changed these): ${allUnverified.join("; ")}`);
  }
}

main();
