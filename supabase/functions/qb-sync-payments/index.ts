import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";

// QuickBooks -> Sales Command payment reconcile.
//
// The inverse of `qb-record-payment` (which pushes an SC-side payment INTO QB).
// When a payment is entered directly in QuickBooks — a mailed check, an ACH the
// bookkeeper applies — nothing previously told SC, so the invoice sat on "Sent"
// forever. This reads QB's Balance as ground truth and flips SC to Paid.
//
// Ground-truth rule ([[qb-reconcile-query-qb-directly]]): never infer QB state
// from SC fields. We query QB by the stored qb_invoice_id and believe Balance.

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_ENVIRONMENT = Deno.env.get("QB_ENVIRONMENT") || "sandbox";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QB_API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// QB caps a query's IN list; keep batches well under any practical limit.
const BATCH_SIZE = 40;

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

async function qbQuery(sql: string, accessToken: string, realmId: string) {
  return await qbApi("GET", `/query?query=${encodeURIComponent(sql)}`, accessToken, realmId);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

    // A user JWT reconciles only its own tenant. Service-role callers must name one.
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const tenantId = caller.isServiceRole ? body?.tenantId : caller.tenantId;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "tenantId is required for service-role calls" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    // Candidates: synced to QB, still open in SC, not voided/deleted.
    const { data: candidates, error: candErr } = await sb
      .from("invoices")
      .select("id, job_name, status, amount, discount, retention_amount, qb_invoice_id, qb_payment_id, paid_at")
      .eq("tenant_id", tenantId)
      .not("qb_invoice_id", "is", null)
      .neq("status", "Paid")
      .is("deleted_at", null)
      .is("voided_at", null);

    if (candErr) throw new Error(`Candidate query failed: ${candErr.message}`);
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ success: true, checked: 0, updated: [], partial: [], skipped: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const { accessToken, realmId } = await getQBToken(sb, tenantId);

    // Index SC rows by their QB invoice id so QB's response can be matched back.
    const byQbId = new Map<string, any>();
    for (const c of candidates) byQbId.set(String(c.qb_invoice_id), c);

    const updated: any[] = [];
    const partial: any[] = [];
    const skipped: any[] = [];

    for (const ids of chunk([...byQbId.keys()], BATCH_SIZE)) {
      const inList = ids.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(",");
      const res = await qbQuery(
        `SELECT * FROM Invoice WHERE Id IN (${inList}) MAXRESULTS 1000`,
        accessToken,
        realmId,
      );
      const qbInvoices: any[] = res?.QueryResponse?.Invoice || [];

      // A QB id with no row back = hard-deleted in QB. Report, never guess.
      const returnedIds = new Set(qbInvoices.map((q) => String(q.Id)));
      for (const id of ids) {
        if (!returnedIds.has(id)) {
          skipped.push({ id: byQbId.get(id)?.id, qbInvoiceId: id, reason: "not_found_in_qb" });
        }
      }

      // Collect the Payment ids QB links to each paid invoice, so paid_at can be
      // the real payment date rather than "whenever the sync happened to run".
      const paymentIdsNeeded = new Set<string>();
      const pendingPaid: { sc: any; qb: any; paymentIds: string[] }[] = [];

      for (const qb of qbInvoices) {
        const sc = byQbId.get(String(qb.Id));
        if (!sc) continue;

        const balance = Number(qb.Balance ?? 0);
        const total = Number(qb.TotalAmt ?? 0);

        // A voided QB invoice zeroes its lines: TotalAmt 0 AND Balance 0. That is
        // indistinguishable from "paid" on Balance alone, so refuse it here — a
        // void must not read back to SC as a payment (B60 heal rule).
        if (total <= 0) {
          skipped.push({ id: sc.id, qbInvoiceId: qb.Id, reason: "qb_total_zero_possible_void" });
          continue;
        }

        if (balance > 0) {
          // Partially paid: SC has no partial status, so report and leave it open
          // rather than inventing one.
          if (balance < total) {
            partial.push({
              id: sc.id,
              qbInvoiceId: qb.Id,
              qbTotal: total,
              qbBalance: balance,
              paidSoFar: Number((total - balance).toFixed(2)),
            });
          }
          continue;
        }

        const paymentIds = (qb.LinkedTxn || [])
          .filter((t: any) => t.TxnType === "Payment")
          .map((t: any) => String(t.TxnId));
        paymentIds.forEach((p) => paymentIdsNeeded.add(p));
        pendingPaid.push({ sc, qb, paymentIds });
      }

      // Resolve payment dates in one batch per chunk.
      const paymentDates = new Map<string, string>();
      if (paymentIdsNeeded.size > 0) {
        for (const pIds of chunk([...paymentIdsNeeded], BATCH_SIZE)) {
          const pList = pIds.map((id) => `'${id.replace(/'/g, "\\'")}'`).join(",");
          const pRes = await qbQuery(
            `SELECT * FROM Payment WHERE Id IN (${pList}) MAXRESULTS 1000`,
            accessToken,
            realmId,
          );
          for (const p of pRes?.QueryResponse?.Payment || []) {
            if (p?.TxnDate) paymentDates.set(String(p.Id), p.TxnDate);
          }
        }
      }

      for (const { sc, qb, paymentIds } of pendingPaid) {
        // Latest linked payment settles the invoice — that is the paid date.
        const dates = paymentIds.map((p) => paymentDates.get(p)).filter(Boolean) as string[];
        dates.sort();
        const paidDate = dates.length ? dates[dates.length - 1] : null;
        // QB TxnDate is a calendar date (no zone). Anchor at noon UTC so a
        // timezone shift can't roll it into the previous day in SC's reports.
        const paidAt = paidDate
          ? new Date(`${paidDate}T12:00:00Z`).toISOString()
          : new Date().toISOString();

        const updates: any = { status: "Paid", paid_at: paidAt };
        // Record which QB payment settled it, if SC doesn't already have one.
        if (!sc.qb_payment_id && paymentIds.length) updates.qb_payment_id = paymentIds[paymentIds.length - 1];

        if (!dryRun) {
          const { error: upErr } = await sb
            .from("invoices")
            .update(updates)
            .eq("id", sc.id)
            .eq("tenant_id", tenantId)
            .neq("status", "Paid");
          if (upErr) {
            skipped.push({ id: sc.id, qbInvoiceId: qb.Id, reason: `update_failed: ${upErr.message}` });
            continue;
          }
        }

        updated.push({
          id: sc.id,
          qbInvoiceId: qb.Id,
          amount: Number(qb.TotalAmt),
          paidAt,
          paidDateSource: paidDate ? "qb_payment_txndate" : "sync_time_fallback",
        });
      }
    }

    console.log("qb-sync-payments:", JSON.stringify({
      tenantId, dryRun, checked: candidates.length,
      updated: updated.length, partial: partial.length, skipped: skipped.length,
    }));

    return new Response(JSON.stringify({
      success: true, dryRun, checked: candidates.length, updated, partial, skipped,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });

  } catch (error) {
    console.error("qb-sync-payments error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
