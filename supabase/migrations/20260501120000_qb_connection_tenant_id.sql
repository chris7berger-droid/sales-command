-- Adds tenant_id to qb_connection so the QuickBooks OAuth connection can be
-- scoped per tenant. Audit finding C4 (2026-04-30): qb-auth previously
-- wiped ALL qb_connection rows globally on every exchange, and refresh/status
-- read .limit(1).maybeSingle() returning whichever tenant happened to come
-- back first. Without a tenant_id column, no per-tenant policy is possible.
--
-- Backfill: the existing single-tenant deploy has at most one row, so we
-- attach it to the first tenant_config. If there are multiple qb_connection
-- rows or zero tenant_config rows, the backfill leaves tenant_id null and
-- the deploy must be repaired manually before qb-auth will accept the row.

alter table public.qb_connection
  add column if not exists tenant_id uuid references public.tenant_config(id) on delete cascade;

-- Backfill: only safe when there's a single tenant. If multiple tenants
-- exist, leave tenant_id null and surface via the index below.
do $$
declare
  tenant_count int;
  conn_count int;
  the_tenant uuid;
begin
  select count(*) into tenant_count from public.tenant_config;
  select count(*) into conn_count from public.qb_connection where tenant_id is null;

  if tenant_count = 1 and conn_count > 0 then
    select id into the_tenant from public.tenant_config limit 1;
    update public.qb_connection set tenant_id = the_tenant where tenant_id is null;
  end if;
end $$;

-- One QB connection per tenant.
create unique index if not exists qb_connection_tenant_id_unique
  on public.qb_connection(tenant_id)
  where tenant_id is not null;

-- Enable RLS so cross-tenant reads via PostgREST are blocked even if the
-- service role key is compromised in a downstream context. Edge functions
-- continue to use the service role key (which bypasses RLS), but they MUST
-- now scope queries by tenant_id explicitly — see qb-auth, qb-record-payment,
-- qb-sync-invoice, qb-void-invoice.
alter table public.qb_connection enable row level security;

-- Authenticated users can read their own tenant's QB connection metadata
-- (used by the Settings UI to show connected/disconnected state).
drop policy if exists qb_connection_select on public.qb_connection;
create policy qb_connection_select on public.qb_connection
  for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

-- Writes are reserved for the qb-auth edge function (service role) — no
-- direct INSERT/UPDATE/DELETE from PostgREST. Intentionally no
-- authenticated-role write policy.
