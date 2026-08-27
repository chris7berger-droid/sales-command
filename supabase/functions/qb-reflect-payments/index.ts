// qb-reflect-payments — the 15-minute BACKUP sweep for QB → SC payment reflection.
//
// The instant webhook (qb-webhook) is the everyday path; this is the self-healing
// safety net that catches anything a webhook ping missed and clears the backlog. It
// imports the SAME reflect core (_shared/reflectPayments.ts) the webhook uses, so the
// two can never drift: the webhook says WHICH invoices changed, the sweep re-checks
// ALL still-unpaid invoices. A failed webhook or a ping that never arrived is swept
// up next pass — nothing is ever silently lost. (plan §4.3c)
//
// SECURITY: this is a cron target with no human caller. It is deployed
// --no-verify-jwt, so the x-cron-secret shared secret is the ONLY gate. CRON_SECRET
// is a PROJECT-GLOBAL secret that already gates follow-up-reminders + check-orphan-
// users — this function INHERITS it. Do NOT `supabase secrets set CRON_SECRET`, or
// you silently 403 those two live jobs. (audit R2 C1)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";
import { reflectInvoicesFromQB } from "../_shared/reflectPayments.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const enc = new TextEncoder();

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Length is checked first: std timingSafeEqual throws on unequal-length views.
  const a = enc.encode(req.headers.get("x-cron-secret") || "");
  const b = enc.encode(CRON_SECRET || "");
  if (!CRON_SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Forbidden", { status: 403 });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, status });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // One sweep per tenant that has a QB connection. QB ids are realm-local, so the
    // core is always scoped to a single tenant_id.
    const { data: conns, error } = await sb.from("qb_connection").select("tenant_id");
    if (error) return json(500, { error: `qb_connection read failed: ${error.message}` });

    const tenantIds = [...new Set((conns || []).map((c: any) => c.tenant_id).filter(Boolean))];
    const summaries: any[] = [];
    for (const tenantId of tenantIds) {
      try {
        const r = await reflectInvoicesFromQB(sb, tenantId, "all-unpaid");
        summaries.push({
          tenantId,
          candidates: r.candidates,
          flipped: r.flipped.length,
          skippedNoPayment: r.skippedNoPayment.length,
          skippedUnpaid: r.skippedUnpaid.length,
          skippedSkipSync: r.skippedSkipSync.length,
          errors: r.errors,
        });
        if (r.flipped.length || r.errors.length) {
          console.log("qb-reflect-payments:", JSON.stringify(summaries[summaries.length - 1]));
        }
      } catch (e) {
        console.error("qb-reflect-payments tenant error", tenantId, (e as Error).message);
        summaries.push({ tenantId, error: (e as Error).message });
      }
    }

    return json(200, { ok: true, tenants: tenantIds.length, summaries });
  } catch (e) {
    console.error("qb-reflect-payments error:", (e as Error).message);
    return json(500, { error: (e as Error).message });
  }
});
