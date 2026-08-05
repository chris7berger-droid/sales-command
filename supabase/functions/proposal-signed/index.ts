import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// H5: extract caller IP from the request's own headers rather than
// trusting a body-supplied value from the React signing page (which is
// client-controlled). x-forwarded-for is set by Supabase's edge proxy.
// The leftmost entry in the comma-separated list is the original client.
function extractClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

function jsonResp(status: number, body: unknown, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // NOTE: the body still carries repEmail/repName/customerName/jobName from
    // older builds of the signing page. They are deliberately IGNORED — the
    // signing page is anonymous, so nothing it says about who to notify can be
    // trusted, and when its own rep lookup came back empty this function used
    // to skip the email and report success. Recipient now comes from the DB.
    const { signerName, signerEmail, pdfUrl, signing_token } = await req.json();

    if (!signing_token) {
      return jsonResp(400, { error: "Bad Request" }, corsHeaders);
    }

    // H5: IP comes from the request's own forwarding headers, not from
    // the React body. The React page still captures IP via ipify for
    // the printed signature line on the customer's PDF, but the value
    // stored in proposal_signatures.ip_address comes from here.
    const ip = extractClientIp(req);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // mark_proposal_signed (5-arg) is the H5 atomic single-use RPC.
    // It validates token expiry + consumed_at, flips status='Sold' +
    // approved_at + signing_token_consumed_at, inserts the signature
    // row (when signerName is supplied — it is from the new JS path),
    // and flips call_log.stage='Sold' — all in one transaction.
    //
    // Error mapping (RAISE EXCEPTION codes from the function body):
    //   INVALID_TOKEN        → 403 (expired / wrong token)
    //   ALREADY_SIGNED       → 409 (race / stale tab / double-click)
    //   INVALID_SIGNER_NAME  → 400
    //   INVALID_PDF_URL      → 400 (URL didn't match Supabase signed-
    //                               proposals path for this proposal)
    const { data: signedRows, error: signErr } = await sb.rpc("mark_proposal_signed", {
      p_token:        signing_token,
      p_signer_name:  signerName ?? null,
      p_signer_email: signerEmail ?? null,
      p_ip_address:   ip,
      p_pdf_url:      pdfUrl ?? null,
    });

    if (signErr) {
      const msg = signErr.message || "";
      console.error("proposal-signed: RPC failed:", msg);
      if (msg.includes("ALREADY_SIGNED"))       return jsonResp(409, { error: "ALREADY_SIGNED" },      corsHeaders);
      if (msg.includes("INVALID_TOKEN"))        return jsonResp(403, { error: "Forbidden" },           corsHeaders);
      if (msg.includes("INVALID_SIGNER_NAME"))  return jsonResp(400, { error: "INVALID_SIGNER_NAME" }, corsHeaders);
      if (msg.includes("INVALID_PDF_URL"))      return jsonResp(400, { error: "INVALID_PDF_URL" },     corsHeaders);
      return jsonResp(500, { error: "Sign failed" }, corsHeaders);
    }
    if (!signedRows || signedRows.length === 0) {
      // RPC normally raises on miss; defensive in case grant/wiring changes.
      return jsonResp(403, { error: "Forbidden" }, corsHeaders);
    }

    const proposalId = signedRows[0].proposal_id;
    const callLogId  = signedRows[0].call_log_id;
    const becameSold = signedRows[0].became_sold ?? true;

    console.log("proposal-signed: marked", { proposalId, callLogId, becameSold, signerName });

    // No email is sent from here on purpose. The rep notification fires from a
    // trigger on the proposals status change instead (see the
    // notify_proposal_approved migration). The prod logs showed why: when the
    // signing page's call to THIS function doesn't land, the page falls back to
    // calling mark_proposal_signed directly, and any email living here is
    // simply skipped while the proposal still goes Sold. The trigger sees that
    // transition either way.
    return jsonResp(200, { success: true, became_sold: becameSold }, corsHeaders);

  } catch (error) {
    console.error("proposal-signed error:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
