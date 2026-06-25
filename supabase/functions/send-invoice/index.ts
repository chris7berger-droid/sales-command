import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = "https://salescommand.app";
const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

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

    // The resolved billing contact (above) is the legacy single-recipient
    // target — used only as the branch-(i) fallback when no recipient rows exist.
    const resolvedBillingEmail = customerEmail;

    // ── Load recipients (main + viewers), tenant-scoped ──────────────────
    // The fn runs as service_role → RLS is bypassed, so scope the read
    // explicitly by tenant (belt-and-suspenders, send-pay-app S5). (plan §4.4 #6)
    const { data: recipientRows } = await supabase
      .from("invoice_recipients")
      .select("id, contact_name, contact_email, role, customer_contact_id")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", invoice.tenant_id);

    // ── Soft allowlist (audit C9): the customer's known contacts ∪ the
    // customer record's emails. Run per recipient incl. orphan rows. UI-added
    // contacts auto-pass because createNewRecipient writes them to
    // customer_contacts first; this blocks raw body-injected addresses. (plan §4.4 #3)
    const norm = (s: any) => String(s || "").trim().toLowerCase();
    const allowedRecipients = new Set<string>();
    if (customer?.billing_email) allowedRecipients.add(norm(customer.billing_email));
    if (customer?.contact_email) allowedRecipients.add(norm(customer.contact_email));
    if ((customer as any)?.email) allowedRecipients.add(norm((customer as any).email));
    if (customerId) {
      const { data: allContacts } = await supabase
        .from("customer_contacts")
        .select("email")
        .eq("customer_id", customerId);
      for (const c of allContacts || []) if (c.email) allowedRecipients.add(norm(c.email));
    }

    // ── Three-branch recipient resolution (plan §4.4 #2/A3). Never promote a viewer.
    const mainRows = (recipientRows || []).filter((r: any) => r.role === "main");
    let mainRecipient: { id: string | null; email: string; name: string };
    let viewerRecipients: { id: string | null; email: string; name: string }[];

    if (!recipientRows || recipientRows.length === 0) {
      // (i) 0 rows → legacy single-recipient send to the resolved billing contact.
      if (!resolvedBillingEmail) {
        return new Response(JSON.stringify({ error: "No customer email on file for this invoice" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
      mainRecipient = { id: null, email: resolvedBillingEmail, name: customerName || "" };
      viewerRecipients = [];
    } else if (mainRows.length === 0) {
      // (iii) rows exist but NO main → BLOCK. Do not silently elevate a viewer.
      return new Response(JSON.stringify({ error: "This invoice has recipients but no main recipient. Set a main recipient (who gets the pay link) before sending." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    } else {
      // (ii) one main (+ any viewers) → the first main is the payer. Everyone
      // else — including any stray second 'main' row — is treated as a viewer,
      // so a pay link can never reach more than one inbox.
      const m = mainRows[0];
      mainRecipient = { id: m.id, email: String(m.contact_email || ""), name: m.contact_name || customerName || "" };
      viewerRecipients = (recipientRows as any[])
        .filter((r) => r.id !== m.id)
        .map((r) => ({ id: r.id, email: String(r.contact_email || ""), name: r.contact_name || "" }));
    }

    // The main recipient must be on the allowlist (and have an address), or abort —
    // the invoice isn't "sent" if the payer never gets it.
    if (!mainRecipient.email || !allowedRecipients.has(norm(mainRecipient.email))) {
      return new Response(JSON.stringify({ error: `Main recipient ${mainRecipient.email || "(none)"} is not a known contact for this customer.` }), {
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
    // Email-safe layout: <table> with two columns. Gmail strips `display: flex`
    // so the previous <div flex> rows rendered as "Gross amount$0.59" with no
    // gap between label and value. Tables render reliably in every email client.
    const breakdownHtml = hasBreakdown
      ? `
        <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse; font-size: 13px; color: #4a4238; margin-bottom: 12px;">
          <tr><td style="padding: 3px 0; text-align: left;">Gross amount</td><td style="padding: 3px 0; text-align: right;">$${fmtMoney(amount)}</td></tr>
          ${discount > 0 ? `<tr><td style="padding: 3px 0; text-align: left;">Discount</td><td style="padding: 3px 0; text-align: right;">-$${fmtMoney(discount)}</td></tr>` : ""}
          ${retentionAmount > 0 ? `<tr><td style="padding: 3px 0; text-align: left;">Retainage withheld${retentionPct > 0 ? ` (${retentionPct}%)` : ""}</td><td style="padding: 3px 0; text-align: right;">-$${fmtMoney(retentionAmount)}</td></tr>` : ""}
          <tr><td style="padding: 6px 0 0; border-top: 1px solid #e5e0d8; text-align: left; font-weight: 700; color: #1c1814;">Payment due</td><td style="padding: 6px 0 0; border-top: 1px solid #e5e0d8; text-align: right; font-weight: 700; color: #1c1814;">$${fmtMoney(netAmount)}</td></tr>
        </table>
      `
      : "";

    const esc = (s: any) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const introHtml = (intro && intro.trim())
      ? `<div style="font-size: 14px; color: #1c1814; line-height: 1.6; white-space: pre-wrap; margin: 0 0 16px;">${esc(intro.trim())}</div>`
      : `<p>Please find your invoice below.</p>`;
    const summaryBlock = `
            <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 20px; margin: 24px 0;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="font-size: 12px; color: #887c6e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;">Invoice #${invoiceId}</span>
                ${jobId ? `<span style="font-size: 12px; color: #887c6e;">Job #${jobId}</span>` : ""}
              </div>
              <div style="font-size: 32px; font-weight: 800; color: #1c1814; margin-bottom: 8px;">$${fmtMoney(netAmount)}</div>
              ${breakdownHtml}
              <div style="font-size: 12px; color: #887c6e;">${dueLine}</div>
            </div>`;
    const viewLinkHtml = viewInvoiceUrl ? `<p style="text-align: center; margin-bottom: 16px;"><a href="${viewInvoiceUrl}" style="color: #30cfac; font-size: 13px; font-weight: 600; text-decoration: underline;">View Full Invoice / Print PDF</a></p>` : "";
    const footerHtml = `<p style="color: #887c6e; font-size: 12px; text-align: center;">Questions? Reply to this email or call (775) 300-1900.</p>`;
    const headerHtml = `
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>`;

    // MAIN template — carries the Pay Now button (checkoutUrl).
    const buildMainHtml = (greetingName: string) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            ${headerHtml}
            <p>Hi ${esc(greetingName)},</p>
            ${introHtml}
            ${summaryBlock}
            <div style="margin: 32px 0; text-align: center;">
              <a href="${checkoutUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 36px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">Pay Now</a>
            </div>
            ${viewLinkHtml}
            <p style="color: #887c6e; font-size: 12px; text-align: center;">Secure payment powered by Stripe</p>
            ${footerHtml}
          </div>
        `;

    // VIEWER template — a SEPARATE template with no checkoutUrl parameter at all,
    // so a pay link is compile-time impossible to leak to a viewer. (plan §4.4 #4/A7)
    const buildViewerHtml = (greetingName: string) => `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            ${headerHtml}
            <p>Hi ${esc(greetingName)},</p>
            <p style="font-size: 14px; color: #1c1814; line-height: 1.6;">You're receiving a copy of this invoice for your records. It has been sent to the billing contact for payment.</p>
            ${introHtml}
            ${summaryBlock}
            ${viewLinkHtml}
            ${footerHtml}
          </div>
        `;

    const subject = `Invoice #${invoiceId} — ${jobName || "High Desert Surface Prep"}`;
    const sendEmail = async (to: string, html: string) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromAddress, to, subject, html }),
      });
      const txt = await res.text();
      return { ok: res.ok, txt };
    };

    const warnings: string[] = [];

    // ── Send the MAIN first. A main-send failure aborts the whole operation —
    // the invoice isn't "sent" if the payer never got it. (plan §4.4 #5)
    const mainRes = await sendEmail(mainRecipient.email, buildMainHtml(mainRecipient.name || customerName));
    console.log("Main email response:", mainRes.ok, mainRes.txt.slice(0, 200));
    if (!mainRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send invoice to main recipient: ${mainRes.txt}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    // Stamp sent_at on the main's own row only (branch i has no row → skip).
    if (mainRecipient.id) {
      await supabase.from("invoice_recipients").update({ sent_at: new Date().toISOString() }).eq("id", mainRecipient.id);
    }

    // ── Send each VIEWER (view-only template). A viewer-send failure is
    // non-fatal → collect into warnings[]. Stamp sent_at per row on its own
    // success only — never blanket-stamp. (plan §4.4 #5)
    for (const v of viewerRecipients) {
      if (!v.email || !allowedRecipients.has(norm(v.email))) {
        warnings.push(`${v.email || "(no email)"} — not a known contact for this customer; skipped.`);
        continue;
      }
      try {
        const vr = await sendEmail(v.email, buildViewerHtml(v.name || "there"));
        if (!vr.ok) { warnings.push(`${v.email} — send failed: ${vr.txt.slice(0, 140)}`); continue; }
        if (v.id) {
          await supabase.from("invoice_recipients").update({ sent_at: new Date().toISOString() }).eq("id", v.id);
        }
      } catch (e) {
        warnings.push(`${v.email} — ${e.message}`);
      }
    }

    // ── Notification to sender (non-blocking). Lists every recipient + any
    // viewer warnings for a paper trail (F30 part 4). Only if sender domain
    // is verified — otherwise the From would be spoofable.
    if (senderEmail && VERIFIED_DOMAINS.includes(senderDomain)) {
      const recipientListHtml = [
        `<div style="font-size: 12px; color: #4a4238; margin-bottom: 3px;"><strong>Main (pay link):</strong> ${esc(mainRecipient.name || customerName)} &lt;${esc(mainRecipient.email)}&gt;</div>`,
        ...viewerRecipients.map((v) => `<div style="font-size: 12px; color: #4a4238; margin-bottom: 3px;"><strong>Viewer:</strong> ${esc(v.name || "")} &lt;${esc(v.email)}&gt;</div>`),
      ].join("");
      const warningsHtml = warnings.length
        ? `<div style="background: #fff7ed; border: 1px solid #f59e0b; border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-size: 12px; color: #92400e;"><strong>Some viewer copies didn't send:</strong>${warnings.map((w) => `<div style="margin-top: 3px;">· ${esc(w)}</div>`).join("")}</div>`
        : "";
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromAddress,
            to: senderEmail,
            subject: `Invoice Sent — #${invoiceId} (${customerName})`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
                <p>Invoice <strong>#${invoiceId}</strong> has been sent for <strong>${esc(customerName)}</strong>.</p>
                <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 16px; margin: 16px 0;">
                  ${jobId ? `<div style="font-size: 12px; color: #887c6e; margin-bottom: 4px;">Job #${jobId}${jobName ? ` — ${esc(jobName)}` : ""}</div>` : ""}
                  <div style="font-size: 22px; font-weight: 800; color: #1c1814; margin: 8px 0 12px;">$${fmtMoney(netAmount)}</div>
                  ${recipientListHtml}
                  ${hasBreakdown ? `<div style="font-size: 11px; color: #887c6e; margin-top: 8px;">Net of $${fmtMoney(amount - netAmount)} ${discount > 0 && retentionAmount > 0 ? "discount + retainage" : discount > 0 ? "discount" : "retainage"} (gross $${fmtMoney(amount)})</div>` : ""}
                  ${dueDate ? `<div style="font-size: 12px; color: #887c6e; margin-top: 4px;">Due ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>` : ""}
                </div>
                ${warningsHtml}
                <p style="color: #887c6e; font-size: 12px;">You will receive another notification when the customer pays.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error("Sender notification failed (non-fatal):", e.message);
      }
    }

    return new Response(JSON.stringify({ success: true, paymentLinkId, checkoutUrl, warnings }), {
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
