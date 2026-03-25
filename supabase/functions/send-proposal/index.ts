import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { customerEmail, customerName, repEmail, repName, proposalNumber, jobName, signingUrl } = await req.json();

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

    // Email to customer
    const customerRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "estimates@hdspnv.com",
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
            from: "estimates@hdspnv.com",
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
