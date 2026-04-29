-- Rollback: recreate the broad anon read policies if the drop needs to be reversed
-- Use only if get_public_tenant_config() / get_rep_contact() RPCs fail in production

CREATE POLICY "tenant_config_public_read" ON public.tenant_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "team_members_public_read" ON public.team_members
  FOR SELECT TO anon USING (active = true);
