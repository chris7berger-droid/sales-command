-- Migration: add SECURITY DEFINER RPCs for public pages
-- These replace direct anon SELECT on tenant_config and team_members
-- Audit items: High #3 (tenant_config_public_read) and High #4 (team_members_public_read)

-- Returns only safe branding/display fields from tenant_config
CREATE OR REPLACE FUNCTION public.get_public_tenant_config()
RETURNS TABLE (
  company_name text,
  tagline text,
  logo_url text,
  phone text,
  email text,
  website text,
  license_number text,
  proposal_validity_days int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_name, tagline, logo_url, phone, email, website,
         license_number, proposal_validity_days
  FROM public.tenant_config
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_config() FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_config() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_config() TO authenticated;

-- Returns a single rep's contact info by name
CREATE OR REPLACE FUNCTION public.get_rep_contact(rep_name text)
RETURNS TABLE (name text, email text, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tm.name, tm.email, tm.phone
  FROM public.team_members tm
  WHERE tm.name = rep_name
    AND tm.active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_rep_contact(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_rep_contact(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_rep_contact(text) TO authenticated;
