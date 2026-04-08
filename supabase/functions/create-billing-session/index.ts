import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCC_STRIPE_SECRET_KEY = Deno.env.get("SCC_STRIPE_SECRET_KEY");
const SCC_STRIPE_PRICE_SALES = Deno.env.get("SCC_STRIPE_PRICE_SALES");
const SCC_STRIPE_PRICE_SCHEDULE = Deno.env.get("SCC_STRIPE_PRICE_SCHEDULE");
const SCC_STRIPE_COUPON_BUNDLE = Deno.env.get("SCC_STRIPE_COUPON_BUNDLE");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE_URL = "https://salescommand.app";

// Map app keys to Stripe Price IDs
const PRICE_MAP: Record<string, string | undefined> = {
  sales: SCC_STRIPE_PRICE_SALES,
  schedule: SCC_STRIPE_PRICE_SCHEDULE,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function stripeRequest(endpoint: string, params: Record<string, string>, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${SCC_STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method !== "GET" ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function stripeGet(endpoint: string) {
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${SCC_STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    // Get tenant config
    const { data: config } = await supabase
      .from("tenant_config")
      .select("*")
      .limit(1)
      .single();

    if (!config) throw new Error("No tenant config found");

    const body = await req.json();
    const { action } = body;

    // ── ACTION: checkout ──────────────────────────────────────────────
    // Creates a Stripe Checkout session for a new subscription
    if (action === "checkout") {
      const { apps } = body; // e.g. ["sales"] or ["sales", "schedule"]
      if (!apps || !apps.length) throw new Error("No apps selected");

      // Validate all selected apps have price IDs
      const lineItems: string[][] = [];
      for (const app of apps) {
        const priceId = PRICE_MAP[app];
        if (!priceId) throw new Error(`No price configured for app: ${app}`);
        lineItems.push([`line_items[${lineItems.length}][price]`, priceId]);
        lineItems.push([`line_items[${lineItems.length - 1}][quantity]`, "1"]);
      }

      // Create or reuse Stripe Customer
      let customerId = config.stripe_customer_id;
      if (!customerId) {
        const customer = await stripeRequest("customers", {
          name: config.company_name || "Tenant",
          email: config.email || user.email || "",
          "metadata[tenant_id]": config.id,
        });
        customerId = customer.id;

        // Save customer ID immediately
        await supabase
          .from("tenant_config")
          .update({ stripe_customer_id: customerId })
          .eq("id", config.id);
      }

      // Build checkout params
      const params: Record<string, string> = {
        customer: customerId,
        mode: "subscription",
        success_url: `${SITE_URL}?billing=success`,
        cancel_url: `${SITE_URL}?billing=canceled`,
        "metadata[tenant_id]": config.id,
        "subscription_data[metadata][tenant_id]": config.id,
      };

      // Add line items
      for (let i = 0; i < apps.length; i++) {
        const priceId = PRICE_MAP[apps[i]];
        params[`line_items[${i}][price]`] = priceId!;
        params[`line_items[${i}][quantity]`] = "1";
      }

      // Apply bundle coupon if 2+ apps
      if (apps.length >= 2 && SCC_STRIPE_COUPON_BUNDLE) {
        params["discounts[0][coupon]"] = SCC_STRIPE_COUPON_BUNDLE;
      }

      const session = await stripeRequest("checkout/sessions", params);

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: portal ────────────────────────────────────────────────
    // Opens Stripe Customer Portal for managing subscription
    if (action === "portal") {
      const customerId = config.stripe_customer_id;
      if (!customerId) throw new Error("No billing account found. Subscribe first.");

      const session = await stripeRequest("billing_portal/sessions", {
        customer: customerId,
        return_url: `${SITE_URL}?page=settings`,
      });

      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: status ────────────────────────────────────────────────
    // Returns current subscription status for the billing UI
    if (action === "status") {
      const result: Record<string, unknown> = {
        stripe_customer_id: config.stripe_customer_id || null,
        stripe_subscription_id: config.stripe_subscription_id || null,
        subscription_status: config.subscription_status || null,
        subscription_started_at: config.subscription_started_at || null,
        subscribed_apps: [],
      };

      // If there's an active subscription, fetch details from Stripe
      if (config.stripe_subscription_id) {
        try {
          const sub = await stripeGet(`subscriptions/${config.stripe_subscription_id}`);
          result.subscription_status = sub.status;
          result.current_period_end = sub.current_period_end;
          result.cancel_at_period_end = sub.cancel_at_period_end;

          // Map subscription items back to app keys
          const subscribedApps: string[] = [];
          const priceToApp = Object.fromEntries(
            Object.entries(PRICE_MAP).map(([app, price]) => [price, app])
          );
          for (const item of sub.items?.data || []) {
            const app = priceToApp[item.price?.id];
            if (app) subscribedApps.push(app);
          }
          result.subscribed_apps = subscribedApps;

          // Sync status back to DB if changed
          if (sub.status !== config.subscription_status) {
            await supabase
              .from("tenant_config")
              .update({ subscription_status: sub.status })
              .eq("id", config.id);
          }
        } catch (e) {
          console.error("Failed to fetch subscription from Stripe:", e.message);
        }
      }

      return new Response(JSON.stringify(result), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (error) {
    console.error("create-billing-session error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
