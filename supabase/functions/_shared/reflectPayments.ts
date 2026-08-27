// Shared "reflect" core — QuickBooks → Sales Command payment-status reflection.
//
// ONE rule: payment status flows QB → SC only. QuickBooks is the single source of
// truth for "is it paid." This module is the ONE place that reads QB payment state
// and flips a Sales Command invoice to Paid. Two triggers import and call it:
//   - qb-webhook          (instant, primary)  — hands it {entityType, entityId}
//   - qb-reflect-payments (15-min sweep, backup) — hands it "all-unpaid"
// Both call the SAME core, so they can never drift. (plan §4.3a)
//
// IMPORTANT — this is NOT an edge function / route. It is an imported module. If it
// were a public endpoint it would be an unauthenticated invoice-flipper callable
// with (tenantId, ids). Both triggers call it AFTER their own auth gate passes; the
// core never faces the internet. (audit D1)
//
// GUARD PLACEMENT — every row-eligibility rule lives HERE, on both the candidate
// resolve AND the final write: voided/deleted exclusion, tenant scope, qb_skip_sync,
// and the require-a-real-Payment rule. The webhook passes ids straight in, so a guard
// that lived only in the sweep's query would be bypassed by the webhook and could
// resurrect a voided invoice to Paid. Consolidating here makes that whole bug class
// impossible. (audit R2 A1/A2)

const QB_CLIENT_ID = Deno.env.get("QB_CLIENT_ID")!;
const QB_CLIENT_SECRET = Deno.env.get("QB_CLIENT_SECRET")!;
const QB_ENVIRONMENT = Deno.env.get("QB_ENVIRONMENT") || "sandbox";
const QB_API_BASE = QB_ENVIRONMENT === "production"
  ? "https://quickbooks.api.intuit.com"
  : "https://sandbox-quickbooks.api.intuit.com";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_MINOR_VERSION = "70";

// QB caps `IN (...)` result sets at 1000 rows; keep batches well under that so a
// single 90-row backfill also stays polite against Intuit's ~500-req/min limit —
// batches run serially (throttle, plan §4.4), never all at once.
const QB_IN_BATCH = 40;

export type ReflectTarget =
  | "all-unpaid"
  | { entityType: "Invoice" | "Payment"; entityId: string }
  | { qbInvoiceIds: string[] };

export interface ReflectResult {
  tenantId: string;
  candidates: number;      // SC invoices considered after SC-side eligibility
  flipped: string[];       // SC invoice ids flipped to Paid
  skippedSkipSync: string[];
  skippedNoPayment: string[]; // zero balance but no linked Payment (write-off/credit memo)
  skippedUnpaid: string[];    // QB balance still > 0
  errors: string[];
}

// ── QB auth (same pattern as qb-record-payment / qb-sync-invoice) ────────────
async function getQBToken(sb: any, tenantId: string): Promise<{ accessToken: string; realmId: string }> {
  const { data: conn } = await sb.from("qb_connection").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!conn) throw new Error(`No QuickBooks connection for tenant ${tenantId}.`);

  if (new Date(conn.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    const basicAuth = btoa(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }).toString(),
    });
    const t = await res.json();
    if (!res.ok) throw new Error(`Token refresh failed: ${t.error || "unknown"}`);
    await sb.from("qb_connection").update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conn.id);
    return { accessToken: t.access_token, realmId: conn.realm_id };
  }
  return { accessToken: conn.access_token, realmId: conn.realm_id };
}

async function qbQuery(sql: string, accessToken: string, realmId: string): Promise<any> {
  const url = `${QB_API_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=${QB_MINOR_VERSION}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`QB query ${res.status}: ${JSON.stringify(data?.Fault?.Error?.[0]?.Detail || data)}`);
  return data?.QueryResponse || {};
}

async function qbGet(entity: string, id: string, accessToken: string, realmId: string): Promise<any> {
  const url = `${QB_API_BASE}/v3/company/${realmId}/${entity.toLowerCase()}/${id}?minorversion=${QB_MINOR_VERSION}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Authorization": `Bearer ${accessToken}`, "Accept": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`QB get ${entity}/${id} ${res.status}: ${JSON.stringify(data?.Fault?.Error?.[0]?.Detail || data)}`);
  return data;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// QB Payment.TxnDate is date-only ("YYYY-MM-DD"). Store it as LOCAL NOON, never a
// bare date cast into timestamptz — that lands on UTC-midnight, which renders as the
// PRIOR day in Pacific and misstates month boundaries. (audit C2)
function localNoon(txnDate: string): string {
  return `${txnDate}T12:00:00`;
}

// ── The core ─────────────────────────────────────────────────────────────────
// sb MUST be a service-role client (writes into invoices, reads qb_connection).
// The caller has already authenticated; this function trusts that and enforces the
// ROW rules itself.
export async function reflectInvoicesFromQB(
  sb: any,
  tenantId: string,
  target: ReflectTarget,
): Promise<ReflectResult> {
  const result: ReflectResult = {
    tenantId, candidates: 0, flipped: [], skippedSkipSync: [],
    skippedNoPayment: [], skippedUnpaid: [], errors: [],
  };

  const { accessToken, realmId } = await getQBToken(sb, tenantId);

  // ── Step 1: resolve the candidate SC invoices, applying the SC-side eligibility
  //    filter on EVERY path (audit R2 A1/A2). status not Paid/New, linked to QB,
  //    not deleted, not voided, in this tenant. QB ids are realm-local, so the
  //    tenant scope matters the moment a 2nd tenant onboards.
  const baseSelect = "id, qb_invoice_id, proposal_id, job_id, status, tenant_id";
  const eligible = (q: any) =>
    q.eq("tenant_id", tenantId)
      .not("qb_invoice_id", "is", null)
      .neq("status", "Paid")
      .neq("status", "New")
      .is("deleted_at", null)
      .is("voided_at", null);

  let candidates: any[] = [];
  if (target === "all-unpaid") {
    // Page defensively — the backlog is ~108 today but PostgREST caps at 1000.
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await eligible(sb.from("invoices").select(baseSelect))
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`candidate query failed: ${error.message}`);
      candidates.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  } else if ("qbInvoiceIds" in target) {
    for (const ids of chunk(target.qbInvoiceIds, 200)) {
      const { data, error } = await eligible(sb.from("invoices").select(baseSelect)).in("qb_invoice_id", ids);
      if (error) throw new Error(`candidate query failed: ${error.message}`);
      candidates.push(...(data || []));
    }
  } else if (target.entityType === "Invoice") {
    const { data, error } = await eligible(sb.from("invoices").select(baseSelect)).eq("qb_invoice_id", target.entityId);
    if (error) throw new Error(`candidate query failed: ${error.message}`);
    candidates.push(...(data || []));
  } else {
    // Payment event: resolve the Payment's LinkedTxn → Invoice ids, THEN filter
    // those SC invoices through the same eligibility gate. (This QB read is fine
    // here — the webhook already returned 200 and is running inside waitUntil.)
    const payment = await qbGet("Payment", target.entityId, accessToken, realmId);
    const invIds: string[] = (payment?.Payment?.Line || [])
      .flatMap((l: any) => l?.LinkedTxn || [])
      .filter((lt: any) => lt?.TxnType === "Invoice")
      .map((lt: any) => String(lt.TxnId));
    const uniq = [...new Set(invIds)];
    for (const ids of chunk(uniq, 200)) {
      if (!ids.length) continue;
      const { data, error } = await eligible(sb.from("invoices").select(baseSelect)).in("qb_invoice_id", ids);
      if (error) throw new Error(`candidate query failed: ${error.message}`);
      candidates.push(...(data || []));
    }
  }

  // De-dup by SC invoice id (a Payment can link several invoices; overlapping ids).
  const byId = new Map<string, any>();
  for (const c of candidates) byId.set(c.id, c);
  candidates = [...byId.values()];
  result.candidates = candidates.length;
  if (!candidates.length) return result;

  // ── Step 2: qb_skip_sync post-read join filter (audit G1). qb_skip_sync lives on
  //    call_log, not invoices, so it can't be in the candidate query. Resolve
  //    invoice → proposal → call_log.qb_skip_sync (fallback by display_job_number =
  //    invoices.job_id), mirroring qb-record-payment:117/123. Skip those invoices.
  const skipSyncInvoiceIds = await resolveSkipSync(sb, candidates);
  candidates = candidates.filter((c) => {
    if (skipSyncInvoiceIds.has(c.id)) { result.skippedSkipSync.push(c.id); return false; }
    return true;
  });
  if (!candidates.length) return result;

  // ── Step 3: read the candidate invoices from QB in serial batches. ───────────
  const qbById = new Map<string, any>();
  const qbInvoiceIds = candidates.map((c) => String(c.qb_invoice_id));
  for (const ids of chunk(qbInvoiceIds, QB_IN_BATCH)) {
    const inList = ids.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
    const qr = await qbQuery(`select * from Invoice where Id in (${inList})`, accessToken, realmId);
    for (const qi of (qr.Invoice || [])) qbById.set(String(qi.Id), qi);
  }

  // Gather every linked Payment TxnId across the flip-eligible invoices, so we can
  // fetch their TxnDates in one batched pass (paid_at = MAX linked Payment TxnDate).
  const flipPlan: { inv: any; qb: any; paymentTxnIds: string[] }[] = [];
  for (const c of candidates) {
    const qb = qbById.get(String(c.qb_invoice_id));
    if (!qb) { result.errors.push(`QB invoice ${c.qb_invoice_id} not found for SC ${c.id}`); continue; }

    // Balance parsed defensively from its string/number form.
    const balance = Number.parseFloat(String(qb.Balance ?? "NaN"));
    if (!(balance === 0)) { result.skippedUnpaid.push(c.id); continue; }

    // Flip rule (audit A1 — the core contract): Balance == 0 is not enough. Require
    // at least one linked QB Payment. A zero balance with no Payment (write-off /
    // credit memo / bad-debt) is left for a human — never read as "collected."
    const paymentTxnIds: string[] = (qb.LinkedTxn || [])
      .filter((lt: any) => lt?.TxnType === "Payment")
      .map((lt: any) => String(lt.TxnId));
    if (!paymentTxnIds.length) { result.skippedNoPayment.push(c.id); continue; }

    flipPlan.push({ inv: c, qb, paymentTxnIds });
  }
  if (!flipPlan.length) return result;

  // paid_at source: fetch the linked Payments' TxnDates in batches, MAX across them.
  const allPaymentIds = [...new Set(flipPlan.flatMap((p) => p.paymentTxnIds))];
  const paymentDate = new Map<string, string>();
  for (const ids of chunk(allPaymentIds, QB_IN_BATCH)) {
    const inList = ids.map((id) => `'${id.replace(/'/g, "")}'`).join(",");
    const qr = await qbQuery(`select Id, TxnDate from Payment where Id in (${inList})`, accessToken, realmId);
    for (const p of (qr.Payment || [])) if (p?.TxnDate) paymentDate.set(String(p.Id), String(p.TxnDate));
  }

  // ── Step 4: write. Atomic, guards REPEATED on the write so nothing slips between
  //    resolve and update (audit R2 A1/A2). Never-un-pay is structural: `status <>
  //    'Paid'`. The voided/deleted/tenant predicates make resurrection and
  //    cross-tenant flips impossible even if a stale id reached this line.
  for (const { inv, paymentTxnIds } of flipPlan) {
    const dates = paymentTxnIds.map((id) => paymentDate.get(id)).filter(Boolean) as string[];
    if (!dates.length) { result.errors.push(`no Payment TxnDate for SC ${inv.id} — not flipping`); continue; }
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const paidAt = localNoon(maxDate);

    const { data, error } = await sb.from("invoices")
      .update({ status: "Paid", paid_at: paidAt, qb_reflected_at: new Date().toISOString() })
      .eq("id", inv.id)
      .neq("status", "Paid")
      .is("voided_at", null)
      .is("deleted_at", null)
      .eq("tenant_id", tenantId)
      .select("id");
    if (error) { result.errors.push(`flip failed for SC ${inv.id}: ${error.message}`); continue; }
    if (data && data.length) result.flipped.push(inv.id);
  }

  return result;
}

// Resolve which candidate invoice ids sit on a qb_skip_sync job. Mirrors
// qb-record-payment: proposal → call_log.qb_skip_sync, fallback call_log by
// display_job_number = invoices.job_id. Batched.
async function resolveSkipSync(sb: any, candidates: any[]): Promise<Set<string>> {
  const skip = new Set<string>();

  // Path A: via proposal → call_log.
  const propIds = [...new Set(candidates.filter((c) => c.proposal_id).map((c) => c.proposal_id))];
  const propToCallLog = new Map<string, number>();
  for (const ids of chunk(propIds, 200)) {
    if (!ids.length) continue;
    const { data } = await sb.from("proposals").select("id, call_log_id").in("id", ids);
    for (const p of (data || [])) if (p.call_log_id != null) propToCallLog.set(String(p.id), p.call_log_id);
  }
  const callLogIds = [...new Set([...propToCallLog.values()])];
  const callLogSkip = new Map<number, boolean>();
  for (const ids of chunk(callLogIds, 200)) {
    if (!ids.length) continue;
    const { data } = await sb.from("call_log").select("id, qb_skip_sync").in("id", ids);
    for (const cl of (data || [])) callLogSkip.set(cl.id, !!cl.qb_skip_sync);
  }

  // Path B fallback: candidates with no proposal-resolved call_log → match call_log
  // by display_job_number = invoices.job_id.
  const fallbackJobIds = [...new Set(
    candidates
      .filter((c) => !(c.proposal_id && propToCallLog.has(String(c.proposal_id))))
      .map((c) => c.job_id)
      .filter((j) => j != null),
  )];
  const jobNumSkip = new Map<string, boolean>();
  for (const ids of chunk(fallbackJobIds, 200)) {
    if (!ids.length) continue;
    const { data } = await sb.from("call_log").select("display_job_number, qb_skip_sync").in("display_job_number", ids);
    for (const cl of (data || [])) jobNumSkip.set(String(cl.display_job_number), !!cl.qb_skip_sync);
  }

  for (const c of candidates) {
    let isSkip = false;
    const clId = c.proposal_id ? propToCallLog.get(String(c.proposal_id)) : undefined;
    if (clId != null) isSkip = callLogSkip.get(clId) === true;
    else if (c.job_id != null) isSkip = jobNumSkip.get(String(c.job_id)) === true;
    if (isSkip) skip.add(c.id);
  }
  return skip;
}
