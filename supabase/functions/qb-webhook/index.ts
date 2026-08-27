// qb-webhook — INSTANT QB → SC payment reflection (the PRIMARY path).
//
// Receives Intuit Event Notifications the moment a payment posts in QuickBooks, so
// SC flips to Paid in seconds. The 15-min sweep (qb-reflect-payments) is the backup
// that catches anything a ping misses — this function can be fire-and-forget without
// risk because the sweep guarantees nothing is ever lost. (plan §4.3b)
//
// SECURITY: public endpoint, deployed --no-verify-jwt. The HMAC-SHA256 signature
// check is the SOLE gate and runs BEFORE any DB read. It fails CLOSED — no verifier
// token configured means reject everything, never "no secret = valid." A signature
// bypass still can't forge Paid: the reflect core re-queries live QB Balance + a real
// linked Payment before flipping.
//
// NOT a browser origin — no CORS gating (Intuit is server-to-server). (audit R2 adj)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reflectInvoicesFromQB } from "../_shared/reflectPayments.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QB_WEBHOOK_VERIFIER_TOKEN = Deno.env.get("QB_WEBHOOK_VERIFIER_TOKEN");

// Intuit signs the RAW body with HMAC-SHA256 and sends the digest BASE64-encoded in
// `intuit-signature` (Stripe's is hex — do NOT copy that encoding). Base64-DECODE the
// header to raw bytes before crypto.subtle.verify; it needs bytes, not the string.
// (audit D2 / R2 B2)
async function verifyIntuitSignature(rawBody: string, sigHeader: string, token: string): Promise<boolean> {
  if (!sigHeader) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(sigHeader), (c) => c.charCodeAt(0));
  } catch {
    return false; // header wasn't valid base64
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(rawBody));
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Raw body FIRST — the HMAC is over the exact bytes, before any parse.
  const rawBody = await req.text();
  const sigHeader = req.headers.get("intuit-signature") || "";

  // Fail closed: no verifier token = reject everything (mirror stripe-webhook:67-70).
  if (!QB_WEBHOOK_VERIFIER_TOKEN) {
    console.error("FATAL: QB_WEBHOOK_VERIFIER_TOKEN not configured — rejecting all events");
    return new Response("Webhook verifier not configured", { status: 500 });
  }

  const valid = await verifyIntuitSignature(rawBody, sigHeader, QB_WEBHOOK_VERIFIER_TOKEN);
  if (!valid) {
    console.error("qb-webhook: invalid Intuit signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Pre-200: realm → tenant mapping ONLY. No QB reads here (a Payment's
  //    invoice-id resolution is a QB read — leaving it pre-200 re-opens the ~3s
  //    Intuit-timeout/retry-storm the async ack exists to kill). (audit J1 / R2 B1)
  let payload: any;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    // Signature was valid but body isn't JSON — ack so Intuit doesn't retry a
    // malformed delivery forever; nothing to do.
    return new Response("ok", { status: 200 });
  }

  const notifications: any[] = payload?.eventNotifications || [];
  const realmToTenant = new Map<string, string | null>(); // null = ambiguous/unknown, don't process
  const work: { tenantId: string; entityType: "Invoice" | "Payment"; entityId: string }[] = [];

  for (const n of notifications) {
    const realmId = n?.realmId != null ? String(n.realmId) : "";
    if (!realmId) continue;

    if (!realmToTenant.has(realmId)) {
      // realm_id has NO uniqueness constraint (audit E1) — handle 0 / 1 / many.
      const { data: conns, error } = await sb.from("qb_connection").select("tenant_id").eq("realm_id", realmId);
      if (error) {
        console.error("qb-webhook: qb_connection lookup failed", realmId, error.message);
        realmToTenant.set(realmId, null);
      } else if (!conns || conns.length === 0) {
        // Not our realm — drop quietly (200).
        realmToTenant.set(realmId, null);
      } else if (conns.length > 1) {
        console.error(`qb-webhook: realm ${realmId} maps to ${conns.length} tenants — ambiguous, not processing`);
        realmToTenant.set(realmId, null);
      } else {
        realmToTenant.set(realmId, conns[0].tenant_id);
      }
    }
    const tenantId = realmToTenant.get(realmId);
    if (!tenantId) continue;

    const entities: any[] = n?.dataChangeEvent?.entities || [];
    for (const e of entities) {
      const name = e?.name;
      const id = e?.id != null ? String(e.id) : "";
      if (!id) continue;
      // Payment events change balances; Invoice events fire on payment too. Both
      // are reflected — the core re-queries live QB before flipping either way.
      if (name === "Invoice" || name === "Payment") {
        work.push({ tenantId, entityType: name, entityId: id });
      }
    }
  }

  // ── Ack fast; ALL QB work async inside waitUntil. The sweep is the safety net if
  //    this async work fails. (audit J1 / R2 B1)
  const process = (async () => {
    for (const item of work) {
      try {
        const r = await reflectInvoicesFromQB(sb, item.tenantId, { entityType: item.entityType, entityId: item.entityId });
        if (r.flipped.length || r.errors.length) {
          console.log("qb-webhook reflect:", JSON.stringify({
            tenantId: item.tenantId, entity: `${item.entityType}/${item.entityId}`,
            flipped: r.flipped, errors: r.errors,
          }));
        }
      } catch (e) {
        console.error("qb-webhook reflect error", item.entityType, item.entityId, (e as Error).message);
      }
    }
  })();

  // @ts-ignore — EdgeRuntime is provided by the Supabase edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(process);
  } else {
    // Local/fallback: nothing to await against, but don't leave it dangling.
    process.catch((e) => console.error("qb-webhook process error", (e as Error).message));
  }

  return new Response("ok", { status: 200 });
});
