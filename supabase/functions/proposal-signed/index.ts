import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

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
    const {
      repEmail, repName, customerName, signerName, signerEmail,
      pdfUrl, proposalNumber, jobName, signing_token,
    } = await req.json();

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
    const callLogId = signedRows[0].call_log_id;

    console.log("proposal-signed: marked sold", { proposalId, callLogId, proposalNumber, signerName });

    if (!repEmail) {
      console.log("proposal-signed: no rep email, skipping notification but status updated");
      return jsonResp(200, { success: true, message: "Status updated, no email sent" }, corsHeaders);
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return jsonResp(500, { error: "Email service not configured" }, corsHeaders);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "estimates@hdspnv.com",
        to: repEmail,
        subject: `Proposal Signed — ${jobName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>
            <p>Hi ${repName},</p>
            <p>Great news — <strong>${customerName}</strong> has signed Proposal #${proposalNumber} for <strong>${jobName}</strong>.</p>
            <p>Signed by: <strong>${signerName}</strong><br/>
            Date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            <p>The proposal status has been updated to <strong>Sold</strong>. You can download the signed PDF from the Proposals page.</p>
            <p style="color: #887c6e; font-size: 12px; margin-top: 24px;">— Sales Command</p>
          </div>
        `,
      }),
    });

    const resBody = await res.text();
    console.log("Resend response:", res.status, resBody);

    if (!res.ok) {
      return jsonResp(500, { error: `Email failed: ${resBody}` }, corsHeaders);
    }

    return jsonResp(200, { success: true }, corsHeaders);

  } catch (error) {
    console.error("proposal-signed error:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
