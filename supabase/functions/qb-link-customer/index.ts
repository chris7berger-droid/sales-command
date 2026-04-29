import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_ENVIRONMENT = Deno.env.get("QB_ENVIRONMENT") || "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QB_API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function getQBToken(sb: any) {
  const { data: conn } = await sb.from("qb_connection").select("*").limit(1).single();
  if (!conn) throw new Error("No QuickBooks connection found. Connect QB first.");

  if (new Date(conn.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    console.log("qb-link-customer: refreshing expired token");
    const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refresh_token,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(`Token refresh failed: ${tokenData.error || "unknown"}`);

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await sb.from("qb_connection").update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq("id", conn.id);

    return { accessToken: tokenData.access_token, realmId: conn.realm_id };
  }

  return { accessToken: conn.access_token, realmId: conn.realm_id };
}

async function qbApi(method: string, path: string, accessToken: string, realmId: string, body?: any) {
  const url = `${QB_API_BASE}/v3/company/${realmId}${path}`;
  const opts: any = {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    console.error("QB API error:", JSON.stringify(data));
    throw new Error(`QB API ${res.status}: ${JSON.stringify(data?.Fault?.Error?.[0]?.Detail || data)}`);
  }
  return data;
}

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

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
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { callLogId, qbCustomerId } = await req.json();
    if (!callLogId || typeof qbCustomerId !== "string" || !qbCustomerId.trim()) {
      return new Response(JSON.stringify({ error: "callLogId and qbCustomerId are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Verify the QB customer is real and active. Closes the search→pick→confirm
    // staleness window — if another user deactivated the customer between search
    // and confirm, we refuse to write a dead ID into call_log.
    const { accessToken, realmId } = await getQBToken(sb);
    const escapedId = String(qbCustomerId).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = `SELECT Id, DisplayName, Active, ParentRef FROM Customer WHERE Id = '${escapedId}'`;
    const data = await qbApi("GET", `/query?query=${encodeURIComponent(query)}`, accessToken, realmId);
    const cust = data?.QueryResponse?.Customer?.[0];
    if (!cust || !cust.Active) {
      console.log("qb-link-customer: rejecting inactive/missing customer", { qbCustomerId, found: !!cust, active: cust?.Active });
      return new Response(JSON.stringify({ error: "qb_customer_invalid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    // Service-role write — funnels the call_log update through this validated path
    // instead of relying on browser-side supabase.from("call_log").update(...) which
    // would otherwise bypass the QB existence check.
    const { error: updErr } = await sb.from("call_log")
      .update({ qb_customer_id: cust.Id, qb_skip_sync: false })
      .eq("id", callLogId);
    if (updErr) throw new Error(`call_log update failed: ${updErr.message}`);

    console.log("qb-link-customer: linked", { callLogId, qbCustomerId: cust.Id, displayName: cust.DisplayName });
    return new Response(JSON.stringify({
      success: true,
      qbCustomerId: cust.Id,
      displayName: cust.DisplayName || "",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("qb-link-customer error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
