import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

async function getQBToken(sb: any) {
  const { data: conn } = await sb.from("qb_connection").select("*").limit(1).single();
  if (!conn) throw new Error("No QuickBooks connection found.");

  if (new Date(conn.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
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

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app") || origin.startsWith("http://localhost:");
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

    const caller = await authenticateCaller(sb, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);

    const { invoiceId, reason, action: voidAction } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch invoice to get qb_invoice_id + proposal/call_log skip flags + tenant
    const { data: invoice } = await sb
      .from("invoices")
      .select("qb_invoice_id, proposal_id, job_id, tenant_id")
      .eq("id", invoiceId)
      .maybeSingle();
    if (!invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
      });
    }

    // Tenant binding: a user JWT may only void invoices in their own tenant.
    if (!caller.isServiceRole && invoice.tenant_id !== caller.tenantId) {
      return unauthorizedResponse(403, corsHeaders);
    }

    // Resolve qb_skip_sync via proposal -> call_log (fallback by display_job_number).
    // Note: is_archive_proposal is intentionally NOT a skip reason here. Voiding only
    // needs qb_invoice_id — once an archive invoice was successfully synced (post-link),
    // it must be voidable. Unlinked archive invoices never reach QB, so the
    // `!qb_invoice_id` branch below handles them as "nothing to void" naturally.
    let qbSkipSync = false;
    if (invoice?.proposal_id) {
      const { data: proposal } = await sb.from("proposals").select("call_log_id").eq("id", invoice.proposal_id).maybeSingle();
      if (proposal?.call_log_id) {
        const { data: cl } = await sb.from("call_log").select("qb_skip_sync").eq("id", proposal.call_log_id).maybeSingle();
        qbSkipSync = !!cl?.qb_skip_sync;
      }
    }
    if (!qbSkipSync && invoice?.job_id) {
      const { data: cl } = await sb.from("call_log").select("qb_skip_sync").eq("display_job_number", invoice.job_id).limit(1).maybeSingle();
      qbSkipSync = !!cl?.qb_skip_sync;
    }

    if (qbSkipSync) {
      console.log("qb-void-invoice: skipping per flag", { invoiceId, reason: "qb_skip_sync" });
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "qb_skip_sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (!invoice?.qb_invoice_id) {
      // Not in QB — nothing to void
      return new Response(JSON.stringify({ success: true, action: "skipped", reason: "not in QB" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const { accessToken, realmId } = await getQBToken(sb);

    // Fetch existing invoice to get SyncToken
    const url = `${QB_API_BASE}/v3/company/${realmId}/invoice/${invoice.qb_invoice_id}`;
    const getRes = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    });
    const getData = await getRes.json();
    if (!getRes.ok) throw new Error(`QB fetch failed: ${JSON.stringify(getData?.Fault?.Error?.[0]?.Detail || getData)}`);

    let syncToken = getData.Invoice.SyncToken;
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const actionLabel = voidAction === "delete" ? "DELETED" : "VOIDED/PULLED BACK";
    const noteText = `[${actionLabel}] ${timestamp} — ${reason || "No reason provided"}`;

    // Add PrivateNote to the invoice before voiding for audit trail
    const existingNote = getData.Invoice.PrivateNote || "";
    const fullNote = existingNote ? `${existingNote}\n${noteText}` : noteText;
    const updateUrl = `${QB_API_BASE}/v3/company/${realmId}/invoice`;
    const updateRes = await fetch(updateUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        Id: invoice.qb_invoice_id,
        SyncToken: syncToken,
        sparse: true,
        PrivateNote: fullNote,
      }),
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      console.warn("QB note update failed, proceeding with void:", JSON.stringify(updateData?.Fault?.Error?.[0]?.Detail || updateData));
    } else {
      syncToken = updateData.Invoice.SyncToken;
      console.log("qb-void-invoice: added note to QB invoice", invoice.qb_invoice_id);
    }

    // Void the invoice (POST with ?operation=void)
    const voidUrl = `${QB_API_BASE}/v3/company/${realmId}/invoice?operation=void`;
    const voidRes = await fetch(voidUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        Id: invoice.qb_invoice_id,
        SyncToken: syncToken,
      }),
    });
    const voidData = await voidRes.json();
    if (!voidRes.ok) throw new Error(`QB void failed: ${JSON.stringify(voidData?.Fault?.Error?.[0]?.Detail || voidData)}`);

    console.log("qb-void-invoice: voided QB invoice", invoice.qb_invoice_id, "for SC invoice", invoiceId);

    return new Response(JSON.stringify({
      success: true,
      action: "voided",
      qbInvoiceId: invoice.qb_invoice_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });

  } catch (error) {
    console.error("qb-void-invoice error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
