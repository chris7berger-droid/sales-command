// Notify the job's sales rep that a proposal was approved from inside the app
// (the Internal Approve button on the proposal screen).
//
// WHY THIS EXISTS: until now the ONLY approval that emailed anyone was a
// customer e-signature. In prod, 21 of the last 25 approvals went through
// Internal Approve instead — so almost every sold job notified nobody.
//
// The caller sends a proposal id and nothing else that matters. Who gets the
// email is resolved from the DB (job -> sales_name -> active team member), so a
// low-privilege account can't redirect a notification.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, unauthorizedResponse } from "../_shared/tenantAuth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { notifyProposalApproved } from "../_shared/repNotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const caller = await authenticateCaller(sb, req, SUPABASE_SERVICE_ROLE_KEY);
    if (!caller.ok) return unauthorizedResponse(caller.status, corsHeaders);

    const { proposalId, approvedBy, reason } = await req.json();
    if (!proposalId) return json(400, { error: "proposalId is required" });

    const { data: row } = await sb
      .from("proposals")
      .select("id, tenant_id")
      .eq("id", proposalId)
      .maybeSingle();

    if (!row) return json(404, { error: "Proposal not found" });
    if (!caller.isServiceRole && row.tenant_id !== caller.tenantId) {
      return unauthorizedResponse(403, corsHeaders);
    }

    const result = await notifyProposalApproved(sb, proposalId, {
      kind: "internal",
      approvedBy: approvedBy || "",
      reason: reason || "",
    });

    // 200 even when no email went out. The approval itself already happened;
    // this endpoint reports on the notification rather than failing the flow.
    return json(200, result);
  } catch (error) {
    console.error("proposal-approved error:", (error as Error).message);
    return json(500, { error: (error as Error).message });
  }
});
