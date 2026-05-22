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
      .select("tenant_id, amount, discount, retention_amount, retention_pct, viewing_token, proposal_id, job_id, stripe_payment_link_id, proposals(call_log_id, call_log(customer_id, customers(email, contact_email, billing_email)))")
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

    // B36: customer-facing amount = gross - discount - retention. Matches
    // Invoices.jsx:1443 ("Payment Due" StatCard) which is the canonical UI
    // formula. Stripe payment_link unit_amount + email body must call for net,
    // not gross — prior bug shipped gross to customers when discount/retention
    // were applied (Danny Peltier #10028, 2026-05-22).
    const discount = Number(invoice.discount) || 0;
    const retentionAmount = Number(invoice.retention_amount) || 0;
    const retentionPct = Number(invoice.retention_pct) || 0;
    const netAmount = amount - discount - retentionAmount;
    if (netAmount <= 0) {
      return new Response(JSON.stringify({ error: "Invoice net amount (after discount + retention) is zero or negative" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Resolve billing email: customer_contacts (Billing Contact) first,
    // then customers table fields — matches frontend resolution order.
    const customer = invoice.proposals?.call_log?.customers;
    const customerId = invoice.proposals?.call_log?.customer_id;
    let customerEmail: string | null = null;

    if (customerId) {
      const { data: contacts } = await supabase
        .from("customer_contacts")
        .select("name, email, is_primary, is_billing_contact, role, created_at")
        .eq("customer_id", customerId)
        .or("is_billing_contact.eq.true,role.eq.Billing Contact");
      const bc = contacts?.length
        ? (contacts.find((c: any) => c.is_primary) || [...contacts].sort((a: any, b: any) => (b.created_at || "").localeCompare(a.created_at || ""))[0])
        : null;
      if (bc?.email) customerEmail = bc.email;
    }
    if (!customerEmail && customer) {
      customerEmail = customer.billing_email || customer.contact_email || customer.email || null;
    }

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

    // Resend safety: if this invoice already has a live Payment Link from a previous send,
    // deactivate it before minting a new one. Without this, a customer holding the older
    // email could click the stale link and pay the prior amount (esp. dangerous on amount
    // changes between resends). Non-fatal — mirror webhook deactivation behavior.
    if (invoice.stripe_payment_link_id) {
      try {
        const priorRes = await fetch(`https://api.stripe.com/v1/payment_links/${invoice.stripe_payment_link_id}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            "active": "false",
            "inactive_message": "This invoice is no longer active.",
          }).toString(),
        });
        const priorBody = await priorRes.text();
        console.log("Deactivate prior payment link", invoice.stripe_payment_link_id, ":", priorRes.status, priorBody.slice(0, 200));
      } catch (e) {
        console.error("Prior payment link deactivation failed (non-fatal):", e.message);
      }
    }

    // Create Stripe Payment Link (lives until deactivated — no 24h cap like Checkout Sessions).
    // Deactivation happens in stripe-webhook on paid, and deactivate-payment-link on void/pullback.
    const stripeRes = await fetch("https://api.stripe.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": `${customerName} - Invoice #${invoiceId}`,
        "line_items[0][price_data][product_data][description]": `${jobId ? `Job #${jobId}` : ""}${jobId && jobName ? ` - ${jobName}` : jobName || ""} · High Desert Surface Prep`,
        "payment_intent_data[description]": `${customerName} - Invoice #${invoiceId}${jobId ? ` · Job #${jobId}` : ""}${jobName ? ` - ${jobName}` : ""}`,
        "line_items[0][price_data][unit_amount]": String(Math.round(netAmount * 100)),
        "line_items[0][quantity]": "1",
        "after_completion[type]": "redirect",
        "after_completion[redirect][url]": `${SITE_URL}/invoice-paid?invoice_id=${invoiceId}`,
        "metadata[invoice_id]": invoiceId,
        "payment_intent_data[metadata][invoice_id]": invoiceId,
      }).toString(),
    });

    const stripeData = await stripeRes.json();
    console.log("Stripe payment link response:", stripeRes.status, stripeData.id || stripeData.error?.message);

    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: `Stripe error: ${stripeData.error?.message || "Unknown"}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const checkoutUrl = stripeData.url;
    const paymentLinkId = stripeData.id;

    const viewInvoiceUrl = invoice.viewing_token ? `${SITE_URL}/invoice/${invoice.viewing_token}` : null;

    // Persist URL + payment link ID. stripe_checkout_id cleared so any stale Session ID
    // from a previous send cycle doesn't linger; webhook will repopulate on payment.
    await supabase.from("invoices").update({
      stripe_checkout_url: checkoutUrl,
      stripe_payment_link_id: paymentLinkId,
      stripe_checkout_id: null,
    }).eq("id", invoiceId);

    // Send email to customer with pay link
    const dueLine = dueDate ? `Payment due by ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : "Payment due upon receipt";

    const fmtMoney = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Show line-item breakdown when discount or retention is applied so the
    // customer sees why the headline differs from any prior estimate/proposal.
    const hasBreakdown = discount > 0 || retentionAmount > 0;
    const breakdownHtml = hasBreakdown
      ? `
        <div style="font-size: 13px; color: #4a4238; margin-bottom: 12px; line-height: 1.8;">
          <div style="display: flex; justify-content: space-between;"><span>Gross amount</span><span>$${fmtMoney(amount)}</span></div>
          ${discount > 0 ? `<div style="display: flex; justify-content: space-between;"><span>Discount</span><span>-$${fmtMoney(discount)}</span></div>` : ""}
          ${retentionAmount > 0 ? `<div style="display: flex; justify-content: space-between;"><span>Retainage withheld${retentionPct > 0 ? ` (${retentionPct}%)` : ""}</span><span>-$${fmtMoney(retentionAmount)}</span></div>` : ""}
          <div style="border-top: 1px solid #e5e0d8; margin-top: 6px; padding-top: 6px; display: flex; justify-content: space-between; font-weight: 700; color: #1c1814;"><span>Payment due</span><span>$${fmtMoney(netAmount)}</span></div>
        </div>
      `
      : "";

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
              <div style="font-size: 32px; font-weight: 800; color: #1c1814; margin-bottom: 8px;">$${fmtMoney(netAmount)}</div>
              ${breakdownHtml}
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
                  <div style="font-size: 22px; font-weight: 800; color: #1c1814; margin-top: 8px;">$${fmtMoney(netAmount)}</div>
                  ${hasBreakdown ? `<div style="font-size: 11px; color: #887c6e; margin-top: 4px;">Net of $${fmtMoney(amount - netAmount)} ${discount > 0 && retentionAmount > 0 ? "discount + retainage" : discount > 0 ? "discount" : "retainage"} (gross $${fmtMoney(amount)})</div>` : ""}
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

    return new Response(JSON.stringify({ success: true, paymentLinkId, checkoutUrl }), {
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
