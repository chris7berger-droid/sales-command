import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const ALLOWED_ORIGINS = ["https://salescommand.app", "https://www.salescommand.app", "https://www.scmybiz.com", "https://scmybiz.com"];

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is authenticated
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const { customerEmail, customerName, repEmail, repName, proposalNumber, jobName, signingUrl, companyName } = await req.json();

    console.log("send-proposal invoked", { customerEmail, repEmail, proposalNumber, jobName });

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "Customer email is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Email to customer — send FROM the rep's email if their domain is verified in Resend
    const VERIFIED_DOMAINS = ["hdspnv.com", "scmybiz.com", "schmybiz.com", "salescommand.app"];
    const senderName = repName || companyName || "Sales Command";
    const repDomain = repEmail ? repEmail.split("@")[1]?.toLowerCase() : "";
    const fromAddress = repEmail && VERIFIED_DOMAINS.includes(repDomain)
      ? `${senderName} <${repEmail}>`
      : `${senderName} <noreply@salescommand.app>`;
    const customerRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        reply_to: repEmail || undefined,
        to: customerEmail,
        subject: `Proposal Ready for Review — ${jobName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
            <div style="border-bottom: 4px solid #30cfac; padding-bottom: 16px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 0.02em;">High Desert Surface Prep</h2>
              <p style="margin: 4px 0 0; color: #4a4238; font-size: 13px;">Industrial & Commercial Concrete Coatings</p>
            </div>
            <p>Hi ${customerName},</p>
            <p>Your proposal is ready for review. Click the button below to view and sign.</p>
            <div style="margin: 32px 0;">
              <a href="${signingUrl}" style="background: #30cfac; color: #1c1814; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Review & Sign Proposal →</a>
            </div>
            <p style="color: #887c6e; font-size: 12px;">Proposal #${proposalNumber} · This link is unique to you and expires in 90 days.</p>
            <p style="color: #887c6e; font-size: 12px;">Questions? Reply to this email or call (775) 300-1900.</p>
          </div>
        `,
      }),
    });

    const customerResBody = await customerRes.text();
    console.log("Customer email response:", customerRes.status, customerResBody);

    if (!customerRes.ok) {
      return new Response(JSON.stringify({ error: `Failed to send customer email: ${customerResBody}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Notification to rep (non-blocking — don't fail the whole request if this fails)
    if (repEmail) {
      try {
        const repRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: repEmail,
            subject: `Proposal Sent — ${jobName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1c1814;">
                <p>Hi ${repName},</p>
                <p>Proposal #${proposalNumber} for <strong>${customerName}</strong> (${jobName}) has been sent for signature.</p>
                <p style="color: #887c6e; font-size: 12px;">You will receive another notification when the customer signs.</p>
              </div>
            `,
          }),
        });
        const repResBody = await repRes.text();
        console.log("Rep email response:", repRes.status, repResBody);
      } catch (e) {
        console.error("Rep email failed (non-fatal):", e.message);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("send-proposal error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
