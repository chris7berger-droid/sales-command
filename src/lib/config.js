import { supabase } from "./supabase";

const DEFAULTS = {
  company_name: "", tagline: "", license_number: "", phone: "", email: "",
  website: "", address: "", city: "", state: "", zip: "", logo_url: "/hdsp-logo.png",
  default_burden_rate: 56.50, default_ot_burden_rate: 84.75, default_tax_rate: 8.25,
  default_billing_terms: 30, proposal_validity_days: 90,
  default_proposal_intro: "Thank you for the opportunity to provide this proposal. We are pleased to present the following scope of work and pricing for your review.",
  default_invoice_description: "Thank you for your business. Please find the details of this invoice below. Payment is due by the date listed above.",
  monthly_billing_goal: 450000, yearly_billing_goal: 5400000,
  conversion_rate_goal: 50, proposals_sent_goal: 30,
  stripe_customer_id: null, stripe_subscription_id: null,
  subscription_status: null, subscription_started_at: null,
  // Schedule runway (Home → Follow-Up Zone 2). Unset on day one — a DB null
  // overrides these DEFAULTS via {...DEFAULTS, ...data}, so the unset-state
  // guard lives in RunwayBar, not here (plan E1).
  schedule_runway_weeks: null, schedule_runway_note: "", schedule_runway_updated_at: null,
};

let _cache = null;

// The tenant_config SELECT policy is `id = get_user_tenant_id()` for the
// `authenticated` role only, so a pre-auth call (Login.jsx mounts and asks for
// the company name before sign-in) legitimately comes back empty. Caching that
// empty result poisoned every later consumer for the rest of the session —
// blank company name/address/phone on the invoice + proposal headers, with the
// logo falling back to the bundled default. Only a real row gets cached.
export async function getTenantConfig() {
  if (_cache) return _cache;
  const { data } = await supabase.from("tenant_config").select("*").limit(1).single();
  if (!data) return { ...DEFAULTS };
  _cache = { ...DEFAULTS, ...data };
  return _cache;
}

// Signing in changes who the RLS policy sees, so anything read as anon is stale
// by definition. Drop the cache on every auth transition.
supabase.auth.onAuthStateChange(() => { _cache = null; });

export async function refreshTenantConfig() {
  _cache = null;
  return getTenantConfig();
}

export async function updateTenantConfig(partial) {
  const current = await getTenantConfig();
  // Row-count-verify (P1): the tenant_config UPDATE policy is Admin/Manager-only,
  // and an RLS-blocked update returns NO error and NO rows — checking `error`
  // alone would report a silent no-op as success ("Saved" but nothing saved).
  const { data, error } = await supabase
    .from("tenant_config").update(partial).eq("id", current.id).select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Save was blocked — no rows updated. You may not have permission to change settings.");
  }
  return refreshTenantConfig();
}

export { DEFAULTS };
