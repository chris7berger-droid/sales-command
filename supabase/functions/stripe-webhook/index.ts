import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(",").reduce((acc: Record<string, string>, part) => {
    const [key, val] = part.split("=");
    acc[key.trim()] = val;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  return expected === signature;
}

async function sendEmail(to: string, subject: string, html: string, from?: string) {
  if (!RESEND_API_KEY || !to) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: from || "noreply@scmybiz.com", to, subject, html }),
    });
    console.log("Email to", to, ":", res.status);
  } catch (e) {
    console.error("Email failed (non-fatal):", e.message);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, stripe-signature",
      },
    });
  }

  try {
    const body = await req.text();
    const sigHeader = req.headers.get("stripe-signature") || "";

    // Verify webhook signature if secret is set
    if (STRIPE_WEBHOOK_SECRET) {
      const valid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
      if (!valid) {
        console.error("Invalid Stripe webhook signature");
        return new Response("Invalid signature", { status: 400 });
      }
    }

    const event = JSON.parse(body);
    console.log("stripe-webhook event:", event.type, event.id);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const invoiceId = session.metadata?.invoice_id;
      const paymentIntent = session.payment_intent;
      const amountTotal = session.amount_total ? (session.amount_total / 100) : 0;
      const customerEmail = session.customer_email || session.customer_details?.email || "";

      console.log("Payment completed for invoice:", invoiceId, "payment_intent:", paymentIntent, "amount:", amountTotal);

      if (!invoiceId) {
        console.error("No invoice_id in session metadata");
        return new Response("No invoice_id", { status: 400 });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Update invoice status
      const { error } = await supabase
        .from("invoices")
        .update({
          status: "Paid",
          stripe_checkout_id: session.id,
          stripe_payment_id: paymentIntent,
          paid_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);

      if (error) {
        console.error("Failed to update invoice:", error.message);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }

      console.log("Invoice", invoiceId, "marked as Paid");

      // Sync payment to QuickBooks (non-blocking)
      try {
        const qbRes = await fetch(`${SUPABASE_URL}/functions/v1/qb-record-payment`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ invoiceId }),
        });
        const qbData = await qbRes.json();
        console.log("QB payment sync:", qbRes.ok ? "success" : "failed", JSON.stringify(qbData));
      } catch (qbErr) {
        console.warn("QB payment sync error:", qbErr.message);
      }

      // Get invoice details for emails
      const { data: inv } = await supabase
        .from("invoices")
        .select("*, proposals:proposal_id(call_log_id, call_log(sales_name, customer_name))")
        .eq("id", invoiceId)
        .maybeSingle();

      const jobName = inv?.job_name || "";
      const jobId = inv?.job_id || "";
      const salesName = inv?.proposals?.call_log?.sales_name || "";
      const customerName = inv?.proposals?.call_log?.customer_name || customerEmail;
      const amountStr = `$${amountTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const paidDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      // Look up rep email for from address
      let repEmail = "";
      if (salesName) {
        const { data: rep } = await supabase
          .from("team_members")
          .select("email")
          .eq("name", salesName)
          .maybeSingle();
        repEmail = rep?.email || "";
      }

      // Email to customer — payment receipt
      if (customerEmail) {
        await sendEmail(
          customerEmail,
          `Payment Received — Invoice #${invoiceId}`,
          `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>
            <p>Hi ${customerName},</p>
            <p>We've received your payment. Thank you!</p>
            <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 20px; margin: 24px 0;">
              <div style="font-size: 12px; color: #887c6e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;">Invoice #${invoiceId}</div>
              ${jobId ? `<div style="font-size: 12px; color: #887c6e; margin-bottom: 12px;">Job #${jobId}${jobName ? ` — ${jobName}` : ""}</div>` : ""}
              <div style="font-size: 28px; font-weight: 800; color: #1c1814; margin-bottom: 4px;">${amountStr}</div>
              <div style="font-size: 13px; color: #30cfac; font-weight: 700;">PAID — ${paidDate}</div>
            </div>
            <p style="color: #887c6e; font-size: 12px;">This serves as your payment receipt. Questions? Reply to this email or call (775) 300-1900.</p>
          </div>
          `,
          repEmail || undefined
        );
      }

      // Email to sales rep — payment notification
      if (repEmail) {
          await sendEmail(
            repEmail,
            `Payment Received — Invoice #${invoiceId} (${customerName})`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
              <p>Hi ${salesName},</p>
              <p>Invoice <strong>#${invoiceId}</strong> has been paid.</p>
              <div style="background: #f8f6f3; border: 1.5px solid #e5e0d8; border-radius: 10px; padding: 16px; margin: 16px 0;">
                <div style="font-weight: 700; margin-bottom: 4px;">${customerName}</div>
                ${jobId ? `<div style="font-size: 12px; color: #887c6e;">Job #${jobId}${jobName ? ` — ${jobName}` : ""}</div>` : ""}
                <div style="font-size: 22px; font-weight: 800; color: #1c1814; margin-top: 8px;">${amountStr}</div>
                <div style="font-size: 12px; color: #30cfac; font-weight: 700;">PAID — ${paidDate}</div>
              </div>
            </div>
            `,
            repEmail
          );
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("stripe-webhook error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
