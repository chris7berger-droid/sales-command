import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SITE_URL = "https://www.scmybiz.com";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { invoiceId, customerEmail, customerName, amount, jobName, jobId, dueDate, senderEmail } = await req.json();

    console.log("send-invoice invoked", { invoiceId, customerEmail, amount, jobName });

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "Customer email is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: "Invalid invoice amount" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

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

    // Send email to customer with pay link
    const dueLine = dueDate ? `Payment due by ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : "Payment due upon receipt";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderEmail || "noreply@scmybiz.com",
        to: customerEmail,
        subject: `Invoice #${invoiceId} — ${jobName || "High Desert Surface Prep"}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>
            <p>Hi ${customerName},</p>
            <p>Please find your invoice below.</p>
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
