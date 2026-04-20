import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];
const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];

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

    // Verify caller is authenticated (same pattern as send-invoice)
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const {
      payAppId,
      invoiceId,
      recipientEmail,
      recipientName,
      subject,
      body,
      payAppPdfUrl,
      invoicePdfUrl,
      senderEmail,
    } = await req.json();

    console.log("send-pay-app invoked", { payAppId, invoiceId, recipientEmail, hasPayAppPdf: !!payAppPdfUrl, hasInvoicePdf: !!invoicePdfUrl });

    // ── Validate required fields ──────────────────────────────────────
    const missing: string[] = [];
    if (!payAppId) missing.push("payAppId");
    if (!invoiceId) missing.push("invoiceId");
    if (!recipientEmail) missing.push("recipientEmail");
    if (!subject) missing.push("subject");
    if (!body) missing.push("body");
    if (!payAppPdfUrl) missing.push("payAppPdfUrl");
    if (!invoicePdfUrl) missing.push("invoicePdfUrl");
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

    // ── Look up app_number for attachment filename ────────────────────
    const { data: payAppRow, error: payAppErr } = await supabase
      .from("billing_schedule_pay_apps")
      .select("app_number")
      .eq("id", payAppId)
      .maybeSingle();

    if (payAppErr) {
      console.error("Failed to fetch pay app row:", payAppErr.message);
    }
    const appNumber = payAppRow?.app_number ?? payAppId;

    // ── Fetch both PDFs in parallel ───────────────────────────────────
    let payAppBuf: ArrayBuffer;
    let invoiceBuf: ArrayBuffer;
    try {
      const [payAppRes, invoiceRes] = await Promise.all([
        fetch(payAppPdfUrl),
        fetch(invoicePdfUrl),
      ]);
      if (!payAppRes.ok || !invoiceRes.ok) {
        console.error("PDF fetch status:", {
          payApp: payAppRes.status,
          invoice: invoiceRes.status,
        });
        return new Response(JSON.stringify({ error: "Failed to fetch PDFs" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        });
      }
      payAppBuf = await payAppRes.arrayBuffer();
      invoiceBuf = await invoiceRes.arrayBuffer();
    } catch (e) {
      console.error("PDF fetch threw:", e.message);
      return new Response(JSON.stringify({ error: "Failed to fetch PDFs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
      });
    }

    const payAppB64 = arrayBufferToBase64(payAppBuf);
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
        to: recipientEmail,
        subject: subject,
        html: html,
        attachments: [
          {
            filename: `PayApp-${appNumber}.pdf`,
            content: payAppB64,
          },
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

    // ── Mark pay app submitted ────────────────────────────────────────
    const nowIso = new Date().toISOString();
    const { error: payAppUpdErr } = await supabase
      .from("billing_schedule_pay_apps")
      .update({ status: "submitted", submitted_at: nowIso })
      .eq("id", payAppId);
    if (payAppUpdErr) {
      console.error("Pay-app status update failed (non-fatal):", payAppUpdErr.message);
    }

    // ── Mark invoice sent ─────────────────────────────────────────────
    const { error: invUpdErr } = await supabase
      .from("invoices")
      .update({ status: "Sent", sent_at: nowIso })
      .eq("id", invoiceId);
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
