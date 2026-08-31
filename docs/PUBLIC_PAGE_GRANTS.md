# Guard rail: public-page anon column grants

## The bug this prevents

The customer-facing pages — today `salescommand.app/invoice/:token`
(`src/pages/PublicInvoicePage.jsx`) — run as the **anonymous** Postgres role
through `createPublicClient`. The `anon` role has a deliberate **allow-list** of
readable columns on `invoices` (and related tables): it hides the
`stripe_*` / `qb_*` pay-link secrets so a link holder can't read them from the
Network tab (the #SEC1 boundary).

Because it's an allow-list, **any column a public page adds to its `.select()`
must also be granted to `anon`**, or Postgres returns `42501 permission denied`,
the page's read throws, and the customer sees a generic **"Invoice not found."**
It's a silent, total outage of every link — nothing logs, nothing 500s.

This exact class has shipped three times:

| When | What was ungranted |
|------|--------------------|
| Jun 2026 | `viewing_token_expires_at`, `call_log_id` (hotfix `20260629104507`) |
| Aug 2026 | `sent_at` — added to the select, never granted (hotfix `20260831120000`) |

## The guard

`scripts/check-public-select-grants.mjs` parses every `.from(table).select(...)`
issued through the public client and compares the columns it names against the
**live** anon grants (read from `information_schema.role_column_grants`). Live
grants — not the migration files — because the grant history includes a
REVOKE-all-then-regrant and the documented column-revoke no-op trap, which make
static computation unreliable.

- **Runs automatically** from the `pre-push` hook, but only when a public page is
  in the push (so ordinary pushes never touch the DB).
- **Run it by hand:** `npm run check:public-grants`
- **Install the hook (once per clone):** `npm run install-hooks`

Pages that only use RPCs (e.g. `PublicSigningPage.jsx`) are immune — an RPC is
`SECURITY DEFINER` with a fixed return shape, so column grants don't apply. Only
direct table selects through the anon client are checked.

## What to do when it fires

The failure message says it all, but in short — for each flagged column:

- **Customer doesn't need to see it** → remove it from the `.select()`.
- **Customer needs to see it** → grant it, in the DB repo:
  ```sql
  -- command-suite-db/supabase/migrations/<UTC-ts>_anon_<table>_grant_<col>.sql
  GRANT SELECT (<column>) ON public.<table> TO anon;
  NOTIFY pgrst, 'reload schema';
  ```
  then `npm run db:push` from `command-suite-db`.
  **Never** grant `stripe_*` / `qb_*` / `stripe_checkout_url` — those are the
  secrets the allow-list exists to hide.

The guard reads grants live, so it passes the moment the grant is applied. It
doesn't forbid the column; it forbids shipping the column *before* its grant.

## If it can't verify

The check needs the repo linked to Supabase (`supabase link`) to read grants.
If it can't connect it does **not** silently pass and does **not** dead-end you —
it tells you to either `supabase link` and push again, or, if you're certain no
public-page column changed, `git push --no-verify`.
