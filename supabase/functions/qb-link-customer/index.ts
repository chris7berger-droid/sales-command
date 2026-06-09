import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_ENVIRONMENT = Deno.env.get("QB_ENVIRONMENT") || "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QB_API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function getQBToken(sb: any, tenantId: string) {
  const { data: conn } = await sb.from("qb_connection").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!conn) throw new Error("No QuickBooks connection found for tenant.");

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
    const { data: updated, error: updErr } = await sb.from("qb_connection").update({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq("id", conn.id).eq("tenant_id", tenantId).select("id").maybeSingle();
    if (updErr) throw new Error(`QB token refresh failed: ${updErr.message}`);
    if (!updated) throw new Error("QB token refresh failed: no matching qb_connection for tenant");

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

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caller = await authenticateCaller(sb, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);
    if (caller.isServiceRole) return unauthorizedResponse(403, corsHeaders);

    const { callLogId, qbCustomerId } = await req.json();
    if (!callLogId || typeof qbCustomerId !== "string" || !qbCustomerId.trim()) {
      return new Response(JSON.stringify({ error: "callLogId and qbCustomerId are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Tenant binding: a user JWT may only link QB customers on call_log rows
    // in their own tenant. Load the row and assert before any QB call or write.
    const { data: callLog } = await sb
      .from("call_log")
      .select("id, tenant_id")
      .eq("id", callLogId)
      .maybeSingle();
    if (!callLog) {
      return new Response(JSON.stringify({ error: "Call log not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
      });
    }
    if (callLog.tenant_id !== caller.tenantId) return unauthorizedResponse(403, corsHeaders);

    // Verify the QB customer is real and active. Closes the search→pick→confirm
    // staleness window — if another user deactivated the customer between search
    // and confirm, we refuse to write a dead ID into call_log.
    const { accessToken, realmId } = await getQBToken(sb, caller.tenantId);
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
    // would otherwise bypass the QB existence check. Tenant scope on the WHERE
    // clause is defense-in-depth: a TOCTOU race that flipped the row's tenant_id
    // between our assertion above and this write would otherwise silently succeed.
    const { error: updErr } = await sb.from("call_log")
      .update({ qb_customer_id: cust.Id, qb_skip_sync: false })
      .eq("id", callLogId)
      .eq("tenant_id", caller.tenantId);
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
