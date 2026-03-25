import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
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

serve(async (req) => {
  // Stripe sends POST with no CORS needed, but handle preflight just in case
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

      console.log("Payment completed for invoice:", invoiceId, "payment_intent:", paymentIntent);

      if (!invoiceId) {
        console.error("No invoice_id in session metadata");
        return new Response("No invoice_id", { status: 400 });
      }

      // Update invoice in Supabase
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    }

    // Always return 200 to Stripe so it doesn't retry
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("stripe-webhook error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
