// Soft contact allowlist (audit C9 anti-injection) for the send fns.
//
// The C9 control admits a recipient only if its email matches a known contact
// for the customer — the customer record's own emails ∪ the customer's
// customer_contacts. This blocks a low-privilege caller from body-injecting an
// arbitrary address to exfiltrate an invoice/pay-app PDF. It is intentionally
// SOFT: any contact added through the UI is written to customer_contacts first,
// so UI-added recipients auto-pass.
//
// Extracted here (T5 #9) so send-invoice and (when its half of F30 lands)
// send-pay-app share ONE implementation — a future fix to the injection gate
// can't silently miss one of them.
//
// Returns:
//   allowed        — Set of normalized allowed emails (the C9 gate).
//   liveEmailById  — Map of customer_contact_id → its CURRENT email, used to
//                    resolve a linked recipient to its live email at send time
//                    (T5 #1). A linked recipient's stored contact_email is a
//                    snapshot that goes stale when the contact is edited on the
//                    Customers page; resolving live keeps a still-valid contact
//                    sendable instead of hard-failing the allowlist.

export const normEmail = (s: any) => String(s || "").trim().toLowerCase();

export async function buildContactAllowlist(
  supabase: any,
  customer: any,
  customerId: string | null,
): Promise<{ allowed: Set<string>; liveEmailById: Map<string, string> }> {
  const allowed = new Set<string>();
  const liveEmailById = new Map<string, string>();

  if (customer?.billing_email) allowed.add(normEmail(customer.billing_email));
  if (customer?.contact_email) allowed.add(normEmail(customer.contact_email));
  if (customer?.email) allowed.add(normEmail(customer.email));

  if (customerId) {
    const { data: contacts } = await supabase
      .from("customer_contacts")
      .select("id, email")
      .eq("customer_id", customerId);
    for (const c of contacts || []) {
      if (c.email) {
        allowed.add(normEmail(c.email));
        if (c.id) liveEmailById.set(c.id, c.email);
      }
    }
  }

  return { allowed, liveEmailById };
}
