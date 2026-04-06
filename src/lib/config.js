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
};

let _cache = null;

export async function getTenantConfig() {
  if (_cache) return _cache;
  const { data } = await supabase.from("tenant_config").select("*").limit(1).single();
  _cache = { ...DEFAULTS, ...data };
  return _cache;
}

export async function refreshTenantConfig() {
  _cache = null;
  return getTenantConfig();
}

export async function updateTenantConfig(partial) {
  const current = await getTenantConfig();
  const { error } = await supabase.from("tenant_config").update(partial).eq("id", current.id);
  if (error) throw error;
  return refreshTenantConfig();
}

export { DEFAULTS };
