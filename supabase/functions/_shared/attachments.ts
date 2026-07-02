// Shared attachment helpers for the send fns (extracted per plan §4.4 Finding D;
// precedent: _shared/recipientAllowlist.ts). send-invoice imports both to fetch
// and Resend-encode the persisted invoice_attachments for an invoice.
//
// SSRF defense (audit C9 lineage): we only ever fetch storage URLs that point at
// THIS Supabase project's public storage, on the ONE allowed bucket, AND under
// the specific invoice's attachment prefix. Even a valid-bucket URL belonging to
// a different invoice or tenant is rejected — the caller never supplies these
// URLs (they're re-derived from DB rows), so this is defense-in-depth on the
// values read back from the DB.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_HOST = new URL(SUPABASE_URL).host;

// Invoice attachments live ONLY in the job-attachments bucket under an
// invoice-attachments/{invoiceId}/ prefix. signed-proposals is intentionally
// NOT allowed here (invoice attachments never live there — plan §4.4 Finding D).
const ALLOWED_STORAGE_BUCKETS = ["job-attachments"];

export function isAllowedStorageUrl(
  u: string | null | undefined,
  invoiceId: string,
): boolean {
  if (!u || !invoiceId) return false;
  try {
    const parsed = new URL(u);
    if (parsed.host !== SUPABASE_HOST) return false;
    // Pin to the one bucket AND this invoice's own attachment prefix, so a
    // valid-bucket URL from another invoice/tenant can't reach the fetch.
    return ALLOWED_STORAGE_BUCKETS.some((b) =>
      parsed.pathname.startsWith(
        `/storage/v1/object/public/${b}/invoice-attachments/${invoiceId}/`,
      )
    );
  } catch {
    return false;
  }
}

// Convert ArrayBuffer to base64 string (for Resend attachments). Chunked to
// avoid blowing the call stack on String.fromCharCode(...bigArray).
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
