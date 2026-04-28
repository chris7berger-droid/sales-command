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

// ── Helper: get fresh QB access token ──────────────────────────────────
async function getQBToken(sb: any) {
  const { data: conn } = await sb.from("qb_connection").select("*").limit(1).single();
  if (!conn) throw new Error("No QuickBooks connection found. Connect QB first.");

  if (new Date(conn.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    console.log("qb-sync-invoice: refreshing expired token");
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

// ── Helper: QB API request ─────────────────────────────────────────────
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

// ── Helper: find QB Item by exact name ─────────────────────────────────
async function findItemExact(name: string, accessToken: string, realmId: string) {
  const escaped = name.replace(/'/g, "\\'");
  const data = await qbApi("GET", `/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Name = '${escaped}'`)}`, accessToken, realmId);
  return data?.QueryResponse?.Item?.[0] || null;
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

    // Verify caller is authenticated
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

    const { invoiceId, editReason } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "invoiceId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Fetch invoice
    const { data: invoice } = await sb.from("invoices").select("*").eq("id", invoiceId).single();
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    const isUpdate = !!invoice.qb_invoice_id;

    // Fetch invoice lines with WTC + work type info
    const { data: lines } = await sb.from("invoice_lines")
      .select("*, proposal_wtc(*, work_types(name, cost_code))")
      .eq("invoice_id", invoiceId);

    // Fetch the call log for QB customer ID via proposal -> call_log
    // invoices.job_id is the job number (string), not call_log.id (int)
    // So we go through: invoice.proposal_id -> proposals.call_log_id -> call_log
    let qbCustomerId = null;
    let jobState = null;
    let skipSync = false;
    let skipReason = null;
    if (invoice.proposal_id) {
      const { data: proposal } = await sb.from("proposals").select("call_log_id, is_archive_proposal").eq("id", invoice.proposal_id).maybeSingle();
      if (proposal?.is_archive_proposal) { skipSync = true; skipReason = "is_archive_proposal"; }
      if (proposal?.call_log_id) {
        const { data: callLog } = await sb.from("call_log").select("qb_customer_id, jobsite_state, qb_skip_sync").eq("id", proposal.call_log_id).maybeSingle();
        qbCustomerId = callLog?.qb_customer_id;
        jobState = callLog?.jobsite_state;
        if (callLog?.qb_skip_sync) { skipSync = true; skipReason = skipReason || "qb_skip_sync"; }
      }
    }
    // Fallback: try matching by display_job_number
    if (!qbCustomerId) {
      const { data: callLog } = await sb.from("call_log").select("qb_customer_id, jobsite_state, qb_skip_sync").eq("display_job_number", invoice.job_id).limit(1).maybeSingle();
      qbCustomerId = callLog?.qb_customer_id;
      jobState = callLog?.jobsite_state;
      if (callLog?.qb_skip_sync) { skipSync = true; skipReason = skipReason || "qb_skip_sync"; }
    }

    // Skip BEFORE the qbCustomerId throw — archive-imported jobs intentionally have no QB customer.
    if (skipSync) {
      console.log("qb-sync-invoice: skipping per flag", { invoiceId, reason: skipReason });
      return new Response(JSON.stringify({ success: true, skipped: true, reason: skipReason }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    if (!qbCustomerId) {
      throw new Error("Job not synced to QuickBooks yet. Approve the proposal first.");
    }

    const { accessToken, realmId } = await getQBToken(sb);

    // ── Find the "Services" item in QB ───────────────────────────────
    const servicesItem = await findItemExact("Services", accessToken, realmId);
    if (!servicesItem) throw new Error('Could not find "Services" item in QuickBooks');
    console.log("qb-sync-invoice: using Services item, QB ID:", servicesItem.Id);

    // ── Build QB invoice line items ────────────────────────────────────
    const qbLines: any[] = [];

    if (lines && lines.length > 0) {
      for (const line of lines) {
        const workTypeName = line.proposal_wtc?.work_types?.name || "Services";
        qbLines.push({
          DetailType: "SalesItemLineDetail",
          Amount: line.amount || 0,
          Description: workTypeName,
          SalesItemLineDetail: {
            ItemRef: { value: servicesItem.Id, name: servicesItem.Name },
            Qty: 1,
            UnitPrice: line.amount || 0,
          },
        });
      }
    } else {
      // No lines — single line with total amount
      qbLines.push({
        DetailType: "SalesItemLineDetail",
        Amount: invoice.amount || 0,
        Description: invoice.description || "Services",
        SalesItemLineDetail: {
          ItemRef: { value: servicesItem.Id, name: servicesItem.Name },
          Qty: 1,
          UnitPrice: invoice.amount || 0,
        },
      });
    }

    // Add discount if present
    if (invoice.discount && invoice.discount > 0) {
      qbLines.push({
        DetailType: "DiscountLineDetail",
        Amount: invoice.discount,
        DiscountLineDetail: {
          PercentBased: false,
        },
      });
    }

    // Add retention as a held-back discount line so QB net matches what's billed now.
    // QB doesn't natively track retainage without QBO Plus, so we represent it as a
    // descriptive discount line. Release happens via a separate invoice later.
    const retentionAmt = parseFloat(invoice.retention_amount) || 0;
    const retentionPct = parseFloat(invoice.retention_pct) || 0;
    if (retentionAmt > 0) {
      qbLines.push({
        DetailType: "DiscountLineDetail",
        Amount: retentionAmt,
        Description: `Retention${retentionPct > 0 ? ` (${retentionPct}%)` : ""} — held back`,
        DiscountLineDetail: {
          PercentBased: false,
        },
      });
    }

    // ── Determine location from jobsite state ──────────────────────────
    // QB uses "Department" for Location tracking
    let departmentRef = null;
    if (jobState) {
      const stateData = await qbApi("GET", `/query?query=${encodeURIComponent(`SELECT * FROM Department WHERE Name = '${jobState}'`)}`, accessToken, realmId);
      const dept = stateData?.QueryResponse?.Department?.[0];
      if (dept) {
        departmentRef = { value: dept.Id, name: dept.Name };
        console.log("qb-sync-invoice: location/department found:", dept.Name);
      } else {
        console.log("qb-sync-invoice: no department found for state:", jobState);
      }
    }

    // ── Build QB invoice object ───────────────────────────────────────
    const qbInvoice: any = {
      CustomerRef: { value: qbCustomerId },
      DocNumber: invoiceId,
      TxnDate: invoice.sent_at ? new Date(invoice.sent_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      DueDate: invoice.due_date || undefined,
      Line: qbLines,
    };

    if (departmentRef) {
      qbInvoice.DepartmentRef = departmentRef;
    }

    // Add description/PO number
    if (invoice.description) {
      qbInvoice.CustomerMemo = { value: invoice.description };
    }

    let qbInvoiceId: string;

    if (isUpdate) {
      // ── Update existing QB invoice ────────────────────────────────────
      // Fetch existing QB invoice to get SyncToken and existing PrivateNote
      const existing = await qbApi("GET", `/invoice/${invoice.qb_invoice_id}`, accessToken, realmId);
      const syncToken = existing.Invoice.SyncToken;
      qbInvoice.Id = invoice.qb_invoice_id;
      qbInvoice.SyncToken = syncToken;
      qbInvoice.sparse = false; // full update replaces all fields

      // Append edit reason to PrivateNote for audit trail
      const existingNote = existing.Invoice.PrivateNote || "";
      const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
      const editNote = editReason ? `[EDITED] ${timestamp} — ${editReason}` : `[EDITED] ${timestamp}`;
      qbInvoice.PrivateNote = existingNote ? `${existingNote}\n${editNote}` : editNote;

      console.log("qb-sync-invoice: updating QB invoice", invoice.qb_invoice_id, "for SC invoice", invoiceId);
      const result = await qbApi("POST", "/invoice", accessToken, realmId, qbInvoice);
      qbInvoiceId = result.Invoice.Id;
      console.log("qb-sync-invoice: updated QB invoice ID:", qbInvoiceId);
    } else {
      // ── Create new QB invoice ─────────────────────────────────────────
      console.log("qb-sync-invoice: creating invoice", invoiceId, "for QB customer", qbCustomerId);
      const result = await qbApi("POST", "/invoice", accessToken, realmId, qbInvoice);
      qbInvoiceId = result.Invoice.Id;
      console.log("qb-sync-invoice: created QB invoice ID:", qbInvoiceId);

      // Save QB invoice ID back to our invoices table
      await sb.from("invoices").update({ qb_invoice_id: qbInvoiceId }).eq("id", invoiceId);
    }

    return new Response(JSON.stringify({
      success: true,
      qbInvoiceId,
      docNumber: invoiceId,
      action: isUpdate ? "updated" : "created",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("qb-sync-invoice error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
