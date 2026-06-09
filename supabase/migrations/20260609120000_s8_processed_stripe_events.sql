-- S8 (T1 security remediation, Loop #33) — Stripe webhook idempotency.
--
-- Both stripe-webhook and scc-stripe-webhook lack event.id dedupe (audit C5/C6).
-- Stripe delivers at-least-once, so a replayed checkout.session.completed /
-- subscription event re-runs invoice→Paid, qb-record-payment, receipts, or
-- re-nulls a subscription. This table is the dedupe ledger.
--
-- Two-phase protocol (the webhooks implement claimed → done):
--   - CLAIM: INSERT status='claimed' before any side effect. PK conflict (23505)
--     means the event was seen before.
--       * existing status='done'  → genuine duplicate → return 200, do nothing.
--       * existing status='claimed'→ a prior attempt did not finish (crash /
--         in-flight concurrent delivery) → RE-PROCESS (Stripe's retry is correct).
--   - DONE: UPDATE status='done' immediately before EVERY 2xx return.
--   - On any 4xx/5xx the row stays 'claimed' so Stripe's retry can re-process.
--
-- IMPORTANT: tenant_id is NULLABLE, has NO default, and is left NULL.
-- The event_id PRIMARY KEY is the sole dedupe mechanism. Do NOT give tenant_id a
-- `DEFAULT get_user_tenant_id()` — get_user_tenant_id() returns NULL under the
-- service-role context the webhooks run in, which (with NOT NULL) would make
-- every claim INSERT fail and idempotency would never engage.

CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id   text PRIMARY KEY,                       -- Stripe event.id — dedupe key
  event_type text,
  source     text NOT NULL,                          -- 'stripe-webhook' | 'scc-stripe-webhook'
  status     text NOT NULL DEFAULT 'claimed',        -- 'claimed' (in-flight) | 'done' (fully processed)
  tenant_id  uuid REFERENCES public.tenant_config(id),  -- nullable, left NULL; PK is the dedupe mechanism
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()       -- handler sets this explicitly on the claimed→done update
);

ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- DECORATIVE policy: the service role (the only reader/writer here) bypasses RLS.
-- Kept for project convention. This is the correct authenticated-access pattern
-- (tenant-scoped USING) per CLAUDE_RLS.md — NOT the 2026-04-26 anon USING(true)
-- anti-pattern (no anon role is touched). Since tenant_id is always NULL, this
-- policy matches no rows for authenticated callers, which is intended: only the
-- webhooks (service role) ever touch this table.
DROP POLICY IF EXISTS processed_stripe_events_select ON public.processed_stripe_events;
CREATE POLICY processed_stripe_events_select ON public.processed_stripe_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- No authenticated INSERT/UPDATE/DELETE policies: only the webhooks (service role) write here.
