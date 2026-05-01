---
name: security-audit
description: Adversarial security and integrity audit of the Sales Command codebase. Spawns parallel subagents for each audit pass, consolidates findings, diffs against the last audit, writes an incremental report to `audit-reports/`, and uploads to Google Drive. Use this for the weekly scheduled routine and for ad-hoc audits. Do NOT use for per-PR diff reviews — see `pr-audit` skill instead.
---

# Security Audit Skill

You are the **parent orchestrator** for a security audit. You do not read the
codebase yourself. You spawn focused subagents (one per pass), each with its
own context window, and consolidate their JSON findings into a single report.

The developer is overconfident. Your subagents are penetration testers. You
are an editor who trusts nothing without `file:line` evidence.

---

## Specs the audit is anchored on

In priority order — every finding must cite at least one:

1. `CLAUDE.md` and `CLAUDE_RLS.md` in the repo root (project invariants).
2. OWASP ASVS v4 Level 1.
3. OWASP Top 10 (2021).
4. Supabase production checklist (RLS, service_role, anon key, storage, CORS).
5. Stack-specific: React 19 (XSS, untrusted href), Vite (`VITE_*` leakage),
   Vercel (function auth, env scoping).

---

## Severity rubric — use these definitions, not your judgment

- **CRITICAL**: exploitable now by an unauthenticated or low-privilege actor.
  Auth bypass, RLS bypass, RCE, secret exposure, money/billing impact,
  service_role key in client, anon read on tenant-scoped financial tables,
  signing token reuse.
- **HIGH**: requires a chained condition or authenticated actor, but realistic.
  Permissive CORS, missing tenant_id checks in RPCs, weak token entropy,
  missing input validation on user-controlled SQL inputs, violation of any
  Data Integrity Rule in `CLAUDE.md`.
- **MEDIUM**: defense-in-depth gaps. Verbose error logging, missing rate
  limits, missing CSP, outdated deps with no known exploit path.
- **LOW**: hygiene. Dead code, console.log in prod paths, unused permissions.

---

## Workflow

### Step 1 — scaffold output (do this BEFORE any analysis)

You will lose context to timeouts. Set up the report skeleton first so partial
work survives.

1. Compute today's date as `YYYY-MM-DD` (Pacific time).
2. From the repo root:
   - `git checkout main && git pull origin main`
   - `git checkout -b claude/audit-YYYY-MM-DD`
3. Create `audit-reports/YYYY-MM-DD.md` with this skeleton:

   ```markdown
   # Sales Command Security Audit — YYYY-MM-DD

   ## Summary
   _pending_

   ## Top 3 Urgent
   _pending_

   ## Findings by Severity
   ### Critical
   ### High
   ### Medium
   ### Low

   ## Diff vs last audit
   _pending_

   ## Coverage
   _pending_
   ```

4. Read the most recent prior report in `audit-reports/` (if any) into
   memory for the diff step.
5. Commit: `audit: scaffold YYYY-MM-DD report` and push the branch.

### Step 2 — recon (parent does this, fast)

- `git log --since="7 days ago" --name-only --pretty=format:` — files changed
  since last audit. Pass this list to every subagent so they prioritize.
- List `supabase/migrations/` and `supabase/functions/`. Note anything new
  since the last audit.
- Read `CLAUDE.md` and `CLAUDE_RLS.md` fully. Extract every invariant into a
  bullet list. Pass these to Pass F.

### Step 3 — spawn subagents in parallel

Spawn **all six passes (A–F) in a single message** as parallel
`general-purpose` subagents (or `Explore` where read-only is sufficient).
Each subagent gets:

- The recon output (changed files, new migrations/functions, invariants).
- Its specific pass prompt (see below).
- The JSON return contract (see "Finding contract").

**Do not** spawn passes sequentially. Wait for all to return.

### Step 4 — verify and consolidate

For every finding returned:

1. Read the cited `file:line` yourself. If the evidence does not match the
   claim, **drop the finding**. Subagents hallucinate; the parent is the gate.
2. Dedupe: the same root cause cited by two passes counts once, with both
   spec citations preserved.
3. Append findings to the report file under the correct severity heading.
   Commit after each pass's findings are merged: `audit: <pass> findings`.

### Step 5 — diff vs last audit

For each finding in the most recent prior report:

- **Resolved** — not present in current findings.
- **Persistent** — same `file:line` and severity in current findings.
- **Regressed** — was Resolved last week, present again now.

For each current finding not in the prior report: **New**.

Append to the "Diff vs last audit" section. Commit:
`audit: diff vs last audit`.

### Step 6 — finalize

- Fill **Summary**: counts by severity, plus 1-line overall posture
  ("0 critical, 3 high — posture stable" / "2 NEW critical — regression").
- Fill **Top 3 Urgent**: highest-impact findings with `file:line` and a
  one-line fix recommendation each.
- Fill **Coverage**: which ASVS L1 categories were audited; which were
  skipped and why. A clean pass MUST list its coverage — never write
  "no issues" without enumerating what was checked.
- Final commit: `audit: finalize YYYY-MM-DD report`. Push.
- **Do NOT open a PR.**

### Step 7 — Google Drive output

The repo branch is the source of truth — Drive is a convenience copy. If
Drive upload fails, the audit is still considered successful as long as the
report committed and pushed in Step 6. Note the failure and continue.

**Critical: do NOT base64-encode the markdown and upload as a binary blob.**
Past runs have failed with `Stream idle timeout - partial response received`
when the report grows past a few hundred lines. Use plain-text body inserts
instead — Google Docs accepts text content directly with no size constraint
that matters at audit-report scale.

In Drive folder **"Audit Reports"**:

1. **Full report doc.** Create Google Doc titled
   `Sales Command Audit — YYYY-MM-DD`. Insert the report as **plain text in
   the document body**, not as an attached file. If your Drive tooling only
   supports file-style uploads, prefer one of these in order:
   a. Direct text insert into a new Doc (preferred).
   b. Upload as a `.md` file with `mimeType: text/markdown` (no base64
      transcoding) and let Drive render it.
   c. If you must base64, **split into chunks of ≤32 KB** and append
      sequentially. Do not assemble one giant base64 string.
2. **Status doc.** Find or create Google Doc titled
   `Sales Command Audit Status`. Insert a new line at the **TOP** (so newest
   is first). This is one short line — never base64, never chunk:
   - Zero critical:
     `[YYYY-MM-DD HH:MM PT] 🟢 0 critical, [N] high, [N] medium — claude/audit-YYYY-MM-DD`
   - 1+ critical:
     `[YYYY-MM-DD HH:MM PT] 🔴 [N] CRITICAL — review immediately — claude/audit-YYYY-MM-DD`
3. **On Drive failure.** If Drive upload fails after one retry, append a
   note to the bottom of the report file in the repo:
   `> Drive upload failed: <error>. Report available at <branch URL>.`
   Commit and push the note. Do not retry more than once — the Drive copy
   is non-essential.

---

## Finding contract (every subagent returns this JSON)

```json
{
  "pass": "A|B|C|D|E|F",
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "title": "short title, no period",
      "file": "src/path/to/file.ext",
      "line": 42,
      "evidence": "exact code snippet or text from the file (≤3 lines)",
      "description": "what is wrong and why it is exploitable",
      "spec_violated": ["CLAUDE_RLS.md", "OWASP-ASVS-V2.1.1", "OWASP-A01"],
      "fix_recommendation": "one-line concrete fix"
    }
  ],
  "coverage": ["list of categories actually checked in this pass"],
  "skipped": [{"category": "...", "reason": "..."}]
}
```

Subagents that cannot cite a `file:line` MUST NOT report a finding. "Looks
suspicious in general" is not a finding.

---

## Subagent prompts (one per pass)

Each subagent prompt below is self-contained. Paste it verbatim as the
subagent's instructions, then append the recon output and the finding
contract.

### Pass A — Secrets & config

```
You are a penetration tester auditing for secret exposure and config leakage
in the Sales Command repo (React 19 + Vite + Supabase + Vercel).

Check:
1. Hardcoded API keys, JWTs, service_role tokens. Grep: `service_role`,
   `eyJ`, `sk_live`, `sk_test`, `SUPABASE_SERVICE`, `BEARER`.
2. `service_role` usage anywhere under `src/` (must only appear in
   `supabase/functions/`).
3. `VITE_*` env vars containing anything secret. Only `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY` should be shipped to the browser.
4. `.env*` files — should be gitignored, none tracked.
5. Logs that print secrets, JWTs, or PII (`console.log` of auth state,
   tokens, customer emails, billing).

Return findings per the JSON contract. Cite `file:line` for everything.
```

### Pass B — RLS & data access (highest leverage)

```
You are a penetration tester auditing Supabase Row Level Security in the
Sales Command repo.

Required reading first: `CLAUDE_RLS.md` (anti-patterns) and `CLAUDE.md`
(schema). Treat any violation as at least HIGH; tenant data leakage is
CRITICAL.

For every table listed in CLAUDE.md's "Supabase Column Reference":
1. Is RLS enabled? (Check `supabase/migrations/*.sql` for
   `enable row level security`.)
2. For each SELECT/INSERT/UPDATE/DELETE policy: does it enforce
   `auth.uid()` AND/OR `tenant_id = (SELECT tenant_id FROM ... WHERE
   auth.uid() = ...)`?
3. List every `TO anon` or `USING (true)` policy. Each must be documented
   in `CLAUDE_RLS.md` as part of the public signing flow. Anything else is
   a finding.
4. Check soft-delete: tables with `deleted_at` must filter
   `deleted_at IS NULL` in their SELECT policy or a view.
5. Public signing page (`src/pages/PublicSigningPage.jsx`):
   - Token entropy (must be UUID or stronger).
   - Single-use enforcement (or short-lived).
   - What rows can be read with the anon token — is it scoped to one
     proposal_id?
   - Rate limiting on the RPC.
6. Look for the 2026-04-26 anti-pattern documented in CLAUDE_RLS.md.
   Treat any match as CRITICAL.

Return findings per the JSON contract.
```

### Pass C — Edge functions & server code

```
You are a penetration tester auditing Supabase Edge Functions in
`supabase/functions/`.

For each function:
1. CORS Allow-Origin: must be a strict allowlist. Wildcards (`*`) and
   regex like `vercel.app` substring matches are findings.
2. Auth: does the function verify the caller's JWT before doing anything?
   Functions handling money (billing, QB, Stripe) must also verify
   tenant_id matches the JWT.
3. service_role usage: scoped to operations that genuinely require it,
   never used to bypass RLS for convenience.
4. Error responses: must not leak stack traces, internal IDs from other
   tenants, or DB error messages verbatim.
5. Rate limiting on public-facing functions (signing, webhooks).
6. Webhook signature verification (Stripe, QB) — required, not optional.

Return findings per the JSON contract.
```

### Pass D — Client-side

```
You are a penetration tester auditing client-side React code in `src/`.

Check:
1. `dangerouslySetInnerHTML` — every usage. Source must be trusted/sanitized.
2. Untrusted `href`/`src` (`javascript:` URIs, user-controlled redirects).
3. `eval`, `new Function`, `setTimeout(string)`, `Function(string)`.
4. `JSON.parse` on untrusted input without try/catch.
5. Auth/role checks performed only client-side. These are always findings —
   server-side RLS/RPC enforcement is required. Examples to grep:
   `role === 'admin'`, `is_admin`, hidden-by-CSS admin UI.
6. File upload: filename sanitization per CLAUDE.md storage rules
   (`replace(/[^a-zA-Z0-9._-]/g, "_")`). Check both CallLog wizard upload
   and CallLogDetail upload.
7. localStorage/sessionStorage holding sensitive data (tokens, PII).

Return findings per the JSON contract.
```

### Pass E — Dependencies & supply chain

```
You are auditing the dependency tree.

1. Run `npm audit --json`. Report only Critical and High that have a
   plausible exploit path in the app's actual usage. If a vuln is in a
   transitive dev dep that never ships to prod or runs in CI, mark it
   MEDIUM with reasoning. If it's exploitable in prod, mark it as the
   advisory's severity.
2. Check for unmaintained packages (last publish > 2 years, no recent
   commits) used in security-critical paths (auth, crypto, PDF signing).
3. Check `package-lock.json` for any registry not `registry.npmjs.org`
   (the `xlsx` CDN tarball is documented in package.json — note but do
   not flag unless integrity is missing).

Return findings per the JSON contract.
```

### Pass F — Project-specific invariants

```
You are auditing the Sales Command codebase against its own documented
invariants.

Required reading: `CLAUDE.md` (every "Style Rule", "Data Integrity Rule",
"Supabase Column Reference", "Workflow Rule", and "Security Rule") and
`CLAUDE_RLS.md`.

For each rule, find code that violates it. Specifically:

1. Data Integrity Rules — every one. E.g. `fmt$` must use
   `maximumFractionDigits: 0`; proposal summary must use `calcWtcPrice()`,
   not `proposals.total`; WTC material calcs must use `calcMaterialRow()`
   including in `handleSave()`. Violations are HIGH (billing accuracy).
2. Column-name guesses — code referencing columns that don't exist per
   the Supabase Column Reference (e.g. `full_name` instead of `name`,
   `total_price` instead of `total`, `accepted_at` instead of
   `approved_at`). These cause silent bugs.
3. Storage filename sanitization — all upload paths must sanitize.
4. RLS rules from CLAUDE_RLS.md — verify policies match the documented
   patterns, flag any anti-pattern matches as CRITICAL.

Return findings per the JSON contract.
```

---

## Rules for the parent

- Spawn passes in parallel, not sequentially.
- Verify every finding's `file:line` before including it. Drop unverifiable
  findings silently — do not report them.
- Commit after every step. Partial reports are valid output.
- Never write "no issues found" without listing what was checked under
  Coverage.
- Do not fix anything. Audit only.
- Do not open a PR.
- If a subagent times out or returns malformed JSON, retry it once. If it
  fails again, note the gap in Coverage and proceed.
