import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = "https://salescommand.app";
const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];
const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
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

    const caller = await authenticateCaller(supabase, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);

    const { invoiceId, customerName, jobName, jobId, dueDate, senderEmail, intro } = await req.json();

    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Pull invoice + linked customer email from the DB. Caller-supplied
    // amount/customerEmail are no longer trusted — the DB row is the
    // source of truth so a low-privilege account can't inflate amounts
    // or redirect invoices to attacker-controlled inboxes.
    const { data: invoice } = await supabase
      .from("invoices")
      .select("tenant_id, amount, viewing_token, proposal_id, job_id, proposals(call_log_id, call_log(customer_id, customers(email, contact_email)))")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (!caller.isServiceRole && invoice.tenant_id !== caller.tenantId) {
      return unauthorizedResponse(403, corsHeaders);
    }

    const amount = Number(invoice.amount);
    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid invoice amount" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const customer = invoice.proposals?.call_log?.customers;
    const customerEmail = customer?.contact_email || customer?.email;
    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "No customer email on file for this invoice" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Restrict Resend `From` to verified domains (audit H10). Falls back to
    // the noreply address if senderEmail is missing or domain is unverified.
    const senderDomain = senderEmail ? String(senderEmail).split("@")[1]?.toLowerCase() : "";
    const fromAddress = senderEmail && VERIFIED_DOMAINS.includes(senderDomain)
      ? senderEmail
      : "noreply@salescommand.app";

    if (!STRIPE_SECRET_KEY) {
      console.error("STRIPE_SECRET_KEY is not set");
      return new Response(JSON.stringify({ error: "Payment service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Create Stripe Checkout session
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "mode": "payment",
        "customer_email": customerEmail,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `${customerName} - Invoice #${invoiceId}`,
        "line_items[0][price_data][product_data][description]": `${jobId ? `Job #${jobId}` : ""}${jobId && jobName ? ` - ${jobName}` : jobName || ""} · High Desert Surface Prep`,
        "payment_intent_data[description]": `${customerName} - Invoice #${invoiceId}${jobId ? ` · Job #${jobId}` : ""}${jobName ? ` - ${jobName}` : ""}`,
        "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
        "line_items[0][quantity]": "1",
        "success_url": `${SITE_URL}/invoice-paid?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoiceId}`,
        "cancel_url": `${SITE_URL}`,
        "metadata[invoice_id]": invoiceId,
        "payment_intent_data[metadata][invoice_id]": invoiceId,
      }).toString(),
    });

    const stripeData = await stripeRes.json();
    console.log("Stripe checkout response:", stripeRes.status, stripeData.id || stripeData.error?.message);

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: `Stripe error: ${stripeData.error?.message || "Unknown"}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const checkoutUrl = stripeData.url;
    const checkoutId = stripeData.id;

    const viewInvoiceUrl = invoice.viewing_token ? `${SITE_URL}/invoice/${invoice.viewing_token}` : null;

    // Store checkout URL on invoice
    await supabase.from("invoices").update({ stripe_checkout_url: checkoutUrl }).eq("id", invoiceId);

    // Send email to customer with pay link
    const dueLine = dueDate ? `Payment due by ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : "Payment due upon receipt";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: customerEmail,
        subject: `Invoice #${invoiceId} — ${jobName || "High Desert Surface Prep"}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>
            <p>Hi ${customerName},</p>
            ${(intro && intro.trim())
              ? `<div style="font-size: 14px; color: #1c1814; line-height: 1.6; white-space: pre-wrap; margin: 0 0 16px;">${intro.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
              : `<p>Please find your invoice below.</p>`}
            <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 20px; margin: 24px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="font-size: 12px; color: #887c6e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;">Invoice #${invoiceId}</span>
                ${jobId ? `<span style="font-size: 12px; color: #887c6e;">Job #${jobId}</span>` : ""}
              </div>
              <div style="font-size: 32px; font-weight: 800; color: #1c1814; margin-bottom: 8px;">$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style="font-size: 12px; color: #887c6e;">${dueLine}</div>
            </div>
            <div style="margin: 32px 0; text-align: center;">
              <a href="${checkoutUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">Pay Now</a>
            </div>
            ${viewInvoiceUrl ? `<p style="text-align: center; margin-bottom: 16px;"><a href="${viewInvoiceUrl}" style="color: #30cfac; font-size: 13px; font-weight: 600; text-decoration: underline;">View Full Invoice / Print PDF</a></p>` : ""}
            <p style="color: #887c6e; font-size: 12px; text-align: center;">Secure payment powered by Stripe</p>
            <p style="color: #887c6e; font-size: 12px; text-align: center;">Questions? Reply to this email or call (775) 300-1900.</p>
          </div>
        `,
      }),
    });

    const emailResBody = await emailRes.text();
    console.log("Customer email response:", emailRes.status, emailResBody);

    if (!emailRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send email: ${emailResBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Notification to sender (non-blocking). Only sent if sender domain is
    // verified — otherwise the From would be spoofable.
    if (senderEmail && VERIFIED_DOMAINS.includes(senderDomain)) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: senderEmail,
            subject: `Invoice Sent — #${invoiceId} (${customerName})`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
                <p>Invoice <strong>#${invoiceId}</strong> has been sent to <strong>${customerName}</strong> (${customerEmail}).</p>
                <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 16px; margin: 16px 0;">
                  ${jobId ? `<div style="font-size: 12px; color: #887c6e; margin-bottom: 4px;">Job #${jobId}${jobName ? ` — ${jobName}` : ""}</div>` : ""}
                  <div style="font-size: 22px; font-weight: 800; color: #1c1814; margin-top: 8px;">$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  ${dueDate ? `<div style="font-size: 12px; color: #887c6e; margin-top: 4px;">Due ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>` : ""}
                </div>
                <p style="color: #887c6e; font-size: 12px;">You will receive another notification when the customer pays.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error("Sender notification failed (non-fatal):", e.message);
      }
    }

    return new Response(JSON.stringify({ success: true, checkoutId, checkoutUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("send-invoice error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
