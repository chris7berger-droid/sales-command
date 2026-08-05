// Notify the job's sales rep that a proposal was approved.
//
// CALLED BY A DATABASE TRIGGER, not by the app. That is the whole point.
//
// History: this started as a function the browser invoked. Then the prod logs
// showed what actually happens when a customer signs — the signing page's call
// to `proposal-signed` never lands, and 31ms later the page calls the
// `mark_proposal_signed` RPC directly instead. That fallback marks the proposal
// Sold, shows "Proposal Accepted", and sends no mail. Every browser-side
// notification has that hole: the DB says Sold and nothing was sent.
//
// So the trigger on `proposals` is now the single notifier. It fires on the
// status transition itself, which is the one thing every approval route has in
// common — customer e-signature, the signing page's fallback, and the in-app
// Internal Approve button all end at the same UPDATE.
//
// The caller passes a proposal id and nothing else. Who to notify and what
// happened are both read from the row.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "https://deno.land/std@0.168.0/crypto/timing_safe_equal.ts";
import { notifyProposalApproved } from "../_shared/repNotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const enc = new TextEncoder();

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Only the database calls this. Length checked first — std timingSafeEqual
  // throws on unequal-length views.
  const a = enc.encode(req.headers.get("x-cron-secret") || "");
  const b = enc.encode(CRON_SECRET || "");
  if (!CRON_SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("Forbidden", { status: 403 });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status,
    });

  try {
    const { proposalId } = await req.json();
    if (!proposalId) return json(400, { error: "proposalId is required" });

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Work out which route got here, from the row rather than from the caller.
    const { data: p } = await sb
      .from("proposals")
      .select("id, internal_approval, approved_by, approval_reason")
      .eq("id", proposalId)
      .maybeSingle();

    if (!p) return json(404, { error: "Proposal not found" });

    let how;
    if (p.internal_approval) {
      how = {
        kind: "internal" as const,
        approvedBy: p.approved_by || "",
        reason: p.approval_reason || "",
      };
    } else {
      const { data: sig } = await sb
        .from("proposal_signatures")
        .select("signer_name")
        .eq("proposal_id", proposalId)
        .order("signed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      how = { kind: "signed" as const, signerName: sig?.signer_name || "" };
    }

    const result = await notifyProposalApproved(sb, proposalId, how);
    if (!result.emailed) {
      console.error(`proposal-approved: rep NOT notified for ${proposalId} — ${result.detail}`);
    }
    return json(200, result);
  } catch (error) {
    console.error("proposal-approved error:", (error as Error).message);
    return json(500, { error: (error as Error).message });
  }
});
