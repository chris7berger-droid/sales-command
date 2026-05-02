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

async function getQBToken(sb: any, tenantId: string) {
  const { data: conn } = await sb.from("qb_connection").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!conn) throw new Error("No QuickBooks connection found for tenant.");

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

    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch invoice
    const { data: invoice } = await sb.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (!invoice) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404,
      });
    }

    // Tenant binding: a user JWT may only act on invoices in their own tenant.
    // Service-role internal calls (stripe-webhook) skip this check.
    if (!caller.isServiceRole && invoice.tenant_id !== caller.tenantId) {
      return unauthorizedResponse(403, corsHeaders);
    }

    // Resolve QB customer + skip flags via proposal -> call_log (fallback by display_job_number).
    // Skip checks must run BEFORE the qb_invoice_id null-check so archive invoices
    // skip cleanly instead of surfacing a misleading "not synced to QB yet" error.
    let qbCustomerId = null;
    let qbSkipSync = false;
    let isArchiveProposal = false;
    if (invoice.proposal_id) {
      const { data: proposal } = await sb.from("proposals").select("call_log_id, is_archive_proposal").eq("id", invoice.proposal_id).maybeSingle();
      isArchiveProposal = !!proposal?.is_archive_proposal;
      if (proposal?.call_log_id) {
        const { data: cl } = await sb.from("call_log").select("qb_customer_id, qb_skip_sync").eq("id", proposal.call_log_id).maybeSingle();
        qbCustomerId = cl?.qb_customer_id || null;
        qbSkipSync = !!cl?.qb_skip_sync;
      }
    }
    if (!qbCustomerId) {
      const { data: cl } = await sb.from("call_log").select("qb_customer_id, qb_skip_sync").eq("display_job_number", invoice.job_id).limit(1).maybeSingle();
      qbCustomerId = cl?.qb_customer_id || null;
      qbSkipSync = qbSkipSync || !!cl?.qb_skip_sync;
    }

    if (qbSkipSync) {
      console.log("qb-record-payment: skipping per flag", { invoiceId, reason: "qb_skip_sync" });
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "qb_skip_sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }
    if (!qbCustomerId && isArchiveProposal) {
      console.log("qb-record-payment: skipping per flag", { invoiceId, reason: "is_archive_proposal_unlinked" });
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "is_archive_proposal_unlinked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (!invoice.qb_invoice_id) {
      return new Response(JSON.stringify({ error: "Invoice not synced to QB yet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Defense-in-depth: linked-job invariant should make this unreachable in normal flow.
    if (!qbCustomerId) throw new Error("Job not synced to QuickBooks");

    const { accessToken, realmId } = await getQBToken(sb, invoice.tenant_id);

    // Net amount (after discount)
    const netAmount = (invoice.amount || 0) - (invoice.discount || 0);

    // Create Payment in QB
    const payment: any = {
      CustomerRef: { value: qbCustomerId },
      TotalAmt: netAmount,
      TxnDate: invoice.paid_at ? new Date(invoice.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      Line: [{
        Amount: netAmount,
        LinkedTxn: [{
          TxnId: invoice.qb_invoice_id,
          TxnType: "Invoice",
        }],
      }],
    };

    console.log("qb-record-payment: creating payment for invoice", invoiceId, "QB invoice", invoice.qb_invoice_id);
    const result = await qbApi("POST", "/payment", accessToken, realmId, payment);
    const qbPaymentId = result.Payment.Id;
    console.log("qb-record-payment: created QB payment ID:", qbPaymentId);

    // Persist QB payment ID back to invoices table
    await sb.from("invoices").update({ qb_payment_id: qbPaymentId }).eq("id", invoiceId);

    return new Response(JSON.stringify({ success: true, qbPaymentId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("qb-record-payment error:", error.message);
    if (/Customer.*inactive|Reference.*Customer/i.test(error.message || "")) {
      return new Response(JSON.stringify({
        error: "qb_customer_invalid",
        message: "Linked QuickBooks customer no longer exists or is inactive. Re-link this job to a current QB customer.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
