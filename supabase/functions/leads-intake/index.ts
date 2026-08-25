// leads-intake — receives one lead per POST from the marketing company's bot and
// stores it in public.leads. Contract: docs/plans/PARTNER-leads-intake-spec.md.
//
// - Checks a shared secret header (X-Leads-Secret) — rejects anything else.
// - Dedupes on (tenant_id, lead_id): a retry with the same lead_id is a no-op.
// - Inserts with the service role (no logged-in user on an inbound webhook).
//
// Env required (Supabase function secrets):
//   LEADS_INTAKE_SECRET     — the shared password; must match the sender's header
//   LEADS_INTAKE_TENANT_ID  — which tenant these leads belong to (single-tenant today)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — provided by the platform

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const LEADS_INTAKE_SECRET = Deno.env.get("LEADS_INTAKE_SECRET");
const LEADS_INTAKE_TENANT_ID = Deno.env.get("LEADS_INTAKE_TENANT_ID");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CHANNELS = ["facebook", "google", "twilio", "other"];

// Constant-time compare so the secret check can't leak via response timing.
function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Cap untrusted string fields before the service-role insert. The sender holds
// the secret, but a public endpoint shouldn't trust length — DB columns are
// unbounded text, so this is the real backstop.
const clip = (v: unknown, n: number): string | null =>
  typeof v === "string" ? v.slice(0, n) : null;

function json(body: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req, { extraAllowHeaders: ["x-leads-secret"] }), "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req, { extraAllowHeaders: ["x-leads-secret"] }) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405, req);
  }

  // Config guard — never accept leads if the secret/tenant aren't set up.
  if (!LEADS_INTAKE_SECRET || !LEADS_INTAKE_TENANT_ID) {
    console.error("FATAL: LEADS_INTAKE_SECRET or LEADS_INTAKE_TENANT_ID not configured");
    return json({ ok: false, error: "not_configured" }, 500, req);
  }

  // Auth: shared secret header must match (constant-time).
  if (!secretMatches(req.headers.get("x-leads-secret") || "", LEADS_INTAKE_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  // Parse.
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, req);
  }

  // Validate required fields.
  const lead_id = typeof payload.lead_id === "string" ? payload.lead_id.trim().slice(0, 200) : "";
  const channel = typeof payload.channel === "string" ? payload.channel : "";
  const received_at = typeof payload.received_at === "string" ? payload.received_at : "";
  if (!lead_id) return json({ ok: false, error: "missing lead_id" }, 400, req);
  if (!CHANNELS.includes(channel)) return json({ ok: false, error: "invalid channel" }, 400, req);
  if (!received_at || isNaN(Date.parse(received_at))) return json({ ok: false, error: "invalid received_at" }, 400, req);

  // Keep raw only if it's a sane size; oversized payloads are dropped, not stored.
  const RAW_MAX = 20000;
  const rawStr = payload.raw != null ? JSON.stringify(payload.raw) : null;
  const row = {
    tenant_id: LEADS_INTAKE_TENANT_ID,
    lead_id,
    channel,
    received_at,
    name: clip(payload.name, 200),
    phone: clip(payload.phone, 50),
    email: clip(payload.email, 320),
    campaign: clip(payload.campaign, 200),
    ad_id: clip(payload.ad_id, 100),
    message: clip(payload.message, 5000),
    raw: rawStr && rawStr.length <= RAW_MAX ? payload.raw : null,
  };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Bolt-on gate: only accept leads for a tenant that has the add-on turned on.
  const { data: tenant, error: tErr } = await supabase
    .from("tenant_config").select("leads_enabled").eq("id", LEADS_INTAKE_TENANT_ID).single();
  if (tErr || !tenant?.leads_enabled) {
    return json({ ok: false, error: "leads_not_enabled" }, 403, req);
  }

  // Insert; a unique-violation on (tenant_id, lead_id) means we already have it.
  const { error } = await supabase.from("leads").insert(row);
  if (error) {
    if (error.code === "23505") {
      return json({ ok: true, deduped: true }, 200, req);
    }
    console.error("leads insert failed:", error);
    return json({ ok: false, error: "store_failed" }, 500, req);
  }

  return json({ ok: true, deduped: false }, 200, req);
});
