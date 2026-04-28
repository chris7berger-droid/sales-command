import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { repEmail, repName, customerName, signerName, proposalNumber, jobName, proposalId, callLogId, signing_token } = await req.json();

    // The caller must present the proposal's signing_token — the same secret
    // the public signing page used to load the proposal. Proves the caller
    // has a legitimate signing session and blocks anonymous status flips.
    if (!proposalId || !signing_token) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: propRow, error: propLookupErr } = await sb
      .from("proposals")
      .select("signing_token")
      .eq("id", proposalId)
      .single();
    if (propLookupErr || !propRow || propRow.signing_token !== signing_token) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    console.log("proposal-signed invoked", { repEmail, proposalNumber, signerName, proposalId, callLogId });

    // Update proposal status to Sold (using service role key — bypasses RLS)
    const { error: propErr } = await sb.from("proposals").update({ status: "Sold", approved_at: new Date().toISOString() }).eq("id", proposalId);
    if (propErr) console.error("proposal-signed: failed to update proposal status:", propErr.message);
    else console.log("proposal-signed: proposal", proposalId, "set to Sold");

    if (callLogId) {
      const { error: clErr } = await sb.from("call_log").update({ stage: "Sold" }).eq("id", callLogId);
      if (clErr) console.error("proposal-signed: failed to update call_log stage:", clErr.message);
      else console.log("proposal-signed: call_log", callLogId, "set to Sold");
    }

    if (!repEmail) {
      console.log("proposal-signed: no rep email, skipping notification but status updated");
      return new Response(JSON.stringify({ success: true, message: "Status updated, no email sent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
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
      return new Response(JSON.stringify({ error: `Email failed: ${resBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("proposal-signed error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
