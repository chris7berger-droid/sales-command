-- Migration: drop broad anon read policies on tenant_config and team_members
-- Only apply AFTER verifying RPCs work end-to-end on production
-- Audit items: High #3 (tenant_config_public_read) and High #4 (team_members_public_read)

DROP POLICY IF EXISTS "tenant_config_public_read" ON public.tenant_config;
DROP POLICY IF EXISTS "team_members_public_read"  ON public.team_members;
