# Row Level Security (RLS) — Critical Rules

This project uses Supabase RLS to control database access. Get this wrong
and customer data leaks. Read carefully.

## The anti-pattern that caused incident 2026-04-26

Policies that grant anon access based only on a column being non-null:

    FOR SELECT TO anon
    USING (signing_token IS NOT NULL)

This is INSECURE. The publishable anon key ships in the browser bundle.
Anyone holding it can call PostgREST directly without the WHERE clause
the React app adds, and read every row where the column is non-null.

NEVER write a policy in this shape. The frontend filtering the query
client-side does NOT count as enforcement.

## The correct pattern for token-gated public access

Pass the token via a custom request header. Match it inside the policy:

    FOR SELECT TO anon
    USING (
      signing_token IS NOT NULL
      AND signing_token::text = public.request_signing_token()
    )

Helper functions request_signing_token() and request_viewing_token()
live in the database. They read 'x-signing-token' / 'x-viewing-token'
from current_setting('request.headers').

The frontend MUST use a Supabase client created via createPublicClient()
in src/lib/supabasePublic.js — that client pins the token in headers.
Never use the default supabase client for public/unauthenticated pages.

## The correct pattern for authenticated user access

Use auth.uid() to scope rows to the current user:

    FOR SELECT TO authenticated
    USING (tenant_id = public.get_user_tenant_id())

Or for user-owned rows directly:

    FOR SELECT TO authenticated
    USING (user_id = auth.uid())

Authenticated policies and anon policies coexist on the same table —
each role gets its own set.

## When this rule applies

Any time you write or modify SQL touching:
  - Files in supabase/migrations/ or sql/
  - Anything mentioning RLS, policies, anon access, public access, or
    token-gated reads
  - Any new public-facing page (signing, viewing, payment, etc.)

Before writing the policy: run /secure-rls (loads the full checklist).

## Deploy gates for any RLS or auth change

The 6-gate deploy pattern is non-negotiable. See:
  docs/runbooks/rls-deploy-gates.md

Skipping gates caused the 2026-04-26 incident. Do not skip gates.

## Cross-repo impact

Tables affected by RLS changes here:
  proposals, proposal_wtc, proposal_recipients, proposal_signatures,
  invoices, invoice_lines, call_log, customers, customer_contacts,
  team_members, tenant_config

These are SHARED with sch-command, field-command, AR-Command-Center.
Any policy change must be checked against those repos:

    cd ../sch-command && grep -rn "<table_name>" src/

If sibling repos query the same table as anon WITHOUT the new pattern,
they will break or remain vulnerable.
