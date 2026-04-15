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

    // Verify caller is authenticated (allow service-role key for internal calls from stripe-webhook)
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
    if (!isServiceRole) {
      const { data: { user }, error: authErr } = await sb.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        });
      }
    }

    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch invoice
    const { data: invoice } = await sb.from("invoices").select("*").eq("id", invoiceId).single();
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    if (!invoice.qb_invoice_id) {
      return new Response(JSON.stringify({ error: "Invoice not synced to QB yet" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch QB customer ID via proposal -> call_log
    let qbCustomerId = null;
    if (invoice.proposal_id) {
      const { data: proposal } = await sb.from("proposals").select("call_log_id").eq("id", invoice.proposal_id).maybeSingle();
      if (proposal?.call_log_id) {
        const { data: cl } = await sb.from("call_log").select("qb_customer_id").eq("id", proposal.call_log_id).maybeSingle();
        qbCustomerId = cl?.qb_customer_id;
      }
    }
    if (!qbCustomerId) {
      const { data: cl } = await sb.from("call_log").select("qb_customer_id").eq("display_job_number", invoice.job_id).limit(1).maybeSingle();
      qbCustomerId = cl?.qb_customer_id;
    }
    if (!qbCustomerId) throw new Error("Job not synced to QuickBooks");

    const { accessToken, realmId } = await getQBToken(sb);

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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
