import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCC_STRIPE_SECRET_KEY = Deno.env.get("SCC_STRIPE_SECRET_KEY");
const SCC_STRIPE_WEBHOOK_SECRET = Deno.env.get("SCC_STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Price ID → app key mapping (reverse lookup)
const PRICE_TO_APP: Record<string, string> = {};
const SCC_STRIPE_PRICE_SALES = Deno.env.get("SCC_STRIPE_PRICE_SALES");
const SCC_STRIPE_PRICE_SCHEDULE = Deno.env.get("SCC_STRIPE_PRICE_SCHEDULE");
if (SCC_STRIPE_PRICE_SALES) PRICE_TO_APP[SCC_STRIPE_PRICE_SALES] = "sales";
if (SCC_STRIPE_PRICE_SCHEDULE) PRICE_TO_APP[SCC_STRIPE_PRICE_SCHEDULE] = "schedule";

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(",").reduce((acc: Record<string, string>, part) => {
    const [key, val] = part.split("=");
    acc[key.trim()] = val;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const hexPairs = signature.match(/.{2}/g);
  if (!hexPairs) return false;
  const sigBytes = new Uint8Array(hexPairs.map(b => parseInt(b, 16)));

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(signedPayload));
}

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app");
  const allowedOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "content-type, stripe-signature",
      },
    });
  }

  try {
    const body = await req.text();
    const sigHeader = req.headers.get("stripe-signature") || "";

    // Verify webhook signature — secret MUST be configured
    if (!SCC_STRIPE_WEBHOOK_SECRET) {
      console.error("FATAL: SCC_STRIPE_WEBHOOK_SECRET is not configured — rejecting all events");
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const valid = await verifyStripeSignature(body, sigHeader, SCC_STRIPE_WEBHOOK_SECRET);
    if (!valid) {
      console.error("Invalid SCC Stripe webhook signature");
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(body);
    console.log("scc-stripe-webhook event:", event.type, event.id);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── checkout.session.completed (subscription mode) ────────────────
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode !== "subscription") {
        console.log("Ignoring non-subscription checkout");
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }

      const tenantId = session.metadata?.tenant_id;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      console.log("Subscription checkout completed — tenant:", tenantId, "sub:", subscriptionId);

      if (tenantId) {
        await supabase
          .from("tenant_config")
          .update({
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: "active",
            subscription_started_at: new Date().toISOString(),
          })
          .eq("id", tenantId);

        console.log("Updated tenant_config for", tenantId);
      }
    }

    // ── customer.subscription.updated ─────────────────────────────────
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      const status = sub.status; // active, past_due, canceled, unpaid, etc.

      console.log("Subscription updated — tenant:", tenantId, "status:", status);

      if (tenantId) {
        // Sync subscribed apps from line items
        const subscribedApps: string[] = [];
        for (const item of sub.items?.data || []) {
          const app = PRICE_TO_APP[item.price?.id];
          if (app) subscribedApps.push(app);
        }

        await supabase
          .from("tenant_config")
          .update({
            subscription_status: status,
            apps: subscribedApps.length > 0 ? subscribedApps : undefined,
          })
          .eq("id", tenantId);

        console.log("Synced apps:", subscribedApps, "status:", status);
      }
    }

    // ── customer.subscription.deleted ─────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;

      console.log("Subscription canceled — tenant:", tenantId);

      if (tenantId) {
        await supabase
          .from("tenant_config")
          .update({
            subscription_status: "canceled",
            stripe_subscription_id: null,
          })
          .eq("id", tenantId);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("scc-stripe-webhook error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
