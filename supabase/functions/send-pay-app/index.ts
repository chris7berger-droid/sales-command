import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];
const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];

// Audit C9 SSRF defense: only fetch PDF URLs that point at this Supabase
// project's public storage on one of the two known buckets. Caller-supplied
// URLs are dropped entirely (we re-derive from DB rows); this allowlist is
// defense-in-depth on the values we read back from the DB.
const SUPABASE_HOST = new URL(SUPABASE_URL).host;
const ALLOWED_STORAGE_BUCKETS = ["job-attachments", "signed-proposals"];
function isAllowedStorageUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    if (parsed.host !== SUPABASE_HOST) return false;
    return ALLOWED_STORAGE_BUCKETS.some(b =>
      parsed.pathname.startsWith(`/storage/v1/object/public/${b}/`)
    );
  } catch {
    return false;
  }
}

// Escape untrusted strings before interpolating into HTML
function escapeHtml(input: string): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Redact likely secrets from provider error bodies before returning to caller
function sanitizeProviderError(body: string): string {
  if (!body) return "Unknown email provider error";
  let out = body;
  // Redact anything that looks like a bearer token or API key
  out = out.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [redacted]");
  out = out.replace(/re_[A-Za-z0-9_\-]{10,}/g, "[redacted]");
  out = out.replace(/sk_[A-Za-z0-9_\-]{10,}/g, "[redacted]");
  out = out.replace(/pk_[A-Za-z0-9_\-]{10,}/g, "[redacted]");
  // Cap length so we don't dump huge payloads
  if (out.length > 500) out = out.slice(0, 500) + "…";
  return out;
}

// Convert ArrayBuffer to base64 string (for Resend attachments)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") || origin.startsWith("http://localhost");
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Capture the caller's Authorization header for fn→fn forwarding below
    // (qb-sync-invoice expects the user JWT, not service role). authenticateCaller
    // validates the same header internally; we hold it here for the downstream
    // fire-and-forget invoke at the end of the success path.
    const authHeader = req.headers.get("Authorization") || "";

    // Audit C9 — caller must be a real user in a tenant. recipientEmail / PDF
    // URLs / senderEmail are NO LONGER trusted from the body; we re-derive
    // them from the tenant-owned DB rows below.
    const caller = await authenticateCaller(supabase, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);
    if (caller.isServiceRole) return unauthorizedResponse(403, corsHeaders);

    const {
      payAppId,
      invoiceId,
      recipientEmail,  // typed override — soft-validated against tenant contact set below
      recipientName,
      subject,
      body,
    } = await req.json();

    console.log("send-pay-app invoked", { payAppId, invoiceId, recipientEmail });

    // ── Validate required fields ──────────────────────────────────────
    const missing: string[] = [];
    if (!payAppId) missing.push("payAppId");
    if (!invoiceId) missing.push("invoiceId");
    if (!recipientEmail) missing.push("recipientEmail");
    if (!subject) missing.push("subject");
    if (!body) missing.push("body");
    if (missing.length) {
      return new Response(JSON.stringify({ error: `Missing required field(s): ${missing.join(", ")}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // ── Load pay app + assert tenant + assert invoice linkage ─────────
    const { data: payAppRow, error: payAppErr } = await supabase
      .from("billing_schedule_pay_apps")
      .select("id, app_number, invoice_id, pdf_url, sov_pdf_url, release_waiver_url, tenant_id")
      .eq("id", payAppId)
      .maybeSingle();

    if (payAppErr || !payAppRow) {
      return new Response(JSON.stringify({ error: "Pay app not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }
    if (payAppRow.tenant_id !== caller.tenantId) return unauthorizedResponse(403, corsHeaders);
    // Same-tenant but unrelated pay app/invoice pairs must be rejected.
    if (payAppRow.invoice_id !== invoiceId) {
      return new Response(JSON.stringify({ error: "Pay app does not match invoice" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const appNumber = payAppRow.app_number ?? payAppId;

    // ── Load invoice + customer chain (proposal → call_log → customer) ──
    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select(`
        id, tenant_id, pdf_url,
        proposals(
          call_log_id,
          call_log(
            customer_id,
            customers(id, email, contact_email, billing_email)
          )
        )
      `)
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoiceRow) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }
    if (invoiceRow.tenant_id !== caller.tenantId) return unauthorizedResponse(403, corsHeaders);
    if (!invoiceRow.pdf_url) {
      return new Response(JSON.stringify({ error: "Invoice PDF has not been generated yet. Open the pay app and try again." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // ── Build allowed-recipient set (soft allowlist, audit C9) ────────
    // Tenant scope is implicit via the customer_id chain (pay app → schedule
    // → proposal → call_log → customer, all tenant-scoped). customer_contacts
    // has no tenant_id column; tenant scope comes via customers.tenant_id
    // through the FK we just traversed.
    const customer: any = (invoiceRow as any).proposals?.call_log?.customers || null;
    const customerId: string | null = (invoiceRow as any).proposals?.call_log?.customer_id || null;

    const norm = (s: any) => String(s || "").trim().toLowerCase();
    const allowedRecipients = new Set<string>();
    if (customer?.billing_email) allowedRecipients.add(norm(customer.billing_email));
    if (customer?.contact_email) allowedRecipients.add(norm(customer.contact_email));
    if (customer?.email)         allowedRecipients.add(norm(customer.email));
    if (customerId) {
      const { data: contacts } = await supabase
        .from("customer_contacts")
        .select("email")
        .eq("customer_id", customerId);
      for (const c of contacts || []) {
        if (c.email) allowedRecipients.add(norm(c.email));
      }
    }

    const requestedRecipient = norm(recipientEmail);
    if (!allowedRecipients.has(requestedRecipient)) {
      return new Response(JSON.stringify({
        error: "Recipient email must match a known contact for this customer.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    // Use the trimmed string form for the actual send. Casing is preserved
    // because email local-parts are technically case-sensitive per RFC, even
    // though most providers treat them as case-insensitive.
    const verifiedRecipient = String(recipientEmail).trim();

    // ── Resolve sender email from the caller's team_members row ───────
    // Replaces caller-supplied senderEmail (audit C9). The verified-domain
    // check below still applies for the Resend `From` header.
    const { data: senderRow } = await supabase
      .from("team_members")
      .select("email")
      .eq("auth_id", caller.userId)
      .maybeSingle();
    const senderEmail: string | null = senderRow?.email || null;

    // ── Validate DB-derived URLs against storage allowlist ────────────
    // Required: invoice.pdf_url. Optional (null/empty/missing OK): pay app PDF,
    // SOV PDF, release waiver. Per audit cleanup: do NOT silently drop a
    // present-but-invalid optional URL — surface it as 400 invalid_attachment_url
    // so a misconfigured row can't quietly send without the attachment the row
    // claimed to have.
    if (!isAllowedStorageUrl(invoiceRow.pdf_url)) {
      console.error("Invoice pdf_url failed storage allowlist:", invoiceRow.pdf_url);
      return new Response(JSON.stringify({ error: "Invoice PDF URL is not from an allowed storage bucket." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    const invoicePdfUrl = invoiceRow.pdf_url;

    // null / undefined / "" → no attachment (valid). Anything else must pass allowlist.
    function normalizeOptionalAttachment(u: any): string | null {
      if (u == null) return null;
      const t = String(u).trim();
      return t === "" ? null : t;
    }
    const payAppPdfUrl     = normalizeOptionalAttachment(payAppRow.pdf_url);
    const sovPdfUrl        = normalizeOptionalAttachment(payAppRow.sov_pdf_url);
    const releaseWaiverUrl = normalizeOptionalAttachment(payAppRow.release_waiver_url);
    const optionalAttachments: Array<[string, string | null]> = [
      ["pdf_url", payAppPdfUrl],
      ["sov_pdf_url", sovPdfUrl],
      ["release_waiver_url", releaseWaiverUrl],
    ];
    for (const [field, url] of optionalAttachments) {
      if (url !== null && !isAllowedStorageUrl(url)) {
        console.error(`Pay app ${field} failed storage allowlist:`, url);
        return new Response(JSON.stringify({
          error: "invalid_attachment_url",
          field: `pay_app.${field}`,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    // ── Fetch PDFs ────────────────────────────────────────────────────
    let payAppB64: string | null = null;
    let sovB64: string | null = null;
    let waiverB64: string | null = null;
    let invoiceBuf: ArrayBuffer;
    try {
      const invoiceRes = await fetch(invoicePdfUrl);
      if (!invoiceRes.ok) {
        console.error("Invoice PDF fetch status:", invoiceRes.status);
        return new Response(JSON.stringify({ error: "Failed to fetch invoice PDF" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        });
      }
      invoiceBuf = await invoiceRes.arrayBuffer();

      if (payAppPdfUrl) {
        const payAppRes = await fetch(payAppPdfUrl);
        if (payAppRes.ok) {
          payAppB64 = arrayBufferToBase64(await payAppRes.arrayBuffer());
        } else {
          console.warn("Pay app PDF fetch failed, sending without it:", payAppRes.status);
        }
      }

      if (sovPdfUrl) {
        const sovRes = await fetch(sovPdfUrl);
        if (sovRes.ok) {
          sovB64 = arrayBufferToBase64(await sovRes.arrayBuffer());
        } else {
          console.warn("SOV PDF fetch failed, sending without it:", sovRes.status);
        }
      }

      if (releaseWaiverUrl) {
        const waiverRes = await fetch(releaseWaiverUrl);
        if (waiverRes.ok) {
          waiverB64 = arrayBufferToBase64(await waiverRes.arrayBuffer());
        } else {
          console.warn("Release waiver fetch failed, sending without it:", waiverRes.status);
        }
      }
    } catch (e) {
      console.error("PDF fetch threw:", e.message);
      return new Response(JSON.stringify({ error: "Failed to fetch PDFs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
      });
    }

    const invoiceB64 = arrayBufferToBase64(invoiceBuf);

    // ── Build From address (verified domains only, same as send-proposal) ──
    const senderDomain = senderEmail ? senderEmail.split("@")[1]?.toLowerCase() : "";
    const fromAddress = senderEmail && VERIFIED_DOMAINS.includes(senderDomain)
      ? senderEmail
      : "noreply@salescommand.app";

    // ── Build HTML body — wrap each line in <p>, preserve paragraph breaks ──
    const htmlBody = String(body)
      .split(/\r?\n/)
      .map(line => line.trim().length ? `<p style="margin:0 0 12px 0;">${escapeHtml(line)}</p>` : "")
      .join("");

    const greetingName = recipientName ? escapeHtml(recipientName) : "";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
        <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
          <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
          <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
        </div>
        ${greetingName ? `<p>Hi ${greetingName},</p>` : ""}
        ${htmlBody}
        <p style="color: #887c6e; font-size: 12px; margin-top: 32px;">Questions? Reply to this email or call (775) 300-1900.</p>
      </div>
    `;

    // ── Send via Resend (same provider as send-invoice / send-proposal) ──
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        reply_to: senderEmail || undefined,
        to: verifiedRecipient,
        subject: subject,
        html: html,
        attachments: [
          ...(payAppB64 ? [{
            filename: `PayApp-${appNumber}.pdf`,
            content: payAppB64,
          }] : []),
          ...(sovB64 ? [{
            filename: `SOV-${appNumber}.pdf`,
            content: sovB64,
          }] : []),
          ...(waiverB64 ? [{
            filename: `ReleaseWaiver-${appNumber}.pdf`,
            content: waiverB64,
          }] : []),
          {
            filename: `Invoice-${invoiceId}.pdf`,
            content: invoiceB64,
          },
        ],
      }),
    });

    const emailResBody = await emailRes.text();
    console.log("Pay-app email response:", emailRes.status);

    if (!emailRes.ok) {
      const safeErr = sanitizeProviderError(emailResBody);
      return new Response(JSON.stringify({ error: `Failed to send email: ${safeErr}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    let emailId: string | null = null;
    try {
      const parsed = JSON.parse(emailResBody);
      emailId = parsed?.id || null;
    } catch {
      // Resend normally returns JSON; ignore parse failures
    }

    // ── Send confirmation to sender (fire-and-forget) ──────────────────
    // Only send when sender domain is in VERIFIED_DOMAINS so the From is
    // the sender's own address — Outlook/M365 routinely junk-folder a
    // noreply@salescommand.app → chris@hdspnv.com confirmation. Mirror
    // send-invoice's gating; if unverified, skip rather than fall back to
    // noreply (would re-trigger the junk-folder path we're fixing).
    if (senderEmail && VERIFIED_DOMAINS.includes(senderDomain)) {
      const attachmentList = [
        payAppB64 ? "Completed Pay App" : null,
        sovB64 ? "Schedule of Values" : null,
        waiverB64 ? "Release Waiver" : null,
        "Invoice #" + invoiceId,
      ].filter(Boolean);

      const confirmHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
          <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
            <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">Payment Application Sent</h2>
          </div>
          <p>Your payment application package was successfully sent to <b>${escapeHtml(recipientName || verifiedRecipient)}</b>${recipientName ? ` (${escapeHtml(verifiedRecipient)})` : ""}.</p>
          <p style="margin: 16px 0 8px; font-weight: 700; font-size: 14px;">Package Contents:</p>
          <ul style="margin: 0; padding-left: 20px;">
            ${attachmentList.map(a => `<li>${escapeHtml(a!)}</li>`).join("")}
          </ul>
          <p style="color: #887c6e; font-size: 12px; margin-top: 32px;">This is a confirmation from Sales Command. The recipient received the full package with all attachments.</p>
        </div>
      `;

      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: senderEmail,
          subject: `✓ Payment Application Package Sent — ${escapeHtml(recipientName || verifiedRecipient)}`,
          html: confirmHtml,
        }),
      })
        .then(async (r) => {
          console.log("Sender confirmation email:", r.status);
        })
        .catch((e) => {
          console.warn("Sender confirmation email failed (non-fatal):", e.message);
        });
    }

    // ── Mark pay app submitted (tenant-scoped defense-in-depth) ───────
    const nowIso = new Date().toISOString();
    const { error: payAppUpdErr } = await supabase
      .from("billing_schedule_pay_apps")
      .update({ status: "submitted", submitted_at: nowIso })
      .eq("id", payAppId)
      .eq("tenant_id", caller.tenantId);
    if (payAppUpdErr) {
      console.error("Pay-app status update failed (non-fatal):", payAppUpdErr.message);
    }

    // ── Mark invoice sent (tenant-scoped defense-in-depth) ────────────
    const { error: invUpdErr } = await supabase
      .from("invoices")
      .update({ status: "Sent", sent_at: nowIso })
      .eq("id", invoiceId)
      .eq("tenant_id", caller.tenantId);
    if (invUpdErr) {
      console.error("Invoice status update failed (non-fatal):", invUpdErr.message);
    }

    // ── Fire-and-forget QB sync (non-blocking, log only) ──────────────
    // Match send-invoice's pattern: do NOT await, ignore errors beyond logging.
    fetch(`${SUPABASE_URL}/functions/v1/qb-sync-invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({ invoiceId }),
    })
      .then(async (r) => {
        const txt = await r.text();
        console.log("qb-sync-invoice response:", r.status, txt.slice(0, 300));
      })
      .catch((e) => {
        console.warn("qb-sync-invoice invoke failed (non-fatal):", e.message);
      });

    return new Response(JSON.stringify({ success: true, email_id: emailId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("send-pay-app error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
